import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyRemoteSyncChange,
  createRecoveryKit,
  getLocalVaultEnvelope,
  getSyncSnapshot,
  listEntries,
  listPendingSyncOperations,
  markSyncOperationConflict,
  recoverVault,
  resolveConflictKeepBoth,
  saveEntry,
  type JournalEntry,
} from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import type { JournalSyncTransport } from "../app/lib/journal-sync";

const DATABASE_NAME = "private-journal";
const SAMPLE_ENTRY: JournalEntry = {
  id: "018f91f0-776b-7c8a-80d8-82455b099999",
  text: "동기화 엔진 unit test",
  createdAt: "2026-08-01T15:00:00.000Z",
};

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("테스트 금고 초기화 실패"));
    request.onblocked = () => reject(new Error("테스트 금고 연결이 닫히지 않았습니다."));
  });
}

describe("sync engine & multi-device unit tests", () => {
  beforeEach(deleteTestDatabase);
  afterEach(deleteTestDatabase);

  it("reports 0 pending operations and 0 cursor initially", async () => {
    const snapshot = await getSyncSnapshot();
    expect(snapshot.cursor).toBe(0);
    expect(snapshot.pending).toBe(0);
    expect(snapshot.conflicts).toBe(0);
  });

  it("fails synchronizeJournal gracefully if API client is not connected", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    const pending = await listPendingSyncOperations();
    expect(pending.length).toBe(1);

    await expect(synchronizeJournal("test-user-id")).rejects.toThrow(
      "Miroven API가 설정되지 않았습니다.",
    );
  });

  it("preserves pending outbox status when sync attempt fails", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    const snapshotBefore = await getSyncSnapshot();
    expect(snapshotBefore.pending).toBe(1);

    try {
      await synchronizeJournal("test-user-id");
    } catch {
      // Expected exception due to missing API configuration in test env
    }

    const snapshotAfter = await getSyncSnapshot();
    expect(snapshotAfter.pending).toBe(1);
  });

  it("acknowledges pending operations through an injected transport", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    const acceptedOperations: string[] = [];
    const transport: JournalSyncTransport = {
      async pushOperation(_userId, operation) {
        acceptedOperations.push(operation.operationId);
        return "accepted";
      },
      async listChangesAfter() {
        return [];
      },
    };

    const result = await synchronizeJournal("test-user-id", transport);

    expect(acceptedOperations).toHaveLength(1);
    expect(result).toMatchObject({ pushed: 1, pulled: 0, conflicts: 0, pending: 0 });
  });

  it("keeps a conflicting operation visible for explicit resolution", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    const transport: JournalSyncTransport = {
      async pushOperation() {
        return "conflict";
      },
      async listChangesAfter() {
        return [];
      },
    };

    const result = await synchronizeJournal("test-user-id", transport);
    const snapshot = await getSyncSnapshot();

    expect(result.conflicts).toBe(1);
    expect(snapshot.conflicts).toBe(1);
    expect(snapshot.pending).toBe(0);
  });

  it("simulates multi-device vault recovery with valid recovery code", async () => {
    const kit = await createRecoveryKit();
    const envelope = await getLocalVaultEnvelope();
    expect(envelope).not.toBeNull();

    // Reset local database simulated for Client B
    await deleteTestDatabase();

    // Client B opens vault using envelope and recovery code
    await recoverVault(envelope!, kit.recoveryCode);
    const recoveredEnvelope = await getLocalVaultEnvelope();
    expect(recoveredEnvelope).not.toBeNull();

    const entries = await listEntries();
    expect(entries).toEqual([]);
  });

  it("handles conflict resolution by keeping local as copy or resolving to local", async () => {
    await createRecoveryKit();
    await saveEntry(SAMPLE_ENTRY);

    const pending = await listPendingSyncOperations();
    expect(pending.length).toBe(1);

    // Mark sync operation conflict
    await markSyncOperationConflict(pending[0].operationId, "원격 revision과 마찰 발생");

    const snapshotConflict = await getSyncSnapshot();
    expect(snapshotConflict.conflicts).toBe(1);

    // Resolve conflict by preserving local entry as copy
    await applyRemoteSyncChange({ ...pending[0], operationId: "other-device", serverCursor: 1 });
    const entriesAfterCopy = await resolveConflictKeepBoth(SAMPLE_ENTRY.id);
    expect(entriesAfterCopy.length).toBe(2);

    const snapshotAfter = await getSyncSnapshot();
    expect(snapshotAfter.conflicts).toBe(0);
  });
});
