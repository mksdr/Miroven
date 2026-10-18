import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeSyncOperation,
  applyRemoteSyncChange,
  clearPinFailures,
  clearStoredDraft,
  cleanupExpiredTombstones,
  cleanupOrphanedBlobs,
  createEncryptedBackup,
  createRecoveryKit,
  deleteEntry,
  getPinLockoutRemainingSeconds,
  getStoredDraft,
  getSyncSnapshot,
  hasPinLock,
  isVaultLocked,
  importEncryptedBackup,
  isRecommendedPinLength,
  isValidPinFormat,
  listEntries,
  listPendingSyncOperations,
  lockDeviceKey,
  markSyncOperationConflict,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  purgeLocalVaultData,
  RECOMMENDED_MIN_PIN_LENGTH,
  removePinLock,
  resolveConflictKeepBoth,
  resolveConflictUseLocal,
  saveDraft,
  saveEntry,
  setupPinLock,
  unlockVaultWithPin,
  type JournalEntry,
} from "../app/lib/local-vault";
import { DRAFT_STORE_KEY, KEY_STORE } from "../app/lib/vault/contracts";
import type { JournalDraft, StoredDraft } from "../app/lib/vault/types";

const DATABASE_NAME = "private-journal";
const SAMPLE_ENTRY: JournalEntry = {
  id: "018f91f0-776b-7c8a-80d8-82455b091234",
  text: "암호화 금고 회귀 테스트",
  createdAt: "2026-08-01T12:34:56.000Z",
};

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("테스트 금고를 초기화하지 못했습니다."));
    request.onblocked = () => reject(new Error("테스트 금고 연결이 닫히지 않았습니다."));
  });
}

function replaceBase64Byte(value: string): string {
  const replacement = value[0] === "A" ? "B" : "A";
  return `${replacement}${value.slice(1)}`;
}

