import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeSyncOperation,
  applyRemoteSyncChange,
  createRecoveryKit,
  getSyncSnapshot,
  listEntries,
  listPendingSyncOperations,
  saveEntry,
  type RemoteSyncChange,
} from "../app/lib/local-vault";

const DATABASE_NAME = "private-journal";

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("테스트 금고 초기화 실패"));
    request.onblocked = () => reject(new Error("테스트 금고 연결이 닫히지 않았습니다."));
  });
}

describe("sync cursor pagination unit tests", () => {
  beforeEach(deleteTestDatabase);
  afterEach(deleteTestDatabase);

  it("handles 200+ paginated remote changes sequentially and advances server cursor idempotently", async () => {
    await createRecoveryKit();

    const TOTAL_CHANGES = 250;

    for (let cursor = 1; cursor <= TOTAL_CHANGES; cursor += 1) {
      const entryId = `018f91f0-776b-7c8a-80d8-${String(cursor).padStart(12, "0")}`;

      await saveEntry({
        id: entryId,
        text: `Paginated sync record cursor ${cursor}`,
        createdAt: "2026-08-01T15:00:00.000Z",
      });

      const pendingOps = await listPendingSyncOperations();
      const payload = pendingOps[0].payload;
      expect(payload).toBeDefined();

      await acknowledgeSyncOperation(pendingOps[0]);

      const change: RemoteSyncChange = {
        serverCursor: cursor,
        operationId: `op-cursor-${cursor}`,
        entryId,
        baseRevision: 0,
        revision: 1,
        changeType: "upsert",
        payload,
      };

      const outcome = await applyRemoteSyncChange(change);
      expect(outcome).toBe("applied");
    }

    const snapshot = await getSyncSnapshot();
    expect(snapshot.cursor).toBe(TOTAL_CHANGES);

    const entries = await listEntries();
    expect(entries.length).toBe(TOTAL_CHANGES);
  });
});
