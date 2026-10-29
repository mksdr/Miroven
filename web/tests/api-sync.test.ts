import { describe, expect, it, vi } from "vitest";
import { pairedDevices, MockRemoteSyncServer, VirtualDevice } from "./helpers/sync";
import { SYNC_META_STORE } from "../app/lib/vault/contracts";
import { requestToPromise, transactionDone, withVaultDatabase } from "../app/lib/vault/idb";
import { acknowledgeSyncOperation, getSyncSnapshot, listEntries, listPendingSyncOperations, markSyncOperationConflict, saveEntry, deleteEntry } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { ApiError } from "../app/lib/remote/client";
import type { JournalSyncTransport, RemoteSyncBatchItem } from "../app/lib/remote/journal-sync-transport";
import { applyRemoteSyncChange, purgeLocalVaultData, createEncryptedBackup, importEncryptedBackup } from "../app/lib/local-vault";

const entry = (text: string) => ({ id: crypto.randomUUID(), text, createdAt: new Date().toISOString() });
function httpLike(server: MockRemoteSyncServer, scope = "api|owner") {
  let frozen: RemoteSyncBatchItem[] = [];
  let head = 0;
  const transport: JournalSyncTransport = {
    scopeKey: scope,
    pushOperation: (user, op) => server.pushOperation(user, op),
    listChangesAfter: (cursor, limit, user) => server.listChangesAfter(typeof cursor === "number" ? cursor : Number(cursor.slice(1)), limit, user),
    async readPage(cursor) {
      const rows = await server.listChangesAfter(cursor ? Number(cursor.slice(1)) : 0, 100, "owner");
      return { items: rows.map(row => ({ ...row, change: { ...row.change, serverCursor: `c${row.change.serverCursor}` } })),
        nextCursor: `c${server.changes.length}`, hasMore: false };
    },
    async readSnapshot(cursor) {
      if (!cursor) {
        const rows = await server.listChangesAfter(0, 1000, "owner");
        frozen = [...new Map(rows.map(row => [row.change.entryId, row])).values()];
        head = server.changes.length;
      }
      const offset = Number(cursor ?? 0);
      return { items: frozen.slice(offset, offset + 1).map(row => ({ ...row, change: { ...row.change, serverCursor: `c${row.change.serverCursor}` } })),
        nextCursor: offset + 1 < frozen.length ? String(offset + 1) : null, resumeCursor: `c${head}` };
    },
  };
  return transport;
}