async function readRawDraft(): Promise<unknown> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(KEY_STORE).objectStore(KEY_STORE).get(DRAFT_STORE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function writeRawDraft(draft: JournalDraft): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      transaction.objectStore(KEY_STORE).put(draft, DRAFT_STORE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

async function createBackupFixture() {
  await saveEntry(SAMPLE_ENTRY);
  const { recoveryCode } = await createRecoveryKit();
  const backup = await createEncryptedBackup();
  return { recoveryCode, backup: backup.json };
}

describe("encrypted local vault", () => {
  beforeEach(deleteTestDatabase);
  afterEach(deleteTestDatabase);

  it("loads all records in date order under the low-spec budget and honours cancellation", async () => {
    for (let i = 0; i < 25; i++) {
      await saveEntry({ ...SAMPLE_ENTRY, id: `bounded-${i}`, createdAt: new Date(1700000000000 + i * 1000).toISOString() });
    }
    const entries = await listEntries({ lowSpecMode: true });
    expect(entries).toHaveLength(25);
    expect(entries[0].id).toBe("bounded-24");
    expect(entries[24].id).toBe("bounded-0");
    await expect(listEntries({ signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(await listEntries({ lowSpecMode: false })).toEqual(entries);
  });

  it("restores an encrypted backup on a fresh device", async () => {
    const { recoveryCode, backup } = await createBackupFixture();

    await deleteTestDatabase();
    const result = await importEncryptedBackup(backup, recoveryCode);

    expect(result.entries).toBe(1);
    await expect(listEntries()).resolves.toEqual([SAMPLE_ENTRY]);
  });

  it("rejects a recovery code with an invalid checksum", async () => {
    const { recoveryCode, backup } = await createBackupFixture();
    const characters = recoveryCode.replaceAll("-", "");
    const invalidCode = `${characters.slice(0, -1)}${characters.at(-1) === "A" ? "B" : "A"}`;

    await deleteTestDatabase();
    await expect(importEncryptedBackup(backup, invalidCode)).rejects.toThrow(
      "복구 코드의 철자를 확인해 주세요.",
    );
  });

  it("rejects a checksum-valid recovery code from another vault", async () => {
    const { backup } = await createBackupFixture();

    await deleteTestDatabase();
    const { recoveryCode: otherRecoveryCode } = await createRecoveryKit();
    await deleteTestDatabase();

    await expect(importEncryptedBackup(backup, otherRecoveryCode)).rejects.toThrow(
      "복구 코드가 일치하지 않거나 백업이 손상되었습니다.",
    );
    await expect(listEntries()).resolves.toEqual([]);
  });

  it("rejects a modified vault-key envelope before importing entries", async () => {
    const { recoveryCode, backup } = await createBackupFixture();
    const parsed = JSON.parse(backup) as {
      vault: { wrappedVaultKey: string };
    };
    parsed.vault.wrappedVaultKey = replaceBase64Byte(parsed.vault.wrappedVaultKey);

    await deleteTestDatabase();
    await expect(
      importEncryptedBackup(JSON.stringify(parsed), recoveryCode),
    ).rejects.toThrow("복구 코드가 일치하지 않거나 백업이 손상되었습니다.");
    await expect(listEntries()).resolves.toEqual([]);
  });

  it("rejects a backup whose ciphertext was modified", async () => {
    const { recoveryCode, backup } = await createBackupFixture();
    const parsed = JSON.parse(backup) as {
      entries: Array<{ ciphertext: string }>;
    };
    parsed.entries[0].ciphertext = replaceBase64Byte(parsed.entries[0].ciphertext);

    await deleteTestDatabase();
    await expect(
      importEncryptedBackup(JSON.stringify(parsed), recoveryCode),
    ).rejects.toThrow("백업 기록의 무결성을 확인하지 못했습니다.");
  });

  it("rejects an entry id change because it is authenticated as AAD", async () => {
    const { recoveryCode, backup } = await createBackupFixture();
    const parsed = JSON.parse(backup) as {
      entries: Array<{ id: string }>;
    };
    parsed.entries[0].id = "018f91f0-776b-7c8a-80d8-82455b095678";

    await deleteTestDatabase();
    await expect(
      importEncryptedBackup(JSON.stringify(parsed), recoveryCode),
    ).rejects.toThrow("백업 기록의 무결성을 확인하지 못했습니다.");
  });

  it("queues outbox operations when saving and deleting entries after vault initialization", async () => {
    await createRecoveryKit(); // initializes vault recovery envelope

    await saveEntry(SAMPLE_ENTRY);
    let pending = await listPendingSyncOperations();
    expect(pending.length).toBe(1);
    expect(pending[0].changeType).toBe("upsert");
    expect(pending[0].entryId).toBe(SAMPLE_ENTRY.id);

    // Acknowledge the pending operation (simulating successful push)
    await acknowledgeSyncOperation(pending[0]);
    pending = await listPendingSyncOperations();
    expect(pending.length).toBe(0);

    // Now delete the entry
    await deleteEntry(SAMPLE_ENTRY.id);
    pending = await listPendingSyncOperations();
    expect(pending.length).toBe(1);
    expect(pending[0].changeType).toBe("delete");
    expect(pending[0].entryId).toBe(SAMPLE_ENTRY.id);

    // Verify local entry is deleted
    const entries = await listEntries();
    expect(entries.length).toBe(0);
  });

  it("keeps a pending upsert before delete so an ambiguous retry cannot resurrect an entry", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);
    await deleteEntry(SAMPLE_ENTRY.id);

    const pending = await listPendingSyncOperations();
    expect(pending.map((operation) => operation.changeType)).toEqual([
      "upsert",
      "delete",
    ]);
    expect(pending.map((operation) => operation.baseRevision)).toEqual([0, 1]);
    expect(pending.map((operation) => operation.revision)).toEqual([1, 2]);
    await expect(listEntries()).resolves.toEqual([]);
  });

  it("increments revisions on edits and acknowledges duplicate responses idempotently", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);
    await saveEntry({ ...SAMPLE_ENTRY, text: "수정된 암호화 금고 기록" });

    const pending = (await listPendingSyncOperations()).sort(
      (left, right) => left.revision - right.revision,
    );
    expect(pending.map((operation) => operation.baseRevision)).toEqual([0, 1]);
    expect(pending.map((operation) => operation.revision)).toEqual([1, 2]);

    await acknowledgeSyncOperation(pending[0]);
    await acknowledgeSyncOperation(pending[0]);
    expect((await getSyncSnapshot()).pending).toBe(1);
    await expect(listEntries()).resolves.toEqual([
      { ...SAMPLE_ENTRY, text: "수정된 암호화 금고 기록" },
    ]);

    await acknowledgeSyncOperation(pending[1]);
    expect((await getSyncSnapshot()).pending).toBe(0);
  });

  it("handles sync conflict marking properly and resolves conflicts", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    const pending = await listPendingSyncOperations();
    expect(pending.length).toBe(1);

    await markSyncOperationConflict(pending[0].operationId, "충돌 발생 테스트");
    let snapshot = await getSyncSnapshot();
    expect(snapshot.conflicts).toBe(1);

    // Resolve conflict using local
    await applyRemoteSyncChange({ ...pending[0], operationId: "remote-first", serverCursor: 1 });
    await resolveConflictUseLocal(SAMPLE_ENTRY.id);
    snapshot = await getSyncSnapshot();
    expect(snapshot.pending).toBe(1);

    // Resolve conflict keeping both
    const [resolvedOperation] = await listPendingSyncOperations();
    await markSyncOperationConflict(resolvedOperation.operationId, "충돌 발생 테스트");
    await applyRemoteSyncChange({ ...resolvedOperation, operationId: "remote-second", serverCursor: 2 });
    const updatedEntries = await resolveConflictKeepBoth(SAMPLE_ENTRY.id);
    expect(updatedEntries.length).toBe(2);
  });

  it("purges all local vault data clean", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    expect((await listEntries()).length).toBe(1);

    await purgeLocalVaultData();
    expect((await listEntries()).length).toBe(0);
    expect((await getSyncSnapshot()).pending).toBe(0);
  });

  it("supports PIN vault key wrapping, locking, and unlocking with 6-digit recommendation", async () => {
    // PIN constants
    expect(MIN_PIN_LENGTH).toBe(4);
    expect(RECOMMENDED_MIN_PIN_LENGTH).toBe(6);
    expect(MAX_PIN_LENGTH).toBe(8);

    // PIN format validation
    expect(isValidPinFormat("")).toBe(false);
    expect(isValidPinFormat("123")).toBe(false);
    expect(isValidPinFormat("1234")).toBe(true);
    expect(isValidPinFormat("12345")).toBe(true);
    expect(isValidPinFormat("123456")).toBe(true);
    expect(isValidPinFormat("12345678")).toBe(true);
    expect(isValidPinFormat("123456789")).toBe(false);
    expect(isValidPinFormat("abcd")).toBe(false);
    expect(isValidPinFormat("123a")).toBe(false);

    // Recommended length validation (6-8 digits recommended for offline entropy)
    expect(isRecommendedPinLength("1234")).toBe(false);
    expect(isRecommendedPinLength("12345")).toBe(false);
    expect(isRecommendedPinLength("123456")).toBe(true);
    expect(isRecommendedPinLength("1234567")).toBe(true);
    expect(isRecommendedPinLength("12345678")).toBe(true);
    expect(isRecommendedPinLength("123456789")).toBe(false);
    expect(isRecommendedPinLength("abcdef")).toBe(false);

    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    expect(await hasPinLock()).toBe(false);

    // PIN validation rules (4-8 digits only)
    await expect(setupPinLock("123")).rejects.toThrow("PIN은 4~8자리의 숫자만 가능합니다.");
    await expect(setupPinLock("123456789")).rejects.toThrow("PIN은 4~8자리의 숫자만 가능합니다.");
    await expect(setupPinLock("abcd")).rejects.toThrow("PIN은 4~8자리의 숫자만 가능합니다.");

    // 1. Backwards-compatible 4-digit PIN setup & unlock
    await setupPinLock("1234");
    expect(await hasPinLock()).toBe(true);
    await lockDeviceKey();
    expect(await isVaultLocked()).toBe(true);
    expect(await unlockVaultWithPin("1234")).toBe(true);
    expect(await isVaultLocked()).toBe(false);
    expect(await removePinLock("1234")).toBe(true);
    expect(await hasPinLock()).toBe(false);

    // 2. Setup recommended 6-digit PIN
    await setupPinLock("654321");
    expect(await hasPinLock()).toBe(true);
    await lockDeviceKey();
    expect(await isVaultLocked()).toBe(true);
    expect(await unlockVaultWithPin("654321")).toBe(true);
    expect(await isVaultLocked()).toBe(false);
    expect(await removePinLock("654321")).toBe(true);
    expect(await hasPinLock()).toBe(false);

    // 3. Setup 8-digit PIN with lockout behavior
    await setupPinLock("12345678");
    expect(await hasPinLock()).toBe(true);

    // Lock device key
    await lockDeviceKey();
    expect(await isVaultLocked()).toBe(true);
    await expect(listEntries()).rejects.toThrow("로컬 금고가 잠겨 있습니다");

    // Failed attempts trigger rate limit lockout after 5 tries
    expect(await getPinLockoutRemainingSeconds()).toBe(0);
    for (let i = 0; i < 4; i++) {
      expect(await unlockVaultWithPin("99999999")).toBe(false);
    }
    expect(await getPinLockoutRemainingSeconds()).toBe(0);
    expect(await unlockVaultWithPin("99999999")).toBe(false);
    expect(await getPinLockoutRemainingSeconds()).toBeGreaterThan(0);

    // Locked out attempt fails even with correct PIN
    expect(await unlockVaultWithPin("12345678")).toBe(false);

    // Reset lockout state and test successful unlock
    await clearPinFailures();
    expect(await getPinLockoutRemainingSeconds()).toBe(0);

    // Correct 8-digit PIN unlocks
    const correctAttempt = await unlockVaultWithPin("12345678");
    expect(correctAttempt).toBe(true);

    // Can read entries again
    const entries = await listEntries();
    expect(entries.length).toBe(1);

    // Remove PIN lock
    const removed = await removePinLock("12345678");
    expect(removed).toBe(true);
    expect(await hasPinLock()).toBe(false);
  });

  it("encrypts, retrieves, and clears composer drafts correctly", async () => {
    expect(await getStoredDraft()).toBeNull();

    const draft: JournalDraft = {
      text: "임시 작성 중인 일기 내용입니다.",
      editingEntryId: null,
      updatedAt: new Date().toISOString(),
    };
    await saveDraft(draft);

    const raw = await readRawDraft() as StoredDraft & Partial<JournalDraft>;
    expect(raw.cryptoVersion).toBe(1);
    expect(raw.iv).toBeInstanceOf(ArrayBuffer);
    expect(raw.iv.byteLength).toBe(12);
    expect(raw.ciphertext).toBeInstanceOf(ArrayBuffer);
    expect(raw.ciphertext.byteLength).toBeGreaterThan(16);
    expect(raw.text).toBeUndefined();
    expect(raw.editingEntryId).toBeUndefined();
    expect(raw.updatedAt).toBeUndefined();
    expect(new TextDecoder().decode(raw.ciphertext)).not.toContain(draft.text);

    const stored = await getStoredDraft();
    expect(stored).toEqual(draft);

    await clearStoredDraft();
    expect(await getStoredDraft()).toBeNull();
  });

  it("migrates a legacy plaintext draft to encrypted storage", async () => {
    await saveEntry(SAMPLE_ENTRY);
    const legacy: JournalDraft = {
      text: "암호화 이전 평문 초안",
      editingEntryId: SAMPLE_ENTRY.id,
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    await writeRawDraft(legacy);

    expect(await getStoredDraft()).toEqual(legacy);
    const migrated = await readRawDraft() as StoredDraft & Partial<JournalDraft>;
    expect(migrated.cryptoVersion).toBe(1);
    expect(migrated.text).toBeUndefined();
    expect(new TextDecoder().decode(migrated.ciphertext)).not.toContain(legacy.text);
  });

  it("keeps encrypted drafts while locked and deletes locked legacy plaintext", async () => {
    const encrypted: JournalDraft = {
      text: "잠금 뒤 복원할 암호화 초안",
      editingEntryId: null,
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    await saveDraft(encrypted);
    await setupPinLock("12345678");

    expect(await getStoredDraft()).toBeNull();
    expect((await readRawDraft() as StoredDraft).cryptoVersion).toBe(1);
    expect(await unlockVaultWithPin("12345678")).toBe(true);
    expect(await getStoredDraft()).toEqual(encrypted);

    await lockDeviceKey();
    const legacy: JournalDraft = {
      text: "잠긴 금고에 남은 레거시 평문",
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    await writeRawDraft(legacy);
    expect(await getStoredDraft()).toBeNull();
    expect(await readRawDraft()).toBeUndefined();
  });

  it("preserves unacknowledged tombstones regardless of age", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);
    await deleteEntry(SAMPLE_ENTRY.id);

    const pending = await listPendingSyncOperations();
    const deleteOp = pending.find((op) => op.changeType === "delete");
    expect(deleteOp).toBeDefined();

    const removedCount = await cleanupExpiredTombstones(0);
    expect(removedCount).toBe(0);
    expect((await listPendingSyncOperations()).some(op => op.operationId === deleteOp?.operationId)).toBe(true);
  });

  it("cleans up acknowledged orphaned blob sync operations", async () => {
    await createRecoveryKit();
    const removedCount = await cleanupOrphanedBlobs();
    expect(removedCount).toBe(0);
  });
});
