import { PERSONA_DOCUMENT_ID } from "../persona";
import { getStoredDeviceKey } from "./device-key";
import {
  requestToPromise,
  transactionDone,
  withVaultDatabase,
} from "./idb";
import {
  base64ToBuffer,
  bufferToBase64,
  deserializeSyncEnvelope,
  expectBufferLength,
  expectNonNegativeInteger,
  expectPositiveInteger,
  expectString,
  isObject,
  serializeSyncEnvelope,
} from "./codec";
import {
  DEVICE_KEY_ID,
  ENCRYPTED_BACKUP_ACCEPT,
  ENCRYPTED_BACKUP_MAX_BYTES,
  ENTRY_STORE,
  KEY_STORE,
  OUTBOX_STORE,
  PIN_LOCK_KEY_ID,
  SYNC_META_STORE,
  VAULT_ENVELOPE_ID,
  VAULT_FORMAT_CONTRACT,
  VAULT_STORE,
} from "./contracts";
import {
  RECOVERY_FORMAT,
  unwrapVaultKey,
} from "./recovery";
import { decryptEntry } from "./entry-crypto";
import { prepareRemoteRecord } from "./sync-crypto";
import type {
  EncryptedBackupExport,
  EncryptedBackupImportResult,
  EncryptedBackupV1,
  EncryptedBlobEnvelope,
  JournalEntry,
  SerializedSyncOperation,
  StoredEntry,
  StoredVaultEnvelope,
  SyncOperation,
  VaultEnvelope,
} from "./types";

export const BACKUP_FORMAT = VAULT_FORMAT_CONTRACT.backupFormat;
export { ENCRYPTED_BACKUP_ACCEPT, ENCRYPTED_BACKUP_MAX_BYTES };

export function parseBackupEnvelope(value: unknown): VaultEnvelope {
  if (
    !isObject(value) ||
    value.recoveryFormat !== RECOVERY_FORMAT ||
    value.cryptoVersion !== 1 ||
    value.keyVersion !== 1
  ) {
    throw new Error("지원하지 않는 백업 금고 형식입니다.");
  }
  return {
    wrappedVaultKey: expectBufferLength(
      base64ToBuffer(value.wrappedVaultKey, "암호화된 금고 키"),
      48,
      "암호화된 금고 키",
    ),
    wrappingNonce: expectBufferLength(
      base64ToBuffer(value.wrappingNonce, "금고 nonce"),
      12,
      "금고 nonce",
    ),
    recoverySalt: expectBufferLength(
      base64ToBuffer(value.recoverySalt, "복구 salt"),
      16,
      "복구 salt",
    ),
    recoveryFormat: RECOVERY_FORMAT,
    cryptoVersion: 1,
    keyVersion: 1,
  };
}

export function parseBackupEntry(value: unknown, index: number): StoredEntry {
  const label = `백업 기록 ${index + 1}`;
  if (!isObject(value) || value.cryptoVersion !== 3) {
    throw new Error(`${label}의 암호화 버전을 지원하지 않습니다.`);
  }
  const syncState = value.syncState;
  if (
    syncState !== "local" &&
    syncState !== "pending" &&
    syncState !== "synced" &&
    syncState !== "conflict"
  ) {
    throw new Error(`${label}의 동기화 상태가 올바르지 않습니다.`);
  }
  const ciphertext = base64ToBuffer(value.ciphertext, `${label} 암호문`);
  if (ciphertext.byteLength < 17) throw new Error(`${label} 암호문이 너무 짧습니다.`);
  return {
    id: expectString(value.id, `${label} ID`),
    iv: expectBufferLength(
      base64ToBuffer(value.iv, `${label} nonce`),
      12,
      `${label} nonce`,
    ),
    ciphertext,
    wrappedDataKey: expectBufferLength(
      base64ToBuffer(value.wrappedDataKey, `${label} 데이터 키`),
      48,
      `${label} 데이터 키`,
    ),
    keyNonce: expectBufferLength(
      base64ToBuffer(value.keyNonce, `${label} 키 nonce`),
      12,
      `${label} 키 nonce`,
    ),
    cryptoVersion: 3,
    revision: expectPositiveInteger(value.revision, `${label} revision`),
    syncState,
  };
}

