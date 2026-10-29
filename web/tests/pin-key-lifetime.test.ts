import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openVaultDatabase, requestToPromise } from "../app/lib/vault/idb";
import { DEVICE_KEY_ID, KEY_STORE } from "../app/lib/vault/contracts";

async function reset() {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase("private-journal");
    r.onsuccess = () => resolve(); r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("Database still open"));
  });
}
beforeEach(async () => { vi.resetModules(); await reset(); });
afterEach(async () => { vi.restoreAllMocks(); await reset(); });
const entry = { id: "018f91f0-776b-7c8a-80d8-82455b091234", text: "synthetic PIN lifetime entry", createdAt: "2026-10-29T00:00:00Z" };

it("does not persist an unlocked PIN key and requires PIN in a fresh module context", async () => {
  const vault = await import("../app/lib/local-vault");
  await vault.saveEntry(entry); await vault.setupPinLock("654321");
  expect(await vault.unlockVaultWithPin("654321")).toBe(true);
  expect(await vault.listEntries()).toEqual([entry]);
  const db = await openVaultDatabase();
  try {
    expect(await requestToPromise(db.transaction(KEY_STORE).objectStore(KEY_STORE).get(DEVICE_KEY_ID))).toBeUndefined();
  } finally { db.close(); }
  vi.resetModules();
  const fresh = await import("../app/lib/local-vault");
  expect(await fresh.isVaultLocked()).toBe(true);
  await expect(fresh.listEntries()).rejects.toThrow("잠겨");
  expect(await fresh.unlockVaultWithPin("654321")).toBe(true);
  expect(await fresh.listEntries()).toEqual([entry]);
});

async function rawKey() {
  const db = await openVaultDatabase();
  try { return await requestToPromise(db.transaction(KEY_STORE).objectStore(KEY_STORE).get(DEVICE_KEY_ID)); }
  finally { db.close(); }
}

it("ignores a legacy persisted key and removes it after PIN verification without changing ciphertext", async () => {
  const vault = await import("../app/lib/local-vault");
  await vault.saveEntry(entry);
  const legacyKey = await rawKey();
  await vault.setupPinLock("654321");
  const { PIN_LOCK_KEY_ID, ENTRY_STORE } = await import("../app/lib/vault/contracts");
  const { transactionDone } = await import("../app/lib/vault/idb");
  const db = await openVaultDatabase();
  let envelope: unknown;
  let ciphertext: unknown;
  try {
    envelope = await requestToPromise(db.transaction(KEY_STORE).objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID));
    ciphertext = await requestToPromise(db.transaction(ENTRY_STORE).objectStore(ENTRY_STORE).getAll());
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(legacyKey, DEVICE_KEY_ID);
    await transactionDone(tx);
  } finally { db.close(); }
  vi.resetModules();
  const fresh = await import("../app/lib/local-vault");
  expect(await fresh.isVaultLocked()).toBe(true);
  expect(await rawKey()).toBeInstanceOf(CryptoKey);
  await expect(fresh.listEntries()).rejects.toThrow("잠겨");
  const check = await openVaultDatabase();
  try {
    expect(await requestToPromise(check.transaction(KEY_STORE).objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID))).toEqual(envelope);
    expect(await requestToPromise(check.transaction(ENTRY_STORE).objectStore(ENTRY_STORE).getAll())).toEqual(ciphertext);
  } finally { check.close(); }
  expect(await fresh.unlockVaultWithPin("654321")).toBe(true);
  expect(await rawKey()).toBeUndefined();
  expect(await fresh.listEntries()).toEqual([entry]);
});

it("only persists the key when the correct PIN removes its envelope", async () => {
  const vault = await import("../app/lib/local-vault");
  await vault.saveEntry(entry); await vault.setupPinLock("654321");
  expect(await vault.removePinLock("000000")).toBe(false);
  expect(await rawKey()).toBeUndefined();
  expect(await vault.hasPinLock()).toBe(true);
  expect(await vault.removePinLock("654321")).toBe(true);
  expect(await rawKey()).toBeInstanceOf(CryptoKey);
  expect(await vault.hasPinLock()).toBe(false);
  vi.resetModules();
  expect(await (await import("../app/lib/local-vault")).listEntries()).toEqual([entry]);
});

it("a lock during slow PIN derivation prevents the pending unlock from restoring the session", async () => {
  const vault = await import("../app/lib/local-vault");
  await vault.saveEntry(entry); await vault.setupPinLock("654321");
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const original = crypto.subtle.deriveKey.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "deriveKey").mockImplementationOnce(async (...args) => {
    entered(); await gate; return original(...args);
  });
  const unlocking = vault.unlockVaultWithPin("654321");
  await started;
  const locking = vault.lockDeviceKey();
  release();
  expect(await unlocking).toBe(false);
  await locking;
  expect(await vault.isVaultLocked()).toBe(true);
  expect(await rawKey()).toBeUndefined();
});

it("changing the PIN invalidates the previous session and keeps entries readable with the new PIN", async () => {
  const vault = await import("../app/lib/local-vault");
  await vault.saveEntry(entry); await vault.setupPinLock("654321");
  expect(await vault.unlockVaultWithPin("654321")).toBe(true);
  await vault.setupPinLock("123456");
  expect(await vault.isVaultLocked()).toBe(true);
  expect(await vault.unlockVaultWithPin("654321")).toBe(false);
  expect(await vault.unlockVaultWithPin("123456")).toBe(true);
  expect(await vault.listEntries()).toEqual([entry]);
  expect(await rawKey()).toBeUndefined();
});

it("backup import and recovery do not persist a new key underneath an existing PIN", async () => {
  const vault = await import("../app/lib/local-vault");
  const kit = await vault.createRecoveryKit();
  const backup = await vault.createEncryptedBackup();
  await vault.purgeLocalVaultData();
  await vault.setupPinLock("654321");
  await expect(vault.importEncryptedBackup(backup.json, kit.recoveryCode)).rejects.toThrow("PIN");
  await expect(vault.recoverVault(kit.envelope, kit.recoveryCode)).rejects.toThrow("PIN");
  expect(await rawKey()).toBeUndefined();
  expect(await vault.hasPinLock()).toBe(true);
});

it("revokes memory sessions when local data is purged", async () => {
  const vault = await import("../app/lib/local-vault");
  await vault.saveEntry(entry); await vault.setupPinLock("654321");
  expect(await vault.unlockVaultWithPin("654321")).toBe(true);
  await vault.purgeLocalVaultData();
  expect(await vault.listEntries()).toEqual([]);
  expect(await vault.hasPinLock()).toBe(false);
});

it("preserves an inconsistent legacy key instead of silently deleting its only copy", async () => {
  const vault = await import("../app/lib/local-vault");
  const { transactionDone } = await import("../app/lib/vault/idb");
  await vault.saveEntry(entry); await vault.setupPinLock("654321");
  const otherKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const db = await openVaultDatabase();
  try {
    const tx = db.transaction(KEY_STORE, "readwrite");
    tx.objectStore(KEY_STORE).put(otherKey, DEVICE_KEY_ID);
    await transactionDone(tx);
  } finally { db.close(); }
  await expect(vault.unlockVaultWithPin("654321")).rejects.toBeInstanceOf(vault.LegacyPinKeyMismatchError);
  expect(await rawKey()).toBeInstanceOf(CryptoKey);
  await vault.lockDeviceKey();
  expect(await rawKey()).toBeInstanceOf(CryptoKey);
  expect(await vault.isVaultLocked()).toBe(true);
});
