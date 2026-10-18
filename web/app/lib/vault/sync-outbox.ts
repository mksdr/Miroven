import { PERSONA_DOCUMENT_ID } from "../persona";
import { withVaultLock } from "./mutation-lock";
import type {
  EncryptedBlobEnvelope,
  JournalEntry,
  LocalSyncSnapshot,
  RemoteSyncChange,
  StoredEntry,
  SyncOperation,
} from "./types";
import {
  ENTRY_STORE,
  OUTBOX_STORE,
  SYNC_META_STORE,
} from "./contracts";
import {
  requestToPromise,
  transactionDone,
  withVaultDatabase,
} from "./idb";
import { getStoredDeviceKey } from "./device-key";
import {
  decryptEntry,
  encryptEntry,
} from "./entry-crypto";
import {
  createDeleteOperation,
  createUpsertOperation,
  decryptSyncBytes,
  encryptSyncBytes,
  prepareRemoteRecord,
  syncAdditionalData,
  syncDataKeyAdditionalData,
} from "./sync-crypto";

export {
  createDeleteOperation,
  createUpsertOperation,
  decryptSyncBytes,
  encryptSyncBytes,
  prepareRemoteRecord,
  syncAdditionalData,
  syncDataKeyAdditionalData,
};

export async function getSyncSnapshot(): Promise<LocalSyncSnapshot> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(
      [OUTBOX_STORE, SYNC_META_STORE],
      "readonly",
    );
    const operations = (await requestToPromise(
      transaction.objectStore(OUTBOX_STORE).getAll(),
    )) as SyncOperation[];
    const cursor = (await requestToPromise(
      transaction.objectStore(SYNC_META_STORE).get("server-cursor"),
    )) as number | string | undefined;
    return {
      pending: operations.filter((operation) => operation.status === "pending").length,
      conflicts: operations.filter((operation) => operation.status === "conflict").length,
      conflictEntryIds: [
        ...new Set(
          operations
            .filter((operation) => operation.status === "conflict")
            .map((operation) => operation.entryId),
        ),
      ],
      cursor: cursor ?? 0,
    };
  });
}

export async function listPendingSyncOperations(): Promise<SyncOperation[]> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(OUTBOX_STORE, "readonly");
    const operations = (await requestToPromise(
      transaction.objectStore(OUTBOX_STORE).getAll(),
    )) as SyncOperation[];
    return operations
      .filter((operation) => operation.status === "pending")
      .sort((left, right) => {
        if (left.entryId === right.entryId && left.revision !== right.revision) {
          return left.revision - right.revision;
        }
        return (
          left.createdAt.localeCompare(right.createdAt) ||
          left.operationId.localeCompare(right.operationId)
        );
      });
  });
}

export function acknowledgeSyncOperation(operation: SyncOperation): Promise<void> {
  return withVaultLock("mutation", () => acknowledgeSyncOperationUnlocked(operation));
}

export async function acknowledgeSyncOperationUnlocked(operation: SyncOperation): Promise<void> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(
      [OUTBOX_STORE, ENTRY_STORE],
      "readwrite",
    );
    transaction.objectStore(OUTBOX_STORE).delete(operation.operationId);
    if (operation.changeType === "upsert") {
      const entryStore = transaction.objectStore(ENTRY_STORE);
      const record = (await requestToPromise(entryStore.get(operation.entryId))) as
        | StoredEntry
        | undefined;
      if (record && (record.revision ?? 1) === operation.revision) {
        record.syncState = "synced";
        entryStore.put(record);
      }
    }
    await transactionDone(transaction);
  });
}

export function markSyncOperationConflict(operationId: string, message: string): Promise<void> {
  return withVaultLock("mutation", () => markSyncOperationConflictUnlocked(operationId, message));
}

export async function markSyncOperationConflictUnlocked(
  operationId: string,
  message: string,
): Promise<void> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(
      [OUTBOX_STORE, ENTRY_STORE],
      "readwrite",
    );
    const outbox = transaction.objectStore(OUTBOX_STORE);
    const operation = (await requestToPromise(outbox.get(operationId))) as
      | SyncOperation
      | undefined;
    if (operation) {
      operation.status = "conflict";
      operation.lastError = message;
      outbox.put(operation);
      const siblings = (await requestToPromise(outbox.getAll())) as SyncOperation[];
      for (const sibling of siblings) {
        if (sibling.entryId === operation.entryId) {
          outbox.put({ ...sibling, status: "conflict", lastError: message });
        }
      }
      const entryStore = transaction.objectStore(ENTRY_STORE);
      const record = (await requestToPromise(entryStore.get(operation.entryId))) as
        | StoredEntry
        | undefined;
      if (record) {
        record.syncState = "conflict";
        entryStore.put(record);
      }
    }
    await transactionDone(transaction);
  });
}