export function parseBackupOperation(value: unknown, index: number): SyncOperation {
  const label = `백업 동기화 작업 ${index + 1}`;
  if (!isObject(value)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  if (value.attachmentVersion !== undefined && value.attachmentVersion !== 2) {
    throw new Error(`${label} 사진 형식을 지원하지 않습니다.`);
  }
  const changeType = value.changeType;
  const status = value.status;
  if (changeType !== "upsert" && changeType !== "delete") {
    throw new Error(`${label} 변경 종류가 올바르지 않습니다.`);
  }
  if (status !== "pending" && status !== "conflict") {
    throw new Error(`${label} 상태가 올바르지 않습니다.`);
  }
  const payload =
    value.payload === undefined
      ? undefined
      : deserializeSyncEnvelope(value.payload, `${label} 본문`);
  let blob: EncryptedBlobEnvelope | undefined;
  if (value.blob !== undefined) {
    if (!isObject(value.blob)) throw new Error(`${label} 사진 형식이 올바르지 않습니다.`);
    blob = {
      id: expectString(value.blob.id, `${label} 사진 ID`),
      ...deserializeSyncEnvelope(value.blob, `${label} 사진`),
    };
  }
  let blobs: EncryptedBlobEnvelope[] | undefined;
  if (value.blobs !== undefined) {
    if (
      !Array.isArray(value.blobs) ||
      value.blobs.length > 4 ||
      blob ||
      value.attachmentVersion !== 2
    ) {
      throw new Error(`${label} 사진 목록이 올바르지 않습니다.`);
    }
    blobs = value.blobs.map((item) => {
      if (!isObject(item)) throw new Error(`${label} 사진 형식이 올바르지 않습니다.`);
      return {
        id: expectString(item.id, `${label} 사진 ID`),
        ...deserializeSyncEnvelope(item, `${label} 사진`),
      };
    });
    if (new Set(blobs.map((item) => item.id)).size !== blobs.length) {
      throw new Error(`${label} 사진 ID가 중복됩니다.`);
    }
  }
  if (changeType === "upsert" && !payload) {
    throw new Error(`${label}에 본문 암호문이 없습니다.`);
  }
  if (changeType === "delete" && (payload || blob || blobs?.length)) {
    throw new Error(`${label} 삭제 형식이 올바르지 않습니다.`);
  }
  return {
    operationId: expectString(value.operationId, `${label} operation ID`),
    entryId: expectString(value.entryId, `${label} entry ID`),
    baseRevision: expectNonNegativeInteger(value.baseRevision, `${label} base revision`),
    revision: expectPositiveInteger(value.revision, `${label} revision`),
    changeType,
    ...(payload ? { payload } : {}),
    ...(blob ? { blob } : {}),
    ...(blobs ? { blobs, attachmentVersion: 2 as const } : {}),
    ...(value.attachmentVersion === 2 ? { attachmentVersion: 2 as const } : {}),
    createdAt: expectString(value.createdAt, `${label} 생성 시각`),
    status,
    ...(status === "conflict"
      ? { lastError: "가져온 백업에 충돌 작업이 보존되어 있습니다." }
      : {}),
  };
}

export function serializeOperation(operation: SyncOperation): SerializedSyncOperation {
  return {
    operationId: operation.operationId,
    entryId: operation.entryId,
    baseRevision: operation.baseRevision,
    revision: operation.revision,
    changeType: operation.changeType,
    ...(operation.payload ? { payload: serializeSyncEnvelope(operation.payload) } : {}),
    ...(operation.attachmentVersion === 2 ? { attachmentVersion: 2 as const } : {}),
    ...(operation.blob
      ? { blob: { id: operation.blob.id, ...serializeSyncEnvelope(operation.blob) } }
      : {}),
    ...(operation.blobs
      ? {
          blobs: operation.blobs.map((blob) => ({
            id: blob.id,
            ...serializeSyncEnvelope(blob),
          })),
          attachmentVersion: 2 as const,
        }
      : {}),
    createdAt: operation.createdAt,
    status: operation.status,
  };
}

export async function validateBackupContents(
  vaultKey: CryptoKey,
  entries: StoredEntry[],
  operations: SyncOperation[],
): Promise<void> {
  const entryIds = new Set<string>();
  for (const record of entries) {
    if (entryIds.has(record.id)) throw new Error("백업에 중복된 기록 ID가 있습니다.");
    entryIds.add(record.id);
    let entry: JournalEntry;
    try {
      entry = await decryptEntry(vaultKey, record);
    } catch {
      throw new Error("백업 기록의 무결성을 확인하지 못했습니다.");
    }
    if (entry.id !== record.id || typeof entry.text !== "string") {
      throw new Error("백업 기록의 내용과 ID가 일치하지 않습니다.");
    }
  }

  const operationIds = new Set<string>();
  for (const operation of operations) {
    if (operationIds.has(operation.operationId)) {
      throw new Error("백업에 중복된 동기화 작업 ID가 있습니다.");
    }
    operationIds.add(operation.operationId);
    if (operation.changeType === "delete") continue;
    try {
      await prepareRemoteRecord(
        vaultKey,
        {
          serverCursor: 0,
          operationId: operation.operationId,
          entryId: operation.entryId,
          baseRevision: operation.baseRevision,
          revision: operation.revision,
          changeType: operation.changeType,
          payload: operation.payload,
        },
        operation.blobs ?? operation.blob,
      );
    } catch {
      throw new Error("백업 동기화 작업의 무결성을 확인하지 못했습니다.");
    }
  }
}

export async function createEncryptedBackup(): Promise<EncryptedBackupExport> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(
      [ENTRY_STORE, KEY_STORE, VAULT_STORE, OUTBOX_STORE],
      "readonly",
    );
    const entryRequest = transaction.objectStore(ENTRY_STORE).getAll();
    const keyRequest = getStoredDeviceKey(database);
    const envelopeRequest = transaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID);
    const outboxRequest = transaction.objectStore(OUTBOX_STORE).getAll();
    const [entryValues, keyValue, envelopeValue, outboxValues] =
      await Promise.all([
        requestToPromise(entryRequest),
        keyRequest,
        requestToPromise(envelopeRequest),
        requestToPromise(outboxRequest),
      ]);
    const entries = entryValues as StoredEntry[];
    const vaultKey = keyValue instanceof CryptoKey ? keyValue : null;
    const envelope = envelopeValue as StoredVaultEnvelope | undefined;
    const operations = outboxValues as SyncOperation[];
    if (!envelope || !vaultKey) {
      throw new Error("복구 코드를 만든 뒤 암호화 백업을 내보낼 수 있습니다.");
    }
    if (
      entries.some(
        (entry) =>
          entry.cryptoVersion !== 3 || !entry.wrappedDataKey || !entry.keyNonce,
      )
    ) {
      throw new Error("이전 형식의 기록이 있어 백업을 만들 수 없습니다.");
    }
    await validateBackupContents(vaultKey, entries, operations);

    const backup: EncryptedBackupV1 = {
      format: BACKUP_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      vault: {
        wrappedVaultKey: bufferToBase64(envelope.wrappedVaultKey),
        wrappingNonce: bufferToBase64(envelope.wrappingNonce),
        recoverySalt: bufferToBase64(envelope.recoverySalt),
        recoveryFormat: RECOVERY_FORMAT,
        cryptoVersion: 1,
        keyVersion: 1,
      },
      entries: entries.map((entry) => ({
        id: entry.id,
        iv: bufferToBase64(entry.iv),
        ciphertext: bufferToBase64(entry.ciphertext),
        wrappedDataKey: bufferToBase64(entry.wrappedDataKey!),
        keyNonce: bufferToBase64(entry.keyNonce!),
        cryptoVersion: 3,
        revision: entry.revision ?? 1,
        syncState: entry.syncState,
      })),
      outbox: operations.map(serializeOperation),
      serverCursor: 0,
    };
    const json = JSON.stringify(backup);
    if (new Blob([json]).size > ENCRYPTED_BACKUP_MAX_BYTES) {
      throw new Error("암호화 백업이 100MB를 넘어 한 파일로 내보낼 수 없습니다.");
    }
    const date = new Date().toISOString().slice(0, 10);
    return {
      json,
      filename: `miroven-${date}.miroven-backup.json`,
      entryCount: entries.filter((entry) => entry.id !== PERSONA_DOCUMENT_ID).length,
    };
  });
}

