import {
  DEVICE_KEY_ID,
  ENTRY_STORE,
  KEY_STORE,
  OUTBOX_STORE,
  PIN_LOCK_KEY_ID,
  VAULT_ENVELOPE_ID,
  VAULT_FORMAT_CONTRACT,
  VAULT_STORE,
} from "./contracts";
import {
  requestToPromise,
  transactionDone,
  withVaultDatabase,
} from "./idb";
import { expectBufferLength, toArrayBuffer } from "./codec";
import { getDeviceKey } from "./device-key";
import { withVaultLock } from "./mutation-lock";
import { decryptEntry, encryptEntry } from "./entry-crypto";
import { createUpsertOperation } from "./sync-crypto";
import type {
  StoredEntry,
  StoredVaultEnvelope,
  VaultEnvelope,
} from "./types";

export const RECOVERY_FORMAT = VAULT_FORMAT_CONTRACT.recoveryFormat;
export const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_SECRET_BYTES = 25;
export const RECOVERY_SECRET_CHARACTERS = 40;
export const RECOVERY_AAD = new TextEncoder().encode(
  VAULT_FORMAT_CONTRACT.recoveryAad,
);
export const RECOVERY_INFO = new TextEncoder().encode(
  VAULT_FORMAT_CONTRACT.recoveryInfo,
);

export class RecoveryPinLockError extends Error {
  readonly code = "PIN_LOCK_CONFIGURED";

  constructor() {
    super("복구 코드를 생성하려면 계정 설정에서 PIN 잠금을 먼저 해제해 주세요. 생성 후 PIN 잠금을 다시 설정할 수 있습니다.");
    this.name = "RecoveryPinLockError";
  }
}

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += RECOVERY_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += RECOVERY_ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

export function base32Decode(value: string): Uint8Array {
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value) {
    const index = RECOVERY_ALPHABET.indexOf(character);
    if (index < 0) throw new Error("복구 코드 형식이 올바르지 않습니다.");
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((buffer >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export async function recoveryChecksum(secret: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(secret));
  return base32Encode(new Uint8Array(digest)).slice(0, 2);
}

export async function formatRecoveryCode(secret: Uint8Array): Promise<string> {
  const encoded = base32Encode(secret);
  const groups = encoded.match(/.{1,5}/g) ?? [encoded];
  return `${groups.join("-")}-${await recoveryChecksum(secret)}`;
}

export async function parseRecoveryCode(recoveryCode: string): Promise<Uint8Array> {
  const normalized = recoveryCode.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (normalized.length !== RECOVERY_SECRET_CHARACTERS + 2) {
    throw new Error("복구 코드 길이가 올바르지 않습니다.");
  }
  const encodedSecret = normalized.slice(0, RECOVERY_SECRET_CHARACTERS);
  const suppliedChecksum = normalized.slice(RECOVERY_SECRET_CHARACTERS);
  const secret = base32Decode(encodedSecret);
  if (secret.byteLength !== RECOVERY_SECRET_BYTES) {
    throw new Error("복구 코드 형식이 올바르지 않습니다.");
  }
  if ((await recoveryChecksum(secret)) !== suppliedChecksum) {
    throw new Error("복구 코드의 철자를 확인해 주세요.");
  }
  return secret;
}

export async function deriveRecoveryKey(
  recoverySecret: Uint8Array,
  recoverySalt: ArrayBuffer,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(recoverySecret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: recoverySalt,
      info: toArrayBuffer(RECOVERY_INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function unwrapVaultKey(
  envelope: VaultEnvelope,
  recoveryCode: string,
): Promise<CryptoKey> {
  if (
    envelope.recoveryFormat !== RECOVERY_FORMAT ||
    envelope.cryptoVersion !== 1 ||
    envelope.keyVersion !== 1
  ) {
    throw new Error("지원하지 않는 금고 복구 형식입니다.");
  }
  expectBufferLength(envelope.recoverySalt, 16, "복구 salt");
  expectBufferLength(envelope.wrappingNonce, 12, "금고 nonce");
  expectBufferLength(envelope.wrappedVaultKey, 48, "암호화된 금고 키");

  const recoverySecret = await parseRecoveryCode(recoveryCode);
  const recoveryKey = await deriveRecoveryKey(recoverySecret, envelope.recoverySalt);
  let rawVaultKey: ArrayBuffer;
  try {
    rawVaultKey = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelope.wrappingNonce,
        additionalData: toArrayBuffer(RECOVERY_AAD),
      },
      recoveryKey,
      envelope.wrappedVaultKey,
    );
  } catch {
    throw new Error("복구 코드가 일치하지 않거나 백업이 손상되었습니다.");
  } finally {
    recoverySecret.fill(0);
  }
  if (rawVaultKey.byteLength !== 32) throw new Error("금고 키 형식이 올바르지 않습니다.");
  try {
    return await crypto.subtle.importKey(
      "raw",
      rawVaultKey,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    );
  } finally {
    new Uint8Array(rawVaultKey).fill(0);
  }
}

export async function getLocalVaultEnvelope(): Promise<VaultEnvelope | null> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(VAULT_STORE, "readonly");
    const stored = (await requestToPromise(
      transaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID),
    )) as StoredVaultEnvelope | undefined;
    if (!stored) return null;
    return {
      wrappedVaultKey: stored.wrappedVaultKey,
      wrappingNonce: stored.wrappingNonce,
      recoverySalt: stored.recoverySalt,
      recoveryFormat: stored.recoveryFormat,
      cryptoVersion: stored.cryptoVersion,
      keyVersion: stored.keyVersion,
    };
  });
}

