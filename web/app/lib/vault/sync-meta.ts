import { OUTBOX_STORE, SYNC_META_STORE } from "./contracts";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import { withVaultLock } from "./mutation-lock";
import type { SyncOperation } from "./types";

export function prepareConflictReplay(): Promise<void> {
  return withVaultLock("mutation", () =>
    withVaultDatabase(async (database) => {
      const transaction = database.transaction([OUTBOX_STORE, SYNC_META_STORE], "readwrite");
      const operations = (await requestToPromise(
        transaction.objectStore(OUTBOX_STORE).getAll(),
      )) as SyncOperation[];
      const meta = transaction.objectStore(SYNC_META_STORE);
      const conflictingIds = new Set(
        operations.filter((op) => op.status === "conflict").map((op) => op.entryId),
      );
      for (const id of conflictingIds) {
        if (!(await requestToPromise(meta.get(`conflict:${id}`)))) {
          // Older clients and V1 backups have a cursor but no remote conflict
          // snapshot. Replay encrypted history to reconstruct it before resolving.
          meta.put(0, "server-cursor");
          break;
        }
      }
      await transactionDone(transaction);
    }),
  );
}
