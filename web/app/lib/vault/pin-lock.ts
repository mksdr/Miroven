import {
  DEVICE_KEY_ID,
  KEY_STORE,
  PIN_FAILURE_META_ID,
  PIN_LOCK_KEY_ID,
} from "./contracts";
import { getDeviceKey } from "./device-key";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import type { PinLockEnvelope } from "./types";

const MAX_FAILED_ATTEMPTS = 5;

export const MIN_PIN_LENGTH = 4;
export const RECOMMENDED_MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 8;

export function isValidPinFormat(pin: string): boolean {
  return typeof pin === "string" && /^\d{4,8}$/.test(pin);
}

export function isRecommendedPinLength(pin: string): boolean {
  return typeof pin === "string" && /^\d{6,8}$/.test(pin);
}

type PinFailureMeta = {
  failedAttempts: number;
  lockoutUntil: number;
};

export async function getPinLockoutRemainingSeconds(): Promise<number> {
  try {
    return await withVaultDatabase(async (database) => {
      const transaction = database.transaction(KEY_STORE, "readonly");
      const meta = (await requestToPromise(
        transaction.objectStore(KEY_STORE).get(PIN_FAILURE_META_ID),
      )) as PinFailureMeta | undefined;

      if (!meta?.lockoutUntil) return 0;
      const now = Date.now();
      return now >= meta.lockoutUntil ? 0 : Math.ceil((meta.lockoutUntil - now) / 1000);
    });
  } catch {
    return 0;
  }
}

async function recordPinFailure(): Promise<number> {
  try {
    return await withVaultDatabase(async (database) => {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      const store = transaction.objectStore(KEY_STORE);
      const existing = (await requestToPromise(
        store.get(PIN_FAILURE_META_ID),
      )) as PinFailureMeta | undefined;

      const currentAttempts = (existing?.failedAttempts ?? 0) + 1;
      let lockoutUntil = existing?.lockoutUntil ?? 0;
      if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
        const backoffSeconds =
          currentAttempts === 5
            ? 30
            : currentAttempts === 6
              ? 60
              : currentAttempts === 7
                ? 120
                : 300;
        lockoutUntil = Date.now() + backoffSeconds * 1000;
      }

      store.put({ failedAttempts: currentAttempts, lockoutUntil }, PIN_FAILURE_META_ID);
      await transactionDone(transaction);
      return currentAttempts;
    });
  } catch {
    return 0;
  }
}

export async function clearPinFailures(): Promise<void> {
  try {
    await withVaultDatabase(async (database) => {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      transaction.objectStore(KEY_STORE).delete(PIN_FAILURE_META_ID);
      await transactionDone(transaction);
    });
  } catch {
    // PIN failure metadata is best-effort cleanup.
  }
}

async function derivePinWrappingKey(
  pin: string,
  salt: ArrayBuffer,
  iterations = 300000,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey", "encrypt", "decrypt"],
  );
}

export async function hasPinLock(): Promise<boolean> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readonly");
    return Boolean(
      await requestToPromise(transaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID)),
    );
  });
}

export async function isVaultLocked(): Promise<boolean> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const store = transaction.objectStore(KEY_STORE);
    const pinEnvelope = await requestToPromise(store.get(PIN_LOCK_KEY_ID));
    if (!pinEnvelope) return false;
    const deviceKey = await requestToPromise(store.get(DEVICE_KEY_ID));
    return !(deviceKey instanceof CryptoKey);
  });
}

export async function setupPinLock(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN은 4~8자리의 숫자만 가능합니다.");
  }
  await withVaultDatabase(async (database) => {
    const deviceKey = await getDeviceKey(database);
    const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
    const iv = crypto.getRandomValues(new Uint8Array(12)).buffer;
    const iterations = 300000;
    const pinWrappingKey = await derivePinWrappingKey(pin, salt, iterations);
    const wrappedKey = await crypto.subtle.wrapKey(
      "raw",
      deviceKey,
      pinWrappingKey,
      { name: "AES-GCM", iv },
    );
    const envelope: PinLockEnvelope = { salt, iv, wrappedKey, iterations };
    const transaction = database.transaction(KEY_STORE, "readwrite");
    const store = transaction.objectStore(KEY_STORE);
    store.put(envelope, PIN_LOCK_KEY_ID);
    store.delete(DEVICE_KEY_ID);
    await transactionDone(transaction);
    await clearPinFailures();
  });
}

export async function unlockVaultWithPin(pin: string): Promise<boolean> {
  if ((await getPinLockoutRemainingSeconds()) > 0) return false;
  if (!isValidPinFormat(pin)) return false;
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const envelope = (await requestToPromise(
      transaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID),
    )) as PinLockEnvelope | undefined;
    if (!envelope) return false;

    const pinWrappingKey = await derivePinWrappingKey(
      pin,
      envelope.salt,
      envelope.iterations || 100000,
    );
    let unwrappedDeviceKey: CryptoKey;
    try {
      unwrappedDeviceKey = await crypto.subtle.unwrapKey(
        "raw",
        envelope.wrappedKey,
        pinWrappingKey,
        { name: "AES-GCM", iv: envelope.iv },
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      );
    } catch {
      void recordPinFailure();
      return false;
    }

    const writeTransaction = database.transaction(KEY_STORE, "readwrite");
    writeTransaction.objectStore(KEY_STORE).put(unwrappedDeviceKey, DEVICE_KEY_ID);
    await transactionDone(writeTransaction);
    void clearPinFailures();
    return true;
  });
}

export async function removePinLock(currentPin: string): Promise<boolean> {
  if (!(await unlockVaultWithPin(currentPin))) return false;
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).delete(PIN_LOCK_KEY_ID);
    await transactionDone(transaction);
    void clearPinFailures();
    return true;
  });
}

export async function lockDeviceKey(): Promise<void> {
  if (!(await hasPinLock())) return;
  await withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).delete(DEVICE_KEY_ID);
    await transactionDone(transaction);
  });
}
