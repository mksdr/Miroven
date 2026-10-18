import { describe, expect, it } from "vitest";
import { pairedDevices, MockRemoteSyncServer } from "./helpers/sync";
import { acknowledgeSyncOperation, getSyncSnapshot, listEntries, listPendingSyncOperations, saveEntry, deleteEntry } from "../app/lib/local-vault";
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
  it("exports a signed cursor as backup v1 and bootstraps safely after import", async () => {
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
