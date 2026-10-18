import { DEVICE_KEY_ID, KEY_STORE, PIN_LOCK_KEY_ID } from "./contracts";
import { requestToPromise, transactionDone } from "./idb";

export async function getStoredDeviceKey(
  database: IDBDatabase,
): Promise<CryptoKey | null> {
  const transaction = database.transaction(KEY_STORE, "readonly");
  const existing = await requestToPromise(
    transaction.objectStore(KEY_STORE).get(DEVICE_KEY_ID),
  );
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
  transaction.objectStore(KEY_STORE).put(key, DEVICE_KEY_ID);
  await transactionDone(transaction);
  return key;
}
