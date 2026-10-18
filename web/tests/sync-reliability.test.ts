import { describe, expect, it } from "vitest";
import {
  applyRemoteSyncChange, cleanupExpiredTombstones, cleanupOrphanedBlobs,
  createEncryptedBackup, importEncryptedBackup, deleteEntry, getSyncSnapshot, listEntries, listPendingSyncOperations,
  resolveConflictKeepBoth, resolveConflictUseLocal, saveEntry,
  type JournalEntry, type SyncOperation,
} from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { openVaultDatabase, requestToPromise, transactionDone } from "../app/lib/vault/idb";
import { OUTBOX_STORE } from "../app/lib/vault/contracts";
import { deferred, MockRemoteSyncServer, pairedDevices, tamperBuffer, TEST_USER_ID, VirtualDevice } from "./helpers/sync";

const image = { dataUrl: "data:image/webp;base64,AQIDBA==", mimeType: "image/webp", width: 1, height: 1 };
const entry = (text = "initial"): JournalEntry => ({ id: "shared", text, createdAt: "2026-09-01T00:00:00.000Z", image });
const sync = (device: VirtualDevice, server: MockRemoteSyncServer) => device.run(() => synchronizeJournal(TEST_USER_ID, server));
const entries = (device: VirtualDevice) => device.run(async () => (await listEntries()).sort((a, b) => a.id.localeCompare(b.id)));

async function seeded() {
  const devices = await pairedDevices();
  const server = new MockRemoteSyncServer();
  await devices.a.run(() => saveEntry(entry()));
  await sync(devices.a, server);
  await sync(devices.b, server);
  return { ...devices, server };
}

