import { ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE, STAGE_STORE } from "./contracts";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import { withVaultLock } from "./mutation-lock";
import { getStoredDeviceKey } from "./device-key";
import { decryptEntry } from "./entry-crypto";
import { createDeleteOperation, createUpsertOperation, prepareRemoteRecord } from "./sync-crypto";
import type { RemoteSyncBatchItem } from "../remote/journal-sync-transport";
import type { StoredEntry, SyncOperation } from "./types";

type Stage = { id: string; revision: number; operationId: string; entry: StoredEntry | null };

export async function bindRemoteScope(scope: string): Promise<boolean> {
  return withVaultLock("mutation", () =>
    withVaultDatabase(async (db) => {
      const tx = db.transaction(SYNC_META_STORE, "readwrite");
      const store = tx.objectStore(SYNC_META_STORE);
      const existing = await requestToPromise(store.get("remote-scope"));
      if (existing && existing !== scope) {
        throw new Error("이 로컬 금고는 다른 API·계정에 연결되어 있습니다. 백업 후 로그아웃하고 로컬 금고를 초기화해 주세요.");
      }
      if (!existing) {
        store.put(scope, "remote-scope");
        store.put(true, "needs-bootstrap");
      }
      const needed = Boolean(await requestToPromise(store.get("needs-bootstrap")));
      await transactionDone(tx);
      return needed;
    }),
  );
}

export async function setRemoteCursor(cursor: string, scope: string): Promise<void> {
  await withVaultLock("mutation", () =>
    withVaultDatabase(async (db) => {
      const tx = db.transaction(SYNC_META_STORE, "readwrite");
      const meta = tx.objectStore(SYNC_META_STORE);
      if ((await requestToPromise(meta.get("remote-scope"))) !== scope) {
        throw new Error("동기화 계정이 변경되었습니다.");
      }
      meta.put(cursor, "server-cursor");
      await transactionDone(tx);
    }),
  );
}

export async function beginSnapshot(): Promise<void> {
  await withVaultDatabase(async (db) => {
    const tx = db.transaction(STAGE_STORE, "readwrite");
    tx.objectStore(STAGE_STORE).clear();
    await transactionDone(tx);
  });
}

export async function stageSnapshotItem(item: RemoteSyncBatchItem, expectedScope: string): Promise<void> {
  await withVaultLock("mutation", () =>
    withVaultDatabase(async (db) => {
      const read = db.transaction(SYNC_META_STORE, "readonly");
      if ((await requestToPromise(read.objectStore(SYNC_META_STORE).get("remote-scope"))) !== expectedScope) {
        throw new Error("동기화 계정이 변경되었습니다.");
      }
      const key = await getStoredDeviceKey(db);
      if (!key) throw new Error("금고를 먼저 열어 주세요.");
      const entry = await prepareRemoteRecord(key, item.change, item.blobs ?? item.blob);
      const tx = db.transaction(STAGE_STORE, "readwrite");
      tx.objectStore(STAGE_STORE).put({
        id: item.change.entryId,
        revision: item.change.revision,
        operationId: item.change.operationId,
        entry,
      } satisfies Stage);
      await transactionDone(tx);
    }),
  );
}