export async function importEncryptedBackup(
  json: string,
  recoveryCode: string,
): Promise<EncryptedBackupImportResult> {
  if (new Blob([json]).size > ENCRYPTED_BACKUP_MAX_BYTES) {
    throw new Error("100MB 이하의 암호화 백업만 가져올 수 있습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("백업 파일을 읽을 수 없습니다.");
  }
  if (
    !isObject(parsed) ||
    parsed.format !== BACKUP_FORMAT ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.entries) ||
    !Array.isArray(parsed.outbox)
  ) {
    throw new Error("지원하지 않는 암호화 백업 파일입니다.");
  }
  if (parsed.entries.length > 100_000 || parsed.outbox.length > 100_000) {
    throw new Error("백업 항목 수가 허용 범위를 넘었습니다.");
  }
  const envelope = parseBackupEnvelope(parsed.vault);
  const entries = parsed.entries.map(parseBackupEntry);
  const operations = parsed.outbox.map(parseBackupOperation);
  // Accept legacy numeric cursors, but never reuse another device's pull position.
  expectNonNegativeInteger(parsed.serverCursor, "서버 cursor");
  const vaultKey = await unwrapVaultKey(envelope, recoveryCode);
  await validateBackupContents(vaultKey, entries, operations);

  return withVaultDatabase(async (database) => {
    const checkTransaction = database.transaction(
      [ENTRY_STORE, VAULT_STORE, OUTBOX_STORE, SYNC_META_STORE],
      "readonly",
    );
    const entryCountRequest = checkTransaction.objectStore(ENTRY_STORE).count();
    const envelopeRequest = checkTransaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID);
    const outboxCountRequest = checkTransaction.objectStore(OUTBOX_STORE).count();
    const cursorRequest = checkTransaction.objectStore(SYNC_META_STORE).get("server-cursor");
    const [entryCount, existingEnvelope, outboxCount, existingCursor] = await Promise.all([
      requestToPromise(entryCountRequest),
      requestToPromise(envelopeRequest),
      requestToPromise(outboxCountRequest),
      requestToPromise(cursorRequest),
    ]);
    if (entryCount > 0 || existingEnvelope || outboxCount > 0 || existingCursor !== undefined) {
      throw new Error("이 기기에 기존 금고 데이터가 있어 백업을 덮어쓸 수 없습니다.");
    }

    const writeTransaction = database.transaction(
      [ENTRY_STORE, KEY_STORE, VAULT_STORE, OUTBOX_STORE, SYNC_META_STORE],
      "readwrite",
    );
    const done = transactionDone(writeTransaction);
    if (await requestToPromise(writeTransaction.objectStore(KEY_STORE).get(PIN_LOCK_KEY_ID))) {
      await done;
      throw new Error("PIN 잠금을 먼저 해제한 뒤 빈 금고에 백업을 가져와 주세요.");
    }
    const entryStore = writeTransaction.objectStore(ENTRY_STORE);
    for (const entry of entries) entryStore.put(entry);
    writeTransaction.objectStore(KEY_STORE).put(vaultKey, DEVICE_KEY_ID);
    writeTransaction.objectStore(VAULT_STORE).put({
      id: VAULT_ENVELOPE_ID,
      ...envelope,
    } satisfies StoredVaultEnvelope);
    const outboxStore = writeTransaction.objectStore(OUTBOX_STORE);
    for (const operation of operations) outboxStore.put(operation);
    const metaStore = writeTransaction.objectStore(SYNC_META_STORE);
    metaStore.put(0, "server-cursor");
    metaStore.put(true, "needs-bootstrap");
    await done;

    return {
      entries: entries.filter((entry) => entry.id !== PERSONA_DOCUMENT_ID).length,
      pending: operations.filter((operation) => operation.status === "pending").length,
      conflicts: operations.filter((operation) => operation.status === "conflict").length,
    };
  });
}