describe("sync reliability regressions", () => {
  it("assigns distinct revisions to 20 concurrent edits of the same entry and converges", async () => {
    const { a, b, server } = await seeded();
    await a.run(() => Promise.all(Array.from({ length: 20 }, (_, i) => saveEntry(entry(`edit-${i}`)))));
    const operations = await a.run(() => listPendingSyncOperations());
    expect(operations.map(op => op.revision)).toEqual(Array.from({ length: 20 }, (_, i) => i + 2));
    expect(operations.map(op => op.baseRevision)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const local = await entries(a);
    expect(local).toHaveLength(1);
    expect(await sync(a, server)).toMatchObject({ pushed: 20, conflicts: 0, pending: 0 });
    await sync(b, server);
    expect(await entries(b)).toEqual(local);
    expect(server.changes).toHaveLength(21);
  });

  it("keeps async device stores isolated during genuinely overlapping saves and pushes", async () => {
    const { a, b, server } = await seeded();
    await Promise.all([a.run(() => saveEntry(entry("A"))), b.run(() => saveEntry(entry("B")))]);
    const aEntered = deferred();
    const bEntered = deferred();
    let pushes = 0;
    server.beforePush = async () => {
      if (++pushes === 1) { aEntered.resolve(); await bEntered.promise; }
      else bEntered.resolve();
    };
    const first = sync(a, server);
    await aEntered.promise;
    const results = await Promise.all([first, sync(b, server)]);
    expect(results.map(result => result.pushed).sort()).toEqual([0, 1]);
    expect((await entries(a))[0].text).toBe("A");
    expect((await entries(b))[0].text).toBe("B");
    expect(server.changes).toHaveLength(2);
    expect((await Promise.all([a.run(getSyncSnapshot), b.run(getSyncSnapshot)])).map(s => s.conflicts).sort()).toEqual([0, 1]);
  });

  it("retries an accepted push after response loss using the same operation ID", async () => {
    const { a, b, server } = await seeded();
    await a.run(() => saveEntry(entry("retry")));
    const [operation] = await a.run(listPendingSyncOperations);
    server.afterAccept = async () => { throw new Error("response lost after commit"); };
    await expect(sync(a, server)).rejects.toThrow("response lost after commit");
    expect((await a.run(listPendingSyncOperations))[0].operationId).toBe(operation.operationId);
    expect(server.changes.filter(c => c.operationId === operation.operationId)).toHaveLength(1);
    server.afterAccept = undefined;
    expect(await sync(a, server)).toMatchObject({ pushed: 1, pending: 0, conflicts: 0 });
    expect(server.changes.filter(c => c.operationId === operation.operationId)).toHaveLength(1);
    await sync(b, server);
    expect(await entries(b)).toEqual(await entries(a));
  });

  it.each(["edit", "delete"] as const)("preserves a same-entry %s made while its previous version is in flight", async kind => {
    const { a, b, server } = await seeded();
    await a.run(() => saveEntry(entry("in-flight")));
    const entered = deferred();
    const release = deferred();
    server.beforePush = async () => { entered.resolve(); await release.promise; };
    const running = sync(a, server);
    await entered.promise;
    try {
      await a.run(() => kind === "edit" ? saveEntry(entry("latest")) : deleteEntry("shared"));
    } finally { release.resolve(); }
    expect(await running).toMatchObject({ pushed: 1, pending: 1, conflicts: 0 });
    const [pending] = await a.run(listPendingSyncOperations);
    expect(pending).toMatchObject({ revision: 3, baseRevision: 2, changeType: kind === "edit" ? "upsert" : "delete" });
    server.beforePush = undefined;
    expect(await sync(a, server)).toMatchObject({ pushed: 1, pending: 0, conflicts: 0 });
    await sync(b, server);
    expect(await entries(b)).toEqual(kind === "edit" ? [entry("latest")] : []);
    expect(await entries(a)).toEqual(await entries(b));
  });

  it("serializes overlapping sync calls without duplicate uploads", async () => {
    const { a, server } = await seeded();
    await a.run(() => saveEntry(entry("next")));
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    server.beforePush = async () => { calls++; entered.resolve(); await release.promise; };
    const first = sync(a, server);
    await entered.promise;
    const second = sync(a, server);
    release.resolve();
    const results = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(results.map(result => result.pushed)).toEqual([1, 0]);
    expect(await a.run(getSyncSnapshot)).toMatchObject({ pending: 0, conflicts: 0 });
  });

  it.each(["local", "both"] as const)("resolves a multi-operation conflict with %s and converges including images", async choice => {
    const { a, b, server } = await seeded();
    await a.run(() => saveEntry(entry("A")));
    await sync(a, server);
    await b.run(async () => { await saveEntry(entry("B1")); await saveEntry(entry("B2")); });
    expect(await sync(b, server)).toMatchObject({ pushed: 0, pending: 0 });
    expect(server.changes).toHaveLength(2); // A rejected ancestor must block B's descendants.
    await b.run(() => choice === "local" ? resolveConflictUseLocal("shared") : resolveConflictKeepBoth("shared"));
    expect(await sync(b, server)).toMatchObject({ pushed: 1, pending: 0, conflicts: 0 });
    await sync(a, server);
    await sync(b, server);
    const aEntries = await entries(a);
    expect(await entries(b)).toEqual(aEntries);
    expect(aEntries.map(e => e.text).sort()).toEqual(choice === "local" ? ["B2"] : ["A", "B2 (사본)"]);
    for (const record of aEntries) expect(record.image).toEqual(image);
    expect(await b.run(getSyncSnapshot)).toMatchObject({ pending: 0, conflicts: 0 });
  });

  it("stops at corrupt data, preserves the committed prefix, and retries after repair", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    for (let i = 1; i <= 3; i++) await a.run(() => saveEntry({ ...entry(`record-${i}`), id: `entry-${i}` }));
    await sync(a, server);
    const original = structuredClone(server.changes[1].payload!);
    server.changes[1].payload!.ciphertext = tamperBuffer(original.ciphertext);
    await expect(sync(b, server)).rejects.toThrow();
    expect(await b.run(getSyncSnapshot)).toMatchObject({ cursor: 1, conflicts: 0 });
    expect(await entries(b)).toHaveLength(1);
    await expect(sync(b, server)).rejects.toThrow();
    expect(await b.run(getSyncSnapshot)).toMatchObject({ cursor: 1 });
    server.changes[1].payload = original;
    expect(await sync(b, server)).toMatchObject({ pulled: 2, conflicts: 0 });
    expect(await entries(b)).toEqual(await entries(a));
    expect(await b.run(getSyncSnapshot)).toMatchObject({ cursor: 3 });
  });

  it("preserves conflicts if pull fails before the remote version is available for resolution", async () => {
    const { a, b, server } = await seeded();
    await a.run(() => saveEntry(entry("A")));
    await sync(a, server);
    await b.run(() => saveEntry(entry("B")));
    await b.run(async () => {
      await expect(synchronizeJournal(TEST_USER_ID, {
        pushOperation: server.pushOperation.bind(server),
        listChangesAfter: async () => { throw new Error("offline during pull"); },
      })).rejects.toThrow("offline during pull");
      const before = await getSyncSnapshot();
      await expect(resolveConflictKeepBoth("shared")).rejects.toThrow("먼저 동기화");
      await expect(resolveConflictUseLocal("shared")).rejects.toThrow("먼저 동기화");
      expect(await getSyncSnapshot()).toEqual(before);
      expect(await listEntries()).toEqual([entry("B")]);
    });
    await sync(b, server);
    await b.run(() => resolveConflictKeepBoth("shared"));
    await sync(b, server);
    await sync(a, server);
    expect(await entries(a)).toEqual(await entries(b));
  });

  it("reconstructs remote conflict state after restoring a V1 encrypted backup", async () => {
    const { a, b, server, recoveryCode } = await seeded();
    await a.run(() => saveEntry(entry("A")));
    await sync(a, server);
    await b.run(() => saveEntry(entry("B")));
    await sync(b, server);
    const backup = await b.run(createEncryptedBackup);
    const restored = new VirtualDevice("restored-backup");
    await restored.run(() => importEncryptedBackup(backup.json, recoveryCode));
    expect(await restored.run(getSyncSnapshot)).toMatchObject({ cursor: 2, conflicts: 1 });
    await sync(restored, server);
    await restored.run(() => resolveConflictKeepBoth("shared"));
    expect(await sync(restored, server)).toMatchObject({ pushed: 1, conflicts: 0 });
    await sync(a, server);
    expect(await entries(restored)).toEqual(await entries(a));
    expect((await entries(restored)).map(e => e.text).sort()).toEqual(["A", "B (사본)"]);
  });

  it("retries a temporarily missing image without advancing the cursor or losing text", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    await a.run(() => saveEntry(entry()));
    await sync(a, server);
    const key = `${TEST_USER_ID}:shared:1`;
    const blob = server.blobs.get(key)!;
    server.blobs.delete(key);
    await expect(sync(b, server)).rejects.toThrow("원격 사진 암호문이 없습니다");
    expect(await b.run(getSyncSnapshot)).toMatchObject({ cursor: 0 });
    expect(await entries(b)).toEqual([]);
    server.blobs.set(key, blob);
    expect(await sync(b, server)).toMatchObject({ pulled: 1 });
    expect(await entries(b)).toEqual([entry()]);
  });

  it("does not resurrect deleted entries on stale delivery or regress the cursor", async () => {
    const { a, b, server } = await seeded();
    const original = (await server.listChangesAfter(0, 1))[0];
    await a.run(() => deleteEntry("shared"));
    await sync(a, server);
    await sync(b, server);
    await b.run(async () => {
      expect(await applyRemoteSyncChange(original.change, original.blob)).toBe("ignored");
      expect((await getSyncSnapshot()).cursor).toBe(2);
      // Even a replay assigned a newer delivery cursor cannot replace a tombstone.
      expect(await applyRemoteSyncChange({ ...original.change, serverCursor: 3 }, original.blob)).toBe("ignored");
      expect(await listEntries()).toEqual([]);
    });
  });

  it("cleanup retains old pending/conflicting deletes and active encrypted image data", async () => {
    const { a, b, server } = await seeded();
    await a.run(async () => {
      await saveEntry({ ...entry("active image"), id: "active" });
      const [active] = await listPendingSyncOperations();
      await deleteEntry("shared");
      const database = await openVaultDatabase();
      try {
        const tx = database.transaction(OUTBOX_STORE, "readwrite");
        const store = tx.objectStore(OUTBOX_STORE);
        const operations = await requestToPromise(store.getAll()) as SyncOperation[];
        const deletion = operations.find(op => op.changeType === "delete")!;
        store.put({ ...deletion, createdAt: "2000-01-01T00:00:00.000Z", blob: { ...active.blob!, id: "unused-delete-blob" } });
        store.put({ ...deletion, operationId: "old-conflict", entryId: "conflicting-delete", status: "conflict", createdAt: "2000-01-01T00:00:00.000Z" });
        await transactionDone(tx);
      } finally { database.close(); }
      expect(await cleanupExpiredTombstones(0)).toBe(0);
      expect(await cleanupOrphanedBlobs()).toBe(1);
      expect(await cleanupOrphanedBlobs()).toBe(0);
      const remaining = await listPendingSyncOperations();
      expect(remaining.find(op => op.entryId === "active")?.blob).toEqual(active.blob);
      expect(remaining.find(op => op.changeType === "delete")).toMatchObject({ entryId: "shared", status: "pending" });
      expect(remaining.find(op => op.changeType === "delete")?.blob).toBeUndefined();
      expect((await getSyncSnapshot()).conflicts).toBe(1);
    });
    await sync(a, server);
    await sync(b, server);
    expect(await entries(b)).toEqual([{ ...entry("active image"), id: "active" }]);
  });
});