export function resolvePersonaConflict(useRemote: boolean): Promise<JournalEntry[]> {
  return withVaultLock("mutation", () => resolveConflict(PERSONA_DOCUMENT_ID, useRemote, { reload: false }));
}

type RemoteConflict = { revision: number; entry: StoredEntry | null };

export function applyRemoteSyncChange(
  change: RemoteSyncChange,
  encryptedBlob?: EncryptedBlobEnvelope | EncryptedBlobEnvelope[],
  expectedScope?: string,
): Promise<"applied" | "ignored" | "conflict"> {
  return withVaultLock("mutation", () => applyRemoteSyncChangeUnlocked(change, encryptedBlob, expectedScope));
}

export async function applyRemoteSyncChangeUnlocked(
  change: RemoteSyncChange,
  encryptedBlob?: EncryptedBlobEnvelope | EncryptedBlobEnvelope[],
  expectedScope?: string,
): Promise<"applied" | "ignored" | "conflict"> {
  return withVaultDatabase(async (database) => {
    const vaultKey = await getStoredDeviceKey(database);
    if (!vaultKey) throw new Error("이 기기에 금고 키가 없습니다.");

    const readTransaction = database.transaction(
      [ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE],
      "readonly",
    );
    const existing = (await requestToPromise(
      readTransaction.objectStore(ENTRY_STORE).get(change.entryId),
    )) as StoredEntry | undefined;
    const operations = (await requestToPromise(
      readTransaction.objectStore(OUTBOX_STORE).getAll(),
    )) as SyncOperation[];
    const knownRevision = (await requestToPromise(
      readTransaction.objectStore(SYNC_META_STORE).get(`revision:${change.entryId}`),
    )) as number | undefined;
    const cursor = (await requestToPromise(
      readTransaction.objectStore(SYNC_META_STORE).get("server-cursor"),
    )) as number | string | undefined;
    if (
      expectedScope &&
      (await requestToPromise(readTransaction.objectStore(SYNC_META_STORE).get("remote-scope"))) !==
        expectedScope
    ) {
      throw new Error("동기화 계정이 변경되었습니다.");
    }
    if (
      typeof change.serverCursor === "number" &&
      typeof (cursor ?? 0) === "number" &&
      change.serverCursor <= Number(cursor ?? 0)
    ) {
      return "ignored";
    }
    if (typeof change.serverCursor === "string" && change.serverCursor === cursor) {
      return "ignored";
    }
    const localOperation = operations
      .sort((left, right) => left.revision - right.revision)
      .find((operation) => operation.entryId === change.entryId);

    const hasConflict = Boolean(
      localOperation &&
        localOperation.operationId !== change.operationId &&
        change.revision > localOperation.baseRevision,
    );
    const currentRevision = Math.max(existing?.revision ?? 0, knownRevision ?? 0);
    const storedRemoteEntry = await prepareRemoteRecord(vaultKey, change, encryptedBlob);
    const transaction = database.transaction(
      [ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE],
      "readwrite",
    );
    const metaStore = transaction.objectStore(SYNC_META_STORE);
    metaStore.put(change.serverCursor, "server-cursor");

    if (hasConflict) {
      const outbox = transaction.objectStore(OUTBOX_STORE);
      for (const operation of operations.filter((op) => op.entryId === change.entryId)) {
        outbox.put({
          ...operation,
          status: "conflict",
          lastError: "다른 기기에서 같은 기록이 먼저 변경되었습니다.",
        });
      }
      metaStore.put(
        { revision: change.revision, entry: storedRemoteEntry } satisfies RemoteConflict,
        `conflict:${change.entryId}`,
      );
      if (existing) {
        existing.syncState = "conflict";
        transaction.objectStore(ENTRY_STORE).put(existing);
      }
      await transactionDone(transaction);
      return "conflict";
    }

    if (currentRevision > change.revision) {
      await transactionDone(transaction);
      return "ignored";
    }

    metaStore.put(Math.max(currentRevision, change.revision), `revision:${change.entryId}`);
    const entryStore = transaction.objectStore(ENTRY_STORE);
    if (change.changeType === "delete") {
      entryStore.delete(change.entryId);
    } else if (storedRemoteEntry) {
      entryStore.put(storedRemoteEntry);
    }
    await transactionDone(transaction);
    return "applied";
  });
}

export type EntryLoader = (options?: { lowSpecMode?: boolean; signal?: AbortSignal }) => Promise<JournalEntry[]>;

