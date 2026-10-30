import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createEncryptedBackup, createRecoveryKit, deleteEntry, getSyncSnapshot, importEncryptedBackup, listEntries, listPendingSyncOperations, markSyncOperationConflict, saveEntry } from "../app/lib/local-vault";
import { serializeOperation } from "../app/lib/vault/backup";
import type { EncryptedBackupV2 as Backup } from "../app/lib/vault/types";
import legacyBackupV1 from "./fixtures/legacy-backup-v1.json";
import backupV2 from "./fixtures/backup-v2.json";
import { openVaultDatabase, requestToPromise } from "../app/lib/vault/idb";

const legacyRecoveryCode = "3P2ZZ-A4763-F7KD3-KPBSY-9HVBT-L5QK8-PTQ4C-PECJ6-23";
const entry = { id: "018f91f0-776b-7c8a-80d8-82455b091234", text: "synthetic backup authentication entry", createdAt: "2026-10-29T00:00:00Z" };
const deletion = { operationId: "77777777-7777-4777-8777-777777777777", entryId: entry.id, baseRevision: 1, revision: 2, changeType: "delete", createdAt: entry.createdAt, status: "pending" };
async function reset() {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase("private-journal");
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error("Database still open"));
  });
}
async function fixture() {
  await saveEntry(entry);
  const { recoveryCode } = await createRecoveryKit();
  const backup = JSON.parse((await createEncryptedBackup()).json);
  await reset();
  return { recoveryCode, backup };
}
async function expectEmptyStores() {
  const db = await openVaultDatabase();
  try {
    for (const name of db.objectStoreNames) {
      expect(await requestToPromise(db.transaction(name).objectStore(name).count())).toBe(0);
    }
  } finally { db.close(); }
}
beforeEach(reset);
afterEach(reset);

it("rejects a keyless outbox deletion insertion before importing any vault data", async () => {
  const { recoveryCode, backup } = await fixture();
  backup.outbox = [deletion];
  await expect(importEncryptedBackup(JSON.stringify(backup), recoveryCode)).rejects.toThrow("무결성");
  await expectEmptyStores();
  expect((await getSyncSnapshot()).pending).toBe(0);
});

it("rejects deletion injection even if the file is downgraded to legacy v1", async () => {
  const { recoveryCode, backup } = await fixture();
  backup.version = 1;
  delete backup.authentication;
  backup.outbox = [deletion];
  await expect(importEncryptedBackup(JSON.stringify(backup), recoveryCode)).rejects.toThrow("삭제");
  await expectEmptyStores();
  expect(await listEntries()).toEqual([]);
});

it.each([
  ["entry revision", (b: Backup) => { b.entries[0].revision++; }],
  ["entry sync state", (b: Backup) => { b.entries[0].syncState = "synced"; }],
  ["outbox base revision", (b: Backup) => { b.outbox[0].baseRevision++; }],
  ["outbox operation ID", (b: Backup) => { b.outbox[0].operationId = deletion.operationId; }],
  ["outbox status", (b: Backup) => { b.outbox[0].status = "conflict"; }],
  ["outbox removal", (b: Backup) => { b.outbox = []; }],
  ["entry removal", (b: Backup) => { b.entries = []; }],
  ["export time", (b: Backup) => { b.exportedAt = "2026-01-01T00:00:00Z"; }],
  ["cursor", (b: Backup) => { b.serverCursor = 99; }],
  ["unknown manifest field", (b: Backup) => { Object.assign(b, { unexpected: true }); }],
  ["missing authentication", (b: Backup) => { Reflect.deleteProperty(b, "authentication"); }],
  ["authentication algorithm", (b: Backup) => { Object.assign(b.authentication, { algorithm: "none" }); }],
  ["authentication tag", (b: Backup) => { b.authentication.tag = "A".repeat(43) + "="; }],
] as const)("rejects tampering with %s", async (_name, mutate) => {
  const { recoveryCode, backup } = await fixture();
  mutate(backup);
  await expect(importEncryptedBackup(JSON.stringify(backup), recoveryCode)).rejects.toThrow("무결성");
  await expectEmptyStores();
});

it("accepts JSON whitespace and object key reordering without changing array order", async () => {
  const { recoveryCode, backup } = await fixture();
  const reordered = JSON.stringify(backup, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).reverse()) : value, 2);
  await importEncryptedBackup(reordered, recoveryCode);
  expect(await listEntries()).toEqual([entry]);
});