export async function commitSnapshot(cursor: string, scope: string): Promise<number> {
  return withVaultLock("mutation", () =>
    withVaultDatabase(async (db) => {
      const key = await getStoredDeviceKey(db);
      if (!key) throw new Error("금고를 먼저 열어 주세요.");
      const read = db.transaction([ENTRY_STORE, OUTBOX_STORE, STAGE_STORE, SYNC_META_STORE], "readonly");
      const [local, operations, remote, bound] = await Promise.all([
        requestToPromise(read.objectStore(ENTRY_STORE).getAll()) as Promise<StoredEntry[]>,
        requestToPromise(read.objectStore(OUTBOX_STORE).getAll()) as Promise<SyncOperation[]>,
        requestToPromise(read.objectStore(STAGE_STORE).getAll()) as Promise<Stage[]>,
        requestToPromise(read.objectStore(SYNC_META_STORE).get("remote-scope")),
      ]);
      if (bound !== scope) throw new Error("동기화 계정이 변경되었습니다.");
      const records = new Map(local.map((entry) => [entry.id, entry]));
      const pending = new Map(operations.map((op) => [op.operationId, op]));
      const revisions = new Map<string, number>();
      const conflicts = new Map<string, { revision: number; entry: StoredEntry | null }>();
      const remoteIds = new Set(remote.map((row) => row.id));
      for (const row of remote) {
        const ops = operations.filter((op) => op.entryId === row.id).sort((a, b) => a.revision - b.revision);
        const record = records.get(row.id);
        const mine = ops.some((op) => op.operationId === row.operationId);
        let conflict =
          ops.some((op) => op.status === "conflict") ||
          Boolean(ops.length && !mine && row.revision !== ops[0].baseRevision);
        if (!ops.length && record && (record.revision ?? 0) >= row.revision) {
          const differs =
            !row.entry ||
            JSON.stringify(await decryptEntry(key, record)) !==
              JSON.stringify(await decryptEntry(key, row.entry));
          if (differs) {
            const operation = await createUpsertOperation(
              key,
              await decryptEntry(key, record),
              row.revision + 1,
              row.revision,
            );
            pending.set(operation.operationId, operation);
            record.revision = operation.revision;
            conflict = true;
          }
        }
        if (conflict) {
          for (const op of pending.values()) {
            if (op.entryId === row.id) {
              op.status = "conflict";
              op.lastError = "서버 변경과 로컬 변경을 확인해 주세요.";
            }
          }
          if (record) record.syncState = "conflict";
          conflicts.set(row.id, { revision: row.revision, entry: row.entry });
        } else if (!ops.length) {
          if (row.entry) records.set(row.id, row.entry);
          else records.delete(row.id);
        }
        revisions.set(row.id, Math.max(records.get(row.id)?.revision ?? 0, row.revision));
      }
      // An absent ID is not a deletion: server tombstones are explicit. Re-publish
      // records after a reset/new server; never discard local pending content.
      const missing = new Set([...local.map((row) => row.id), ...operations.map((op) => op.entryId)]);
      for (const id of missing) {
        if (remoteIds.has(id)) continue;
        const ops = operations.filter((op) => op.entryId === id).sort((a, b) => a.revision - b.revision);
        const record = records.get(id);
        if (ops.length && ops[0].baseRevision === 0 && ops.every((op) => op.status === "pending")) {
          revisions.set(id, record?.revision ?? ops.at(-1)!.revision);
          continue;
        }
        const next = record
          ? await createUpsertOperation(key, await decryptEntry(key, record), 1, 0)
          : createDeleteOperation(id, 1, 0);
        for (const op of ops) pending.delete(op.operationId);
        pending.set(next.operationId, next);
        if (record) {
          record.revision = 1;
          record.syncState = "pending";
        }
        revisions.set(id, 1);
      }
      const write = db.transaction([ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE, STAGE_STORE], "readwrite");
      write.objectStore(ENTRY_STORE).clear();
      for (const record of records.values()) write.objectStore(ENTRY_STORE).put(record);
      write.objectStore(OUTBOX_STORE).clear();
      for (const op of pending.values()) write.objectStore(OUTBOX_STORE).put(op);
      const meta = write.objectStore(SYNC_META_STORE);
      meta.clear();
      meta.put(scope, "remote-scope");
      meta.put(cursor, "server-cursor");
      for (const [id, revision] of revisions) meta.put(revision, `revision:${id}`);
      for (const [id, conflict] of conflicts) meta.put(conflict, `conflict:${id}`);
      write.objectStore(STAGE_STORE).clear();
      await transactionDone(write);
      return remote.length + local.filter((row) => !remoteIds.has(row.id)).length;
    }),
  );
}
