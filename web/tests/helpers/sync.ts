import "fake-indexeddb/auto";
import { AsyncLocalStorage } from "node:async_hooks";
import { IDBFactory } from "fake-indexeddb";
import type { EncryptedBlobEnvelope, EncryptedSyncEnvelope, SyncOperation } from "../../app/lib/local-vault";
import type { JournalSyncTransport, RemoteSyncBatchItem } from "../../app/lib/remote/journal-sync-transport";
import { createRecoveryKit, getLocalVaultEnvelope, recoverVault } from "../../app/lib/local-vault";

// Node's Web Locks are process-wide, unlike independent browser devices.
// Exercise the per-factory fallback here; the Web Locks adapter has its own test.
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
}

// Scope IndexedDB to each async device context, including overlapping runs.
// This simulates storage, not browser processes or actual API access control.
const deviceContext = new AsyncLocalStorage<IDBFactory>();
const originalFactory = globalThis.indexedDB;
Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  get: () => deviceContext.getStore() ?? originalFactory,
});

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

export async function pairedDevices() {
  const a = new VirtualDevice("a");
  const b = new VirtualDevice("b");
  const kit = await a.run(() => createRecoveryKit());
  const envelope = await a.run(() => getLocalVaultEnvelope());
  if (!envelope) throw new Error("Missing test vault");
  await b.run(() => recoverVault(envelope, kit.recoveryCode));
  return { a, b, recoveryCode: kit.recoveryCode };
}

export class MockRemoteSyncServer implements JournalSyncTransport {
  private cursor = 0;
  public changes: Array<{
    serverCursor: number;
    userId: string;
    operationId: string;
    entryId: string;
    baseRevision: number;
    revision: number;
    changeType: "upsert" | "delete";
    payload?: EncryptedSyncEnvelope;
  }> = [];

  public blobs = new Map<
    string,
    { entryId: string; revision: number; blob: EncryptedBlobEnvelope }
  >();
  public attachmentBlobs = new Map<string, EncryptedBlobEnvelope[]>();

  // In-flight delay simulation if needed
  public beforePush?: (operation: SyncOperation) => Promise<void>;
  public afterAccept?: (operation: SyncOperation) => Promise<void>;
  public readonly requests: Array<{ cursor: number; limit: number }> = [];

  async pushOperation(
    userId: string,
    operation: SyncOperation,
  ): Promise<"accepted" | "conflict"> {
    await this.beforePush?.(operation);

    // Enforce PostgreSQL UNIQUE (user_id, entry_id, revision)
    const existingRev = this.changes.find(
      (c) =>
        c.userId === userId &&
        c.entryId === operation.entryId &&
        c.revision === operation.revision,
    );

    if (existingRev) {
      // Idempotent retry: if same operationId was already accepted, return accepted
      if (existingRev.operationId === operation.operationId) {
        return "accepted";
      }
      // Conflict: another operation already claimed this revision!
      return "conflict";
    }

    if (operation.blob) {
      this.blobs.set(`${userId}:${operation.entryId}:${operation.revision}`, {
        entryId: operation.entryId,
        revision: operation.revision,
        blob: structuredClone(operation.blob),
      });
    }
    if (operation.blobs) this.attachmentBlobs.set(`${userId}:${operation.entryId}:${operation.revision}`, structuredClone(operation.blobs));

    this.cursor += 1;
    this.changes.push({
      serverCursor: this.cursor,
      userId,
      operationId: operation.operationId,
      entryId: operation.entryId,
      baseRevision: operation.baseRevision,
      revision: operation.revision,
      changeType: operation.changeType,
      payload: operation.payload ? structuredClone(operation.payload) : undefined,
    });

    await this.afterAccept?.(operation);
    return "accepted";
  }

  async listChangesAfter(
    cursor: number,
    limit: number,
    userId?: string,
  ): Promise<RemoteSyncBatchItem[]> {
    this.requests.push({ cursor, limit });
    const matched = this.changes
      .filter((c) => (userId ? c.userId === userId : true) && c.serverCursor > cursor)
      .sort((a, b) => a.serverCursor - b.serverCursor)
      .slice(0, limit);

    return matched.map((c) => {
      const blobItem = this.blobs.get(`${c.userId}:${c.entryId}:${c.revision}`);
      return {
        change: {
          serverCursor: c.serverCursor,
          operationId: c.operationId,
          entryId: c.entryId,
          baseRevision: c.baseRevision,
          revision: c.revision,
          changeType: c.changeType,
          payload: c.payload,
        },
        blob: blobItem?.blob,
        blobs: this.attachmentBlobs.get(`${c.userId}:${c.entryId}:${c.revision}`),
      };
    });
  }

  clear() {
    this.cursor = 0;
    this.changes = [];
    this.blobs.clear();
    this.attachmentBlobs.clear();
    this.beforePush = undefined;
    this.afterAccept = undefined;
    this.requests.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Virtual Device (Independent IndexedDB factory & runtime)
// ---------------------------------------------------------------------------

export class VirtualDevice {
  public readonly idb: IDBFactory;
  public readonly name: string;

  constructor(name: string) {
    this.name = name;
    this.idb = new IDBFactory();
  }

  run<T>(action: () => Promise<T>): Promise<T> {
    return deviceContext.run(this.idb, action);
  }
}

// Helper to tamper with ArrayBuffer
export function tamperBuffer(buf: ArrayBuffer): ArrayBuffer {
  const copy = buf.slice(0);
  const view = new Uint8Array(copy);
  if (view.length > 0) {
    view[0] ^= 0xff;
  }
  return copy;
}

export const TEST_USER_ID = "user-test-uuid-1234";