let defaultEntryLoader: EntryLoader | null = null;

export function registerEntryLoader(loader: EntryLoader): void {
  defaultEntryLoader = loader;
}

async function loadEntriesDirectly(): Promise<JournalEntry[]> {
  return withVaultDatabase(async (database) => {
    const key = await getStoredDeviceKey(database);
    if (!key) return [];
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    const records = (await requestToPromise(
      transaction.objectStore(ENTRY_STORE).getAll(),
    )) as StoredEntry[];
    const entries = await Promise.all(records.map((record) => decryptEntry(key, record)));
    return entries.sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
    );
  });
}

export function resolveConflictUseLocal(
  entryId: string,
  options: { reload?: boolean } = {},
  entryLoader?: EntryLoader,
): Promise<JournalEntry[]> {
  return withVaultLock("mutation", () => resolveConflict(entryId, false, options, entryLoader));
}

export function resolveConflictKeepBoth(
  entryId: string,
  options: { reload?: boolean } = {},
  entryLoader?: EntryLoader,
): Promise<JournalEntry[]> {
  return withVaultLock("mutation", () => resolveConflict(entryId, true, options, entryLoader));
}

export async function resolveConflict(
  entryId: string,
  keepBoth: boolean,
  options: { reload?: boolean },
  entryLoader?: EntryLoader,
): Promise<JournalEntry[]> {
  return withVaultDatabase(async (database) => {
    const key = await getStoredDeviceKey(database);
    if (!key) throw new Error("이 기기에 금고 키가 없습니다.");
    const read = database.transaction([ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE], "readonly");
    const [record, allOperations, remote] = await Promise.all([
      requestToPromise(read.objectStore(ENTRY_STORE).get(entryId)) as Promise<StoredEntry | undefined>,
      requestToPromise(read.objectStore(OUTBOX_STORE).getAll()) as Promise<SyncOperation[]>,
      requestToPromise(read.objectStore(SYNC_META_STORE).get(`conflict:${entryId}`)) as Promise<
        RemoteConflict | undefined
      >,
    ]);
    const operations = allOperations.filter((op) => op.entryId === entryId);
    if (!operations.some((op) => op.status === "conflict")) {
      if (options.reload === false) return [];
      const loader = entryLoader ?? defaultEntryLoader ?? loadEntriesDirectly;
      return loader();
    }
    if (!remote) throw new Error("충돌한 원격 기록을 먼저 동기화한 뒤 다시 해결해 주세요.");
    const baseRevision = remote.revision;
    let nextRecord: StoredEntry | undefined;
    let nextOperation: SyncOperation | undefined;
    // A persona is a singleton: accepting the remote version must never make a journal copy.
    if (keepBoth && record && entryId !== PERSONA_DOCUMENT_ID) {
      const local = await decryptEntry(key, record);
      const copy = {
        ...local,
        id: crypto.randomUUID(),
        text: `${local.text} (사본)`,
        createdAt: new Date().toISOString(),
        pinnedAt: undefined,
      };
      nextRecord = await encryptEntry(key, copy);
      nextRecord.revision = 1;
      nextRecord.syncState = "pending";
      nextOperation = await createUpsertOperation(key, copy, 1, 0);
    } else if (!keepBoth) {
      if (record) {
        const local = await decryptEntry(key, record);
        nextOperation = await createUpsertOperation(key, local, baseRevision + 1, baseRevision);
        nextRecord = { ...record, revision: baseRevision + 1, syncState: "pending" };
      } else {
        nextOperation = createDeleteOperation(entryId, baseRevision + 1, baseRevision);
      }
    }
    // Copy creation, original restoration, and outbox replacement commit together.
    const write = database.transaction([ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE], "readwrite");
    const entries = write.objectStore(ENTRY_STORE);
    const outbox = write.objectStore(OUTBOX_STORE);
    const meta = write.objectStore(SYNC_META_STORE);
    for (const operation of operations) outbox.delete(operation.operationId);
    if (keepBoth) {
      if (remote.entry) entries.put(remote.entry);
      else entries.delete(entryId);
      meta.put(remote.revision, `revision:${entryId}`);
    }
    if (nextRecord) entries.put(nextRecord);
    if (nextOperation) {
      outbox.put(nextOperation);
      meta.put(nextOperation.revision, `revision:${nextOperation.entryId}`);
    }
    meta.delete(`conflict:${entryId}`);
    await transactionDone(write);
    if (options.reload === false) return [];
    const loader = entryLoader ?? defaultEntryLoader ?? loadEntriesDirectly;
    return loader();
  });
}