export async function createRecoveryKit(): Promise<{
  recoveryCode: string;
  envelope: VaultEnvelope;
}> {
  return withVaultLock("mutation", () => withVaultDatabase(async (database) => {
    const envelopeTransaction = database.transaction([KEY_STORE, VAULT_STORE], "readonly");
    const [pinEnvelope, existingEnvelope] = await Promise.all([
      requestToPromise(envelopeTransaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID)),
      requestToPromise(envelopeTransaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID)),
    ]);
    if (pinEnvelope) throw new RecoveryPinLockError();
    if (existingEnvelope) throw new Error("이 금고에는 이미 복구 코드가 있습니다.");

    const previousKey = await getDeviceKey(database);
    const readTransaction = database.transaction(ENTRY_STORE, "readonly");
    const records = (await requestToPromise(
      readTransaction.objectStore(ENTRY_STORE).getAll(),
    )) as StoredEntry[];
    const plaintextEntries = await Promise.all(
      records.map((record) => decryptEntry(previousKey, record)),
    );

    const recoverySecret = crypto.getRandomValues(
      new Uint8Array(RECOVERY_SECRET_BYTES),
    );
    const recoveryCode = await formatRecoveryCode(recoverySecret);
    const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
    const wrappingNonce = crypto.getRandomValues(new Uint8Array(12));
    const rawVaultKey = crypto.getRandomValues(new Uint8Array(32));
    const recoveryKey = await deriveRecoveryKey(
      recoverySecret,
      toArrayBuffer(recoverySalt),
    );
    const wrappedVaultKey = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: wrappingNonce,
        additionalData: toArrayBuffer(RECOVERY_AAD),
      },
      recoveryKey,
      toArrayBuffer(rawVaultKey),
    );
    const vaultKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(rawVaultKey),
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    );
    rawVaultKey.fill(0);
    recoverySecret.fill(0);

    const [reencryptedEntries, syncOperations] = await Promise.all([
      Promise.all(plaintextEntries.map((entry) => encryptEntry(vaultKey, entry, 3))),
      Promise.all(plaintextEntries.map((entry) => createUpsertOperation(vaultKey, entry))),
    ]);
    for (const record of reencryptedEntries) {
      record.revision = 1;
      record.syncState = "pending";
    }
    const envelope: VaultEnvelope = {
      wrappedVaultKey,
      wrappingNonce: toArrayBuffer(wrappingNonce),
      recoverySalt: toArrayBuffer(recoverySalt),
      recoveryFormat: RECOVERY_FORMAT,
      cryptoVersion: 1,
      keyVersion: 1,
    };
    const writeTransaction = database.transaction(
      [ENTRY_STORE, KEY_STORE, VAULT_STORE, OUTBOX_STORE],
      "readwrite",
    );
    const done = transactionDone(writeTransaction);
    try {
      // Recheck in the same transaction as the replacement, including when a
      // different context does not participate in the Web Locks protocol.
      const [currentPin, currentEnvelope] = await Promise.all([
        requestToPromise(writeTransaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID)),
        requestToPromise(writeTransaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID)),
      ]);
      if (currentPin) throw new RecoveryPinLockError();
      if (currentEnvelope) throw new Error("이 금고에는 이미 복구 코드가 있습니다.");
      const entryStore = writeTransaction.objectStore(ENTRY_STORE);
      for (const record of reencryptedEntries) entryStore.put(record);
      const outboxStore = writeTransaction.objectStore(OUTBOX_STORE);
      for (const operation of syncOperations) outboxStore.put(operation);
      writeTransaction.objectStore(KEY_STORE).put(vaultKey, DEVICE_KEY_ID);
      writeTransaction.objectStore(VAULT_STORE).put({
        id: VAULT_ENVELOPE_ID,
        ...envelope,
      } satisfies StoredVaultEnvelope);
      await done;
    } catch (error) {
      try { writeTransaction.abort(); } catch { /* Already finished or aborted. */ }
      await done.catch(() => undefined);
      throw error;
    }

    return { recoveryCode, envelope };
  }));
}

export async function recoverVault(
  envelope: VaultEnvelope,
  recoveryCode: string,
): Promise<void> {
  await withVaultDatabase(async (database) => {
    const readTransaction = database.transaction(ENTRY_STORE, "readonly");
    const localEntryCount = await requestToPromise(
      readTransaction.objectStore(ENTRY_STORE).count(),
    );
    if (localEntryCount > 0) {
      throw new Error("이 기기에 로컬 기록이 있어 기존 금고를 덮어쓸 수 없습니다.");
    }

    const vaultKey = await unwrapVaultKey(envelope, recoveryCode);

    const transaction = database.transaction([KEY_STORE, VAULT_STORE], "readwrite");
    const done = transactionDone(transaction);
    if (await requestToPromise(transaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID))) {
      await done;
      throw new Error("PIN 잠금을 먼저 해제한 뒤 금고를 복구해 주세요.");
    }
    transaction.objectStore(KEY_STORE).put(vaultKey, DEVICE_KEY_ID);
    transaction.objectStore(VAULT_STORE).put({
      id: VAULT_ENVELOPE_ID,
      ...envelope,
    } satisfies StoredVaultEnvelope);
    await done;
  });
}
