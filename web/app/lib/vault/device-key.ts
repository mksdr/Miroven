import { DEVICE_KEY_ID, KEY_STORE, PIN_LOCK_KEY_ID } from "./contracts";
import { requestToPromise, transactionDone } from "./idb";
import { readKeySession } from "./key-session";
import type { PinLockEnvelope } from "./types";

export async function getStoredDeviceKey(
  database: IDBDatabase,
): Promise<CryptoKey | null> {
  // A legacy persisted key never unlocks a PIN vault. Retain it until a verified
  // PIN proves it matches the envelope, so migration cannot erase the only key.
  const transaction = database.transaction(KEY_STORE, "readonly");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(KEY_STORE);
  const [pin, existing] = await Promise.all([
    requestToPromise(store.get(PIN_LOCK_KEY_ID)) as Promise<PinLockEnvelope | undefined>,
    requestToPromise(store.get(DEVICE_KEY_ID)),
  ]);
  await done;
  if (pin) return readKeySession(pin);
  return existing instanceof CryptoKey ? existing : null;
}

export async function getDeviceKey(database: IDBDatabase): Promise<CryptoKey> {
  const existing = await getStoredDeviceKey(database);
  if (existing) return existing;

  const pinCheckTransaction = database.transaction(KEY_STORE, "readonly");
  const pinEnvelope = await requestToPromise(
    pinCheckTransaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID),
  );
  if (pinEnvelope) {
    throw new Error("로컬 금고가 잠겨 있습니다. PIN을 입력해 금고를 해제해 주세요.");
  }

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
  const transaction = database.transaction(KEY_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(KEY_STORE);
  const [pin, current] = await Promise.all([
    requestToPromise(store.get(PIN_LOCK_KEY_ID)),
    requestToPromise(store.get(DEVICE_KEY_ID)),
  ]);
  if (pin) {
    await done;
    throw new Error("로컬 금고가 잠겨 있습니다. PIN을 입력해 금고를 해제해 주세요.");
  }
  if (!(current instanceof CryptoKey)) store.put(key, DEVICE_KEY_ID);
  await done;
  return current instanceof CryptoKey ? current : key;
}
