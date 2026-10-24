import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEncryptedBackup, createRecoveryKit, getLocalVaultEnvelope, importEncryptedBackup,
  isVaultLocked, listEntries, lockDeviceKey, removePinLock, saveEntry, setupPinLock,
  unlockVaultWithPin,
} from "../app/lib/local-vault";
import { KEY_STORE, DEVICE_KEY_ID, PIN_LOCK_KEY_ID, VAULT_STORE, VAULT_DATABASE_CONTRACT } from "../app/lib/vault/contracts";
import { requestToPromise, transactionDone, withVaultDatabase } from "../app/lib/vault/idb";

const PIN = "123456";
const ENTRY = {
  id: "018f91f0-776b-7c8a-80d8-82455b091234",
  text: "Synthetic recovery/PIN regression",
  createdAt: "2026-10-24T00:00:00.000Z",
  image: { dataUrl: "data:image/png;base64,AQID", width: 1, height: 1, mimeType: "image/png" },
};

async function resetDatabase() {
  await requestToPromise(indexedDB.deleteDatabase(VAULT_DATABASE_CONTRACT.name));
}

async function snapshot() {
  return withVaultDatabase(async (database) => {
    const stores = Array.from(database.objectStoreNames);
    const transaction = database.transaction(stores, "readonly");
    return Promise.all(stores.map(async (name) => {
      const store = transaction.objectStore(name);
      const [keys, values] = await Promise.all([
        requestToPromise(store.getAllKeys()), requestToPromise(store.getAll()),
      ]);
      return { name, records: keys.map((key, index) => ({
        key,
        // Check key correctness by reading entries after a fresh PIN unlock.
        value: name === KEY_STORE && key === DEVICE_KEY_ID ? "device-key" : values[index],
      })) };
    }));
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(resetDatabase);
afterEach(async () => { vi.restoreAllMocks(); await resetDatabase(); });

describe("recovery creation with PIN protection", () => {
  it.each([false, true])("rejects without changing vault data (unlocked: %s)", async (unlocked) => {
    await saveEntry(ENTRY);
    await setupPinLock(PIN);
    if (unlocked) expect(await unlockVaultWithPin(PIN)).toBe(true);
    const before = await snapshot();

    const result = await createRecoveryKit().then(() => "created", (error: unknown) =>
      error instanceof Error && "code" in error ? error.code : "other-error");
    expect(result).toBe("PIN_LOCK_CONFIGURED");

    expect(await snapshot()).toEqual(before);
    expect(await getLocalVaultEnvelope()).toBeNull();
    await lockDeviceKey();
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
  });

  it("can remove PIN, create recovery, reconfigure PIN and round-trip a backup", async () => {
    await saveEntry(ENTRY);
    await setupPinLock(PIN);
    expect(await removePinLock(PIN)).toBe(true);
    const kit = await createRecoveryKit();
    await setupPinLock(PIN);
    expect(await isVaultLocked()).toBe(true);
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
    const backup = await createEncryptedBackup();
    await resetDatabase();
    await importEncryptedBackup(backup.json, kit.recoveryCode);
    expect(await listEntries()).toEqual([ENTRY]);
  });

  it("waits for in-flight PIN setup before checking recovery eligibility", async () => {
    await saveEntry(ENTRY);
    const entered = deferred();
    const release = deferred();
    const wrapKey = crypto.subtle.wrapKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "wrapKey").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return wrapKey(...args);
    });
    const setup = setupPinLock(PIN);
    await entered.promise;
    const creation = createRecoveryKit().then(() => "created", () => "rejected");
    release.resolve();
    await setup;
    expect(await creation).toBe("rejected");
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
    expect(await getLocalVaultEnvelope()).toBeNull();
  });

  it("PIN setup waits for in-flight recovery creation and wraps the committed key", async () => {
    await saveEntry(ENTRY);
    const entered = deferred();
    const release = deferred();
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      return digest(...args);
    });
    const creation = createRecoveryKit();
    await entered.promise;
    const setup = setupPinLock(PIN);
    release.resolve();
    await Promise.all([creation, setup]);
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
    await lockDeviceKey();
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
  });

  it("rechecks a PIN envelope inserted outside the mutation lock before committing", async () => {
    await saveEntry(ENTRY);
    await setupPinLock(PIN);
    const pinEnvelope = await withVaultDatabase((database) => requestToPromise(
      database.transaction(KEY_STORE).objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID),
    ));
    expect(await removePinLock(PIN)).toBe(true);
    let before: Awaited<ReturnType<typeof snapshot>>;
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async (...args) => {
      await withVaultDatabase(async (database) => {
        const transaction = database.transaction(KEY_STORE, "readwrite");
        transaction.objectStore(KEY_STORE).put(pinEnvelope, PIN_LOCK_KEY_ID);
        await transactionDone(transaction);
      });
      before = await snapshot();
      return digest(...args);
    });
    await expect(createRecoveryKit()).rejects.toMatchObject({ code: "PIN_LOCK_CONFIGURED" });
    expect(await snapshot()).toEqual(before!);
    await lockDeviceKey();
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
  });

  it("rolls back entries, Outbox and device key if envelope storage fails", async () => {
    await saveEntry(ENTRY);
    const before = await snapshot();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === VAULT_STORE) throw new DOMException("Synthetic write failure", "QuotaExceededError");
      return put.apply(this, args);
    });
    await expect(createRecoveryKit()).rejects.toMatchObject({ name: "QuotaExceededError" });
    expect(await snapshot()).toEqual(before);
    expect(await listEntries()).toEqual([ENTRY]);
  });

  it("commits only one of two simultaneous recovery creation requests", async () => {
    await saveEntry(ENTRY);
    const results = await Promise.allSettled([createRecoveryKit(), createRecoveryKit()]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(await listEntries()).toEqual([ENTRY]);
    await setupPinLock(PIN);
    expect(await unlockVaultWithPin(PIN)).toBe(true);
    expect(await listEntries()).toEqual([ENTRY]);
  });
});
