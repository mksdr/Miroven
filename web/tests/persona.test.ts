import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERSONA_DOCUMENT_ID, validatePersona, type Persona } from "../app/lib/persona";
import { readPersona } from "../app/lib/vault/persona";
import { acknowledgeSyncOperation, applyRemoteSyncChange, createEncryptedBackup, createJournalReader, createRecoveryKit, getSyncSnapshot, importEncryptedBackup, listEntries, listPendingSyncOperations, purgeLocalVaultData, resolveConflictKeepBoth, resolveConflictUseLocal, savePersona, setupPinLock, lockDeviceKey, unlockVaultWithPin } from "../app/lib/local-vault";
import { ENTRY_STORE } from "../app/lib/vault/contracts";
import { openVaultDatabase, requestToPromise } from "../app/lib/vault/idb";
import { getStoredDeviceKey } from "../app/lib/vault/device-key";
import { createUpsertOperation, prepareRemoteRecord } from "../app/lib/vault/sync-outbox";
import { beginSnapshot, bindRemoteScope, commitSnapshot, stageSnapshotItem } from "../app/lib/vault/remote-state";

const persona: Persona = { name: "사용자", handle: "my_journal", bio: "비공개 소개", avatar: null };
const remotePersona: Persona = { ...persona, name: "다른 기기" };
async function key() {
  const db = await openVaultDatabase();
  try { return (await getStoredDeviceKey(db))!; } finally { db.close(); }
}

describe("encrypted persona document", () => {
  beforeEach(purgeLocalVaultData);
  afterEach(purgeLocalVaultData);
  it("does not create a device key when there is no persona", async () => {
    expect(await readPersona()).toBeNull();
    expect(await key()).toBeNull();
  });
  it("encrypts locally, excludes the document from journal/search readers and restores it from backup", async () => {
    await savePersona(persona, null);
    expect(await readPersona()).toEqual(persona);
    expect(await listEntries()).toEqual([]);
    const reader = createJournalReader();
    expect(await reader.list()).toEqual([]);
    reader.clear();
    const db = await openVaultDatabase();
    try {
      const record = await requestToPromise(db.transaction(ENTRY_STORE).objectStore(ENTRY_STORE).get(PERSONA_DOCUMENT_ID));
      expect(record.ciphertext).toBeInstanceOf(ArrayBuffer);
      expect(new TextDecoder().decode(record.ciphertext)).not.toContain(persona.bio);
      expect(record.text).toBeUndefined();
    } finally { db.close(); }
    const { recoveryCode } = await createRecoveryKit();
    expect(await listPendingSyncOperations()).toHaveLength(1);
    const backup = await createEncryptedBackup();
    expect(backup.entryCount).toBe(0);
    expect(backup.json).not.toContain(persona.bio);
    await purgeLocalVaultData();
    expect((await importEncryptedBackup(backup.json, recoveryCode)).entries).toBe(0);
    expect(await readPersona()).toEqual(persona);
  });
  it("applies the encrypted persona on a fresh device using the recovered vault key", async () => {
    const { recoveryCode } = await createRecoveryKit();
    const emptyBackup = await createEncryptedBackup();
    await savePersona(persona, null);
    const [operation] = await listPendingSyncOperations();
    await purgeLocalVaultData();
    await importEncryptedBackup(emptyBackup.json, recoveryCode);
    await applyRemoteSyncChange({ ...operation, serverCursor: 1 });
    expect(await readPersona()).toEqual(persona);
    expect(await createJournalReader().list()).toEqual([]);
  });
  it("restores a persona snapshot and republishes it after an empty server snapshot", async () => {
    const { recoveryCode } = await createRecoveryKit();
    const backup = await createEncryptedBackup();
    await savePersona(persona, null);
    const [operation] = await listPendingSyncOperations();
    await purgeLocalVaultData();
    await importEncryptedBackup(backup.json, recoveryCode);
    await bindRemoteScope("api|persona-user");
    await beginSnapshot();
    await stageSnapshotItem({ change: { ...operation, serverCursor: "snapshot" } }, "api|persona-user");
    await commitSnapshot("resume-first", "api|persona-user");
    expect(await readPersona()).toEqual(persona);
    await beginSnapshot();
    await commitSnapshot("resume-reset", "api|persona-user");
    expect(await readPersona()).toEqual(persona);
    expect((await listPendingSyncOperations()).map(item => item.entryId)).toEqual([PERSONA_DOCUMENT_ID]);
    expect(await listEntries()).toEqual([]);
  });
  it.each([false, true])("resolves concurrent device edits without creating persona copies (remote=%s)", async remote => {
    await createRecoveryKit();
    await savePersona(persona, null);
    await acknowledgeSyncOperation((await listPendingSyncOperations())[0]);
    await savePersona({ ...persona, name: "이 기기" }, persona);
    const operation = await createUpsertOperation(await key(), { id: PERSONA_DOCUMENT_ID, text: JSON.stringify(remotePersona), createdAt: new Date().toISOString() }, 2, 1);
    expect(await applyRemoteSyncChange({ ...operation, serverCursor: 1 })).toBe("conflict");
    await expect(savePersona(persona, { ...persona, name: "이 기기" })).rejects.toThrow();
    if (remote) await resolveConflictKeepBoth(PERSONA_DOCUMENT_ID);
    else await resolveConflictUseLocal(PERSONA_DOCUMENT_ID);
    expect(await readPersona()).toEqual(remote ? remotePersona : { ...persona, name: "이 기기" });
    expect(await listEntries()).toEqual([]);
    expect((await getSyncSnapshot()).conflicts).toBe(0);
    expect(await listPendingSyncOperations()).toHaveLength(remote ? 0 : 1);
    const db = await openVaultDatabase();
    try { expect(await requestToPromise(db.transaction(ENTRY_STORE).objectStore(ENTRY_STORE).count())).toBe(1); } finally { db.close(); }
  });
  it("rejects stale local edits and keeps a locked persona unreadable", async () => {
    await savePersona(persona, null);
    await expect(savePersona(remotePersona, null)).rejects.toThrow();
    await setupPinLock("123456");
    await lockDeviceKey();
    await expect(readPersona()).rejects.toThrow();
    await unlockVaultWithPin("123456");
    expect(await readPersona()).toEqual(persona);
  });
  it("rejects oversized images and invalid incoming persona documents before storage", async () => {
    expect(() => validatePersona({ ...persona, handle: "bad id" })).toThrow();
    const bytes = new Uint8Array(33);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(12, 0x49484452);
    view.setUint32(16, 101); view.setUint32(20, 100);
    const avatar = `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
    expect(() => validatePersona({ ...persona, avatar })).toThrow();
    await createRecoveryKit();
    // Bypass the sender validator to model an untrusted remote document.
    const { encryptSyncBytes } = await import("../app/lib/vault/sync-outbox");
    const payload = await encryptSyncBytes(await key(), "entry", PERSONA_DOCUMENT_ID, 1,
      new TextEncoder().encode(JSON.stringify({ id: PERSONA_DOCUMENT_ID, text: JSON.stringify({ ...persona, avatar }), createdAt: new Date().toISOString() })).buffer);
    await expect(prepareRemoteRecord(await key(), { entryId: PERSONA_DOCUMENT_ID, operationId: "invalid", serverCursor: 1, revision: 1, baseRevision: 0, changeType: "upsert", payload })).rejects.toThrow();
    expect(await readPersona()).toBeNull();
  });
});
