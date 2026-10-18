import { OUTBOX_STORE } from "./contracts";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import type { SyncOperation } from "./types";
import { withVaultLock } from "./mutation-lock";

export async function cleanupExpiredTombstones(
  maxAgeMs: number = 30 * 24 * 60 * 60 * 1000,
): Promise<number> {
  // Only pending/conflicting operations live here; acknowledgment removes
  // accepted deletes. Age alone must never discard an offline deletion.
  void maxAgeMs; // Retain the existing public API.
  return 0;
}

export async function cleanupOrphanedBlobs(): Promise<number> {
  return withVaultLock("mutation", () =>
    withVaultDatabase(async (database) => {
      const transaction = database.transaction(OUTBOX_STORE, "readwrite");
      const outbox = transaction.objectStore(OUTBOX_STORE);
      const operations = (await requestToPromise(outbox.getAll())) as SyncOperation[];
      let removed = 0;
      for (const operation of operations) {
        if (operation.changeType === "delete" && operation.blob) {
          // Drop the unused attachment, never the unsent delete itself.
          delete operation.blob;
          outbox.put(operation);
          removed += 1;
        }
      }
      await transactionDone(transaction);
      return removed;
    }),
  );
}