it("authenticates the order of entries and operations", async () => {
  await saveEntry(entry);
  await saveEntry({ ...entry, id: "018f91f0-776b-7c8a-80d8-82455b095678" });
  const { recoveryCode } = await createRecoveryKit();
  const original = JSON.parse((await createEncryptedBackup()).json) as Backup;
  await reset();
  for (const field of ["entries", "outbox"] as const) {
    const changed = structuredClone(original);
    changed[field].reverse();
    await expect(importEncryptedBackup(JSON.stringify(changed), recoveryCode)).rejects.toThrow("무결성");
    await expectEmptyStores();
  }
});

it.each([false, true])("preserves authenticated deletions and their pending/conflict state (conflict=%s)", async (conflict) => {
  const { recoveryCode } = await createRecoveryKit();
  await saveEntry(entry);
  await deleteEntry(entry.id);
  const pending = await listPendingSyncOperations();
  const deleted = pending.find((op) => op.changeType === "delete")!;
  if (conflict) await markSyncOperationConflict(deleted.operationId, "synthetic conflict");
  const backup = await createEncryptedBackup();
  const before = JSON.parse(backup.json) as Backup;
  expect(before.outbox.some((op) => op.changeType === "delete")).toBe(true);
  await reset();
  const result = await importEncryptedBackup(backup.json, recoveryCode);
  expect(result).toMatchObject(conflict ? { pending: 0, conflicts: 2 } : { pending: 2, conflicts: 0 });
  const db = await openVaultDatabase();
  try {
    const operations = await requestToPromise(db.transaction("sync-outbox").objectStore("sync-outbox").getAll());
    expect(operations.map(serializeOperation)).toEqual(before.outbox);
  } finally { db.close(); }
  expect(await listEntries()).toEqual([]);
});

it("does not alter an existing vault when rejecting a tampered backup", async () => {
  const { recoveryCode, backup } = await fixture();
  await saveEntry({ ...entry, text: "existing local record" });
  const before = await listEntries();
  backup.outbox = [deletion];
  await expect(importEncryptedBackup(JSON.stringify(backup), recoveryCode)).rejects.toThrow("무결성");
  expect(await listEntries()).toEqual(before);
});

it("rejects both pending and conflicting deletions in a legacy backup without modifying it", async () => {
  for (const status of ["pending", "conflict"]) {
    const backup = structuredClone(legacyBackupV1);
    backup.outbox = [{ ...deletion, status }] as typeof backup.outbox;
    const json = JSON.stringify(backup);
    await expect(importEncryptedBackup(json, legacyRecoveryCode)).rejects.toThrow("삭제");
    expect(JSON.stringify(backup)).toBe(json);
    await expectEmptyStores();
  }
});

it("restores a legacy backup without deletions and migrates it by exporting v2", async () => {
  await importEncryptedBackup(JSON.stringify(legacyBackupV1), legacyRecoveryCode);
  const entries = await listEntries();
  const migrated = await createEncryptedBackup();
  expect(JSON.parse(migrated.json).version).toBe(2);
  await reset();
  await importEncryptedBackup(migrated.json, legacyRecoveryCode);
  expect(await listEntries()).toEqual(entries);
});

it("verifies a committed v2 fixture authenticated independently using Python cryptography", async () => {
  await importEncryptedBackup(JSON.stringify(backupV2), legacyRecoveryCode);
  expect((await listEntries())[0].text).toBe("Miroven backup v1 compatibility fixture");
});

it("retains individual ciphertext validation for legacy backups", async () => {
  const backup = structuredClone(legacyBackupV1);
  backup.entries[0].ciphertext = "B" + backup.entries[0].ciphertext.slice(1);
  await expect(importEncryptedBackup(JSON.stringify(backup), legacyRecoveryCode)).rejects.toThrow("무결성");
  await expectEmptyStores();
});

it("authenticates an empty vault backup", async () => {
  const { recoveryCode } = await createRecoveryKit();
  const backup = await createEncryptedBackup();
  await reset();
  expect(await importEncryptedBackup(backup.json, recoveryCode)).toEqual({ entries: 0, pending: 0, conflicts: 0 });
});
