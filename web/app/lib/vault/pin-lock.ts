import {
  DEVICE_KEY_ID,
  KEY_STORE,
  PIN_FAILURE_META_ID,
  PIN_LOCK_KEY_ID,
} from "./contracts";
import { getDeviceKey, getStoredDeviceKey } from "./device-key";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import type { PinLockEnvelope } from "./types";
import { withVaultLock } from "./mutation-lock";
import { keySessionGeneration, pinIdentity, rememberKeySession, revokeKeySession } from "./key-session";
import { equalBuffer } from "./codec";

export class LegacyPinKeyMismatchError extends Error {
  constructor() {
    super("기존 금고 키와 PIN 설정이 일치하지 않습니다. 브라우저 데이터를 지우지 말고 원본과 복구 코드를 보관해 주세요.");
    this.name = "LegacyPinKeyMismatchError";
  }
}

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
    return !(await getStoredDeviceKey(database));
  });
}

export async function setupPinLock(pin: string): Promise<void> {
  if (!isValidPinFormat(pin)) {
    throw new Error("PIN은 4~8자리의 숫자만 가능합니다.");
  }
  await withVaultLock("mutation", () => withVaultDatabase(async (database) => {
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
    revokeKeySession({ broadcast: true });
    await clearPinFailures();
  }));
}

export async function unlockVaultWithPin(pin: string): Promise<boolean> {
  const generation = keySessionGeneration();
  return withVaultLock("mutation", async () => {
    const unlocked = await unwrapPinKey(pin);
    if (!unlocked) return false;
    await clearPinFailures();
    if (generation !== keySessionGeneration()) return false;
    rememberKeySession(unlocked.key, unlocked.envelope);
    return true;
  });
}

// Call only while holding the mutation lock; removePinLock shares this path.
async function unwrapPinKey(pin: string): Promise<{ key: CryptoKey; envelope: PinLockEnvelope } | null> {
  if ((await getPinLockoutRemainingSeconds()) > 0) return null;
  if (!isValidPinFormat(pin)) return null;
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const envelope = (await requestToPromise(
      transaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID),
    )) as PinLockEnvelope | undefined;
    if (!envelope) return null;

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
      await recordPinFailure();
      return null;
    }

    const legacyTransaction = database.transaction(KEY_STORE, "readonly");
    const legacyKey = await requestToPromise(legacyTransaction.objectStore(KEY_STORE).get(DEVICE_KEY_ID));
    if (legacyKey instanceof CryptoKey) {
      const [legacy, unwrapped] = await Promise.all([
        crypto.subtle.exportKey("raw", legacyKey),
        crypto.subtle.exportKey("raw", unwrappedDeviceKey),
      ]);
      try {
        if (!equalBuffer(legacy, unwrapped)) {
          revokeKeySession({ broadcast: true });
          throw new LegacyPinKeyMismatchError();
        }
      } finally {
        new Uint8Array(legacy).fill(0);
        new Uint8Array(unwrapped).fill(0);
      }
    }

    const writeTransaction = database.transaction(KEY_STORE, "readwrite");
    const done = transactionDone(writeTransaction);
    const store = writeTransaction.objectStore(KEY_STORE);
    const current = await requestToPromise(store.get(PIN_LOCK_KEY_ID)) as PinLockEnvelope | undefined;
    if (!current || pinIdentity(current) !== pinIdentity(envelope)) {
      await done;
      return null;
    }
    store.delete(DEVICE_KEY_ID);
    await done;
    return { key: unwrappedDeviceKey, envelope };
  });
}

export async function removePinLock(currentPin: string): Promise<boolean> {
  const generation = keySessionGeneration();
  return withVaultLock("mutation", async () => {
    const unlocked = await unwrapPinKey(currentPin);
    if (!unlocked || generation !== keySessionGeneration()) return false;
    return withVaultDatabase(async (database) => {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore(KEY_STORE);
      const current = await requestToPromise(store.get(PIN_LOCK_KEY_ID)) as PinLockEnvelope | undefined;
      if (!current || pinIdentity(current) !== pinIdentity(unlocked.envelope)
        || generation !== keySessionGeneration()) {
        await done;
        return false;
      }
      store.put(unlocked.key, DEVICE_KEY_ID);
      store.delete(PIN_LOCK_KEY_ID);
      await done;
      revokeKeySession({ broadcast: true, notify: false });
      await clearPinFailures();
      return true;
    });
  });
}

export async function lockDeviceKey(): Promise<void> {
  // Revoke immediately, including while a slow PIN derivation holds the mutation lock.
  revokeKeySession({ broadcast: true });
  // An unverified legacy key may be the only usable copy. Only unwrapPinKey's
  // verified migration removes it; updated unlocks never persist one.
}
