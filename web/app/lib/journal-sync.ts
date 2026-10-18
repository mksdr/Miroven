import { withVaultLock } from "./vault/mutation-lock";
import { prepareConflictReplay } from "./vault/sync-meta";
import {
  acknowledgeSyncOperation,
  applyRemoteSyncChange,
  getSyncSnapshot,
  listPendingSyncOperations,
  markSyncOperationConflict,
} from "./local-vault";
import {
  createHttpJournalSyncTransport,
  type JournalSyncTransport,
} from "./remote/journal-sync-transport";
import { ApiError } from "./remote/client";
import { beginSnapshot, bindRemoteScope, commitSnapshot, setRemoteCursor, stageSnapshotItem } from "./vault/remote-state";

const SYNC_PAGE_SIZE = 200;

export type SyncResult = {
  pushed: number;
  pulled: number;
  conflicts: number;
  pending: number;
};

export async function synchronizeJournal(
  userId: string,
  transport: JournalSyncTransport = createHttpJournalSyncTransport(userId),
): Promise<SyncResult> {
  return withVaultLock("sync", () => synchronize(userId, transport));
}

async function synchronize(userId: string, transport: JournalSyncTransport): Promise<SyncResult> {
  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;
  const modern = Boolean(transport.scopeKey && transport.readPage && transport.readSnapshot);
  async function restoreSnapshot() {
    await beginSnapshot();
    let token: string | undefined;
    let resume: string | undefined;
    do {
      const page = await transport.readSnapshot!(token);
      if (resume && resume !== page.resumeCursor) throw new Error("스냅샷 기준이 변경되었습니다.");
      resume = page.resumeCursor;
      for (const item of page.items) await stageSnapshotItem(item, transport.scopeKey!);
      token = page.nextCursor ?? undefined;
    } while (token);
    pulled += await commitSnapshot(resume!, transport.scopeKey!);
  }
  if (modern && await bindRemoteScope(transport.scopeKey!)) await restoreSnapshot();

  const blockedEntries = new Set<string>();
  for (const operation of await listPendingSyncOperations()) {
    if (blockedEntries.has(operation.entryId)) continue;
    const outcome = await transport.pushOperation(userId, operation);
    if (outcome === "accepted") {
      await acknowledgeSyncOperation(operation);
      pushed += 1;
    } else {
      blockedEntries.add(operation.entryId);
      await markSyncOperationConflict(
        operation.operationId,
        "다른 기기에서 같은 revision을 먼저 저장했습니다.",
      );
      conflicts += 1;
    }
  }

  if (!modern) await prepareConflictReplay();
  let cursor = (await getSyncSnapshot()).cursor;
  if (modern) {
    try {
      while (true) {
        const page = await transport.readPage!(typeof cursor === "string" ? cursor : undefined);
        for (const { change, blob, blobs } of page.items) {
          const outcome = await applyRemoteSyncChange(change, blobs ?? blob, transport.scopeKey!);
          if (outcome === "applied") pulled++;
          if (outcome === "conflict") conflicts++;
        }
        await setRemoteCursor(page.nextCursor, transport.scopeKey!);
        cursor = page.nextCursor;
        if (!page.hasMore) break;
      }
    } catch (error) {
      if (!(error instanceof ApiError) || !["cursor_expired", "invalid_cursor"].includes(error.code)) throw error;
      await restoreSnapshot();
    }
    const state = await getSyncSnapshot();
    return { pushed, pulled, conflicts: Math.max(conflicts, state.conflicts), pending: state.pending };
  }
  while (true) {
    const batch = await transport.listChangesAfter(cursor, SYNC_PAGE_SIZE, userId);
    for (const { change, blob, blobs } of batch) {
      // A failed change leaves the durable cursor at the last committed record.
      // The caller sees an error and can retry after the source is repaired.
      const outcome = await applyRemoteSyncChange(change, blobs ?? blob);
      cursor = change.serverCursor;
      if (outcome === "applied") pulled += 1;
      if (outcome === "conflict") conflicts += 1;
    }
    if (batch.length < SYNC_PAGE_SIZE) break;
  }

  const snapshot = await getSyncSnapshot();
  return {
    pushed,
    pulled,
    conflicts: Math.max(conflicts, snapshot.conflicts),
    pending: snapshot.pending,
  };
}

export type { JournalSyncTransport } from "./remote/journal-sync-transport";