describe("HTTP cursor and atomic snapshot reconciliation", () => {
  it.each([50, "signed-cursor"])("exports cursor %s as numeric zero without changing the source vault", async cursor => {
    const { a } = await pairedDevices();
    await a.run(async () => {
      await withVaultDatabase(async db => {
        const tx = db.transaction(SYNC_META_STORE, "readwrite");
        tx.objectStore(SYNC_META_STORE).put(cursor, "server-cursor");
        await transactionDone(tx);
      });
      const backup = await createEncryptedBackup();
      expect(JSON.parse(backup.json).serverCursor).toBe(0);
      expect((await getSyncSnapshot()).cursor).toBe(cursor);
    });
  });

  it("restores legacy nonzero cursors with bootstrap and preserves imported work across snapshot failure", async () => {
    const { a, b, recoveryCode } = await pairedDevices();
    const c = new VirtualDevice("restored-backup");
    const server = new MockRemoteSyncServer();
    const shared = entry("already synchronized");
    const offline = entry("unsent backup record");
    const remote = entry("server record missing from backup");
    await a.run(async () => {
      await saveEntry(shared);
      await synchronizeJournal("owner", httpLike(server));
      await saveEntry(offline);
      await saveEntry({ ...shared, text: "conflicted backup edit" });
      const operation = (await listPendingSyncOperations()).find(op => op.entryId === shared.id)!;
      await markSyncOperationConflict(operation.operationId, "synthetic backup conflict");
    });
    const backup = JSON.parse((await a.run(createEncryptedBackup)).json);
    // Exercise the legacy import contract, rather than tampering with a v2 manifest.
    backup.version = 1;
    delete backup.authentication;
    backup.serverCursor = 50;
    await b.run(async () => {
      await saveEntry(remote);
      await synchronizeJournal("owner", httpLike(server));
    });
    await c.run(async () => {
      await importEncryptedBackup(JSON.stringify(backup), recoveryCode);
      expect((await getSyncSnapshot()).cursor).toBe(0);
      const bootstrap = await withVaultDatabase(db =>
        requestToPromise(db.transaction(SYNC_META_STORE).objectStore(SYNC_META_STORE).get("needs-bootstrap")));
      expect(bootstrap).toBe(true);
      const before = await listEntries();
      const operations = await listPendingSyncOperations();
      expect(operations).toHaveLength(1);
      expect((await getSyncSnapshot()).conflicts).toBe(1);
      const interrupted = httpLike(server);
      const snapshot = interrupted.readSnapshot!;
      interrupted.readSnapshot = async cursor => {
        if (cursor) throw new Error("snapshot interrupted");
        return snapshot(cursor);
      };
      await expect(synchronizeJournal("owner", interrupted)).rejects.toThrow("snapshot interrupted");
      expect(await listEntries()).toEqual(before);
      expect(await listPendingSyncOperations()).toEqual(operations);
      expect((await getSyncSnapshot()).cursor).toBe(0);
      expect((await getSyncSnapshot()).conflicts).toBe(1);

      const transport = httpLike(server);
      const readSnapshot = vi.spyOn(transport, "readSnapshot");
      const readPage = vi.spyOn(transport, "readPage");
      await synchronizeJournal("owner", transport);
      expect(readSnapshot).toHaveBeenCalledTimes(2);
      expect(readSnapshot.mock.invocationCallOrder.at(-1)).toBeLessThan(readPage.mock.invocationCallOrder[0]);
      expect(readPage).toHaveBeenCalledWith("c2");
      expect(new Set((await listEntries()).map(record => record.id))).toEqual(new Set([shared.id, offline.id, remote.id]));
      expect((await getSyncSnapshot()).cursor).toBe("c3");
      expect((await getSyncSnapshot()).conflicts).toBe(1);
      expect((await listEntries()).find(record => record.id === shared.id)?.text).toBe("conflicted backup edit");
      expect(await listPendingSyncOperations()).toEqual([]);
    });
  });

  it("exports a signed cursor as authenticated backup v2 and bootstraps safely after import", async () => {
    const { a, b, recoveryCode } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    const record = entry("portable backup");
    await a.run(async () => { await saveEntry(record); await synchronizeJournal("owner", httpLike(server)); });
    const backup = await a.run(createEncryptedBackup);
    await b.run(async () => {
      await purgeLocalVaultData();
      await importEncryptedBackup(backup.json, recoveryCode);
      expect(await listEntries()).toEqual([record]);
      await synchronizeJournal("owner", httpLike(server));
      expect(await listEntries()).toEqual([record]);
      expect((await getSyncSnapshot()).cursor).toBe("c1");
    });
  });
  it("rejects a delayed pull after the local vault is cleared", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    await a.run(async () => { await saveEntry(entry("old response")); await synchronizeJournal("owner", httpLike(server)); });
    await b.run(() => synchronizeJournal("owner", httpLike(server)));
    const [item] = (await httpLike(server).readPage!()).items;
    await b.run(purgeLocalVaultData);
    await expect(b.run(() => applyRemoteSyncChange(item.change, item.blob, "api|owner"))).rejects.toThrow();
    expect(await b.run(listEntries)).toEqual([]);
  });
  it("re-publishes previously acknowledged local data to an empty new API", async () => {
    const { a, b } = await pairedDevices();
    const record = entry("preserved from the previous backend");
    await a.run(async () => { await saveEntry(record); await acknowledgeSyncOperation((await listPendingSyncOperations())[0]); });
    const server = new MockRemoteSyncServer();
    await a.run(() => synchronizeJournal("owner", httpLike(server)));
    await b.run(() => synchronizeJournal("owner", httpLike(server)));
    expect(await b.run(listEntries)).toEqual([record]);
    expect((await a.run(getSyncSnapshot)).cursor).toBe("c1");
  });
  it("keeps the Outbox and visible records unchanged after a later snapshot page fails", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    await a.run(async () => { await saveEntry(entry("remote one")); await saveEntry(entry("remote two")); await synchronizeJournal("owner", httpLike(server)); });
    const local = entry("offline draft must survive");
    await b.run(() => saveEntry(local));
    const before = await b.run(listPendingSyncOperations);
    const transport = httpLike(server);
    const snapshot = transport.readSnapshot!;
    transport.readSnapshot = async cursor => { if (cursor) throw new Error("network interrupted"); return snapshot(cursor); };
    await expect(b.run(() => synchronizeJournal("owner", transport))).rejects.toThrow("network interrupted");
    expect(await b.run(listEntries)).toEqual([local]);
    expect(await b.run(listPendingSyncOperations)).toEqual(before);
    expect((await b.run(getSyncSnapshot)).cursor).toBe(0);
    await b.run(() => synchronizeJournal("owner", httpLike(server)));
    expect(await b.run(listEntries)).toHaveLength(3);
  });
  it("refuses another API/account without sending this vault's records", async () => {
    const { a } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    await a.run(async () => { await saveEntry(entry("private")); await synchronizeJournal("owner", httpLike(server)); });
    await expect(a.run(() => synchronizeJournal("owner", httpLike(server, "other-api|other-account")))).rejects.toThrow("다른 API·계정");
    expect(server.changes).toHaveLength(1);
  });
  it("recovers an expired cursor without silently discarding an offline edit", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    const record = entry("initial");
    await a.run(async () => { await saveEntry(record); await synchronizeJournal("owner", httpLike(server)); });
    await b.run(() => synchronizeJournal("owner", httpLike(server)));
    await b.run(() => saveEntry({ ...record, text: "offline edit" }));
    await a.run(async () => { await deleteEntry(record.id); await synchronizeJournal("owner", httpLike(server)); });
    const transport = httpLike(server);
    transport.readPage = async () => { throw new ApiError(410, "cursor_expired", "expired"); };
    await b.run(() => synchronizeJournal("owner", transport));
    expect((await b.run(listEntries))[0].text).toBe("offline edit");
    expect((await b.run(getSyncSnapshot)).conflicts).toBeGreaterThan(0);
    expect((await b.run(getSyncSnapshot)).conflictEntryIds).toEqual([record.id]);
  });
});
