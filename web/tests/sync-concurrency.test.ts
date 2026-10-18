import { beforeEach, describe, expect, it } from "vitest";
import { createRecoveryKit, deleteEntry, getLocalVaultEnvelope, getSyncSnapshot, listEntries, listPendingSyncOperations, recoverVault, resolveConflictKeepBoth, resolveConflictUseLocal, saveEntry } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { MockRemoteSyncServer, VirtualDevice, TEST_USER_ID, deferred } from "./helpers/sync";

let server: MockRemoteSyncServer;
beforeEach(() => { server = new MockRemoteSyncServer(); });

describe("2. 경합성 및 동시성 (Concurrency) 검증", () => {
    it("다기기 동일 revision 동시 편집 경합: 먼저 push한 쪽 승리, 늦은 쪽 conflict 마킹", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      // 공통 기준 일기 (revision 1)
      await deviceA.run(async () => {
        await saveEntry({
          id: "entry-conflict",
          text: "기준 원본 일기 (rev 1)",
          createdAt: "2026-09-02T10:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));

      // 양쪽 기기가 동시에 각각 서로 다르게 수정 (오프라인 상태)
      await deviceA.run(async () => {
        await saveEntry({
          id: "entry-conflict",
          text: "Device A의 수정본 (rev 2 경쟁)",
          createdAt: "2026-09-02T10:00:00.000Z",
        });
      });

      await deviceB.run(async () => {
        await saveEntry({
          id: "entry-conflict",
          text: "Device B의 수정본 (rev 2 경쟁)",
          createdAt: "2026-09-02T10:00:00.000Z",
        });
      });

      // 1. Device A가 먼저 푸시 -> 성공 (rev 2 확정)
      const resA = await deviceA.run(() => synchronizeJournal(TEST_USER_ID, server));
      expect(resA.pushed).toBe(1);
      expect(resA.conflicts).toBe(0);

      // 2. Device B가 뒤이어 푸시 -> 서버에서 unique(user_id, entry_id, revision) 충돌 발생 -> conflict 반환
      const resB = await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));
      expect(resB.conflicts).toBeGreaterThanOrEqual(1);

      // Device B의 상태 검증: outbox와 entry 모두 conflict로 격리됨
      const snapshotB = await deviceB.run(() => getSyncSnapshot());
      expect(snapshotB.conflicts).toBe(1);
      expect(snapshotB.pending).toBe(0);
    });

    it("충돌 해결 전략 1: 사본 보존 (resolveConflictKeepBoth) -> 양쪽 버전 모두 보존", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      await deviceA.run(async () => {
        await saveEntry({
          id: "conflict-keep-both",
          text: "원본",
          createdAt: "2026-09-02T11:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));

      // 동시 수정
      await deviceA.run(async () => {
        await saveEntry({ id: "conflict-keep-both", text: "A 변경", createdAt: "2026-09-02T11:00:00.000Z" });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(async () => {
        await saveEntry({ id: "conflict-keep-both", text: "B 변경", createdAt: "2026-09-02T11:00:00.000Z" });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // Device B에서 resolveConflictKeepBoth 실행
      await deviceB.run(async () => {
        const entries = await resolveConflictKeepBoth("conflict-keep-both");
        expect(entries).toHaveLength(2);

        // B의 수정본이 "(사본)" 접미사를 달고 신규 항목으로 보존되었는지 확인
        const copyEntry = entries.find((e) => e.text.includes("(사본)"));
        expect(copyEntry).toBeDefined();
        expect(copyEntry?.text).toBe("B 변경 (사본)");

        // 충돌 해소 후 스냅샷 확인
        const snapshot = await getSyncSnapshot();
        expect(snapshot.conflicts).toBe(0);

        // 원본은 원격 승리 버전으로 복원하고 로컬 변경은 사본으로 보존
        const finalEntries = await listEntries();
        expect(finalEntries.some((e) => e.text === "A 변경")).toBe(true);
        expect(finalEntries.some((e) => e.text === "B 변경 (사본)")).toBe(true);

        // 사본을 서버로 푸시
        const pushRes = await synchronizeJournal(TEST_USER_ID, server);
        expect(pushRes.pushed).toBe(1);
      });

      // Device A가 동기화하면 B의 사본을 pull하여 A의 기기에도 양쪽 기록이 모두 보존됨
      await deviceA.run(async () => {
        const pullRes = await synchronizeJournal(TEST_USER_ID, server);
        expect(pullRes.pulled).toBe(1);
        const entriesA = await listEntries();
        expect(entriesA.some((e) => e.text === "A 변경")).toBe(true);
        expect(entriesA.some((e) => e.text === "B 변경 (사본)")).toBe(true);
      });
    });

    it("충돌 해결 전략 2: 로컬 우선 (resolveConflictUseLocal) -> 재시도 큐로 복구", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      await deviceA.run(async () => {
        await saveEntry({
          id: "conflict-use-local",
          text: "원본",
          createdAt: "2026-09-02T12:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));

      // 동시 수정 및 충돌 유발
      await deviceA.run(async () => {
        await saveEntry({ id: "conflict-use-local", text: "A 승리 버전", createdAt: "2026-09-02T12:00:00.000Z" });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(async () => {
        await saveEntry({ id: "conflict-use-local", text: "B 강제 덮어쓰기 희망", createdAt: "2026-09-02T12:00:00.000Z" });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // Device B에서 resolveConflictUseLocal 실행
      await deviceB.run(async () => {
        await resolveConflictUseLocal("conflict-use-local");
        const snapshot = await getSyncSnapshot();
        // conflict에서 pending으로 전환됨
        expect(snapshot.conflicts).toBe(0);
        expect(snapshot.pending).toBe(1);

        const pending = await listPendingSyncOperations();
        expect(pending[0].status).toBe("pending");
        expect(pending[0].lastError).toBeUndefined();
        expect(pending[0].revision).toBe(3);
        expect(pending[0].baseRevision).toBe(2);
        expect(await synchronizeJournal(TEST_USER_ID, server)).toMatchObject({ pushed: 1, pending: 0, conflicts: 0 });
      });
    });

    it("동시 삭제 vs 수정 경합 (Delete vs Update Race)", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      await deviceA.run(async () => {
        await saveEntry({
          id: "race-del-upd",
          text: "삭제/수정 경합 대상",
          createdAt: "2026-09-02T13:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));

      // A는 삭제 (rev 2 delete), B는 수정 (rev 2 upsert)
      await deviceA.run(() => deleteEntry("race-del-upd"));
      await deviceB.run(() => saveEntry({ id: "race-del-upd", text: "삭제 직전 수정 시도", createdAt: "2026-09-02T13:00:00.000Z" }));

      // A가 먼저 삭제 푸시
      const resA = await deviceA.run(() => synchronizeJournal(TEST_USER_ID, server));
      expect(resA.pushed).toBe(1);

      // B가 뒤이어 수정 푸시 -> rev 2 충돌 감지
      const resB = await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));
      expect(resB.conflicts).toBeGreaterThanOrEqual(1);
    });

    it("단일 기기 고병렬 쓰기 경합 (Promise.all 병렬 saveEntry)", async () => {
      const device = new VirtualDevice("device-parallel");
      await device.run(() => createRecoveryKit());

      const PARALLEL_WRITES = 20;
      // 20개의 일기를 Promise.all로 병렬 실행하여 IndexedDB 트랜잭션 경합 발생 유도
      await device.run(async () => {
        await Promise.all(
          Array.from({ length: PARALLEL_WRITES }, (_, i) =>
            saveEntry({
              id: `parallel-entry-${i}`,
              text: `고병렬 작성 테스트 일기 ${i}`,
              createdAt: new Date(1700000000000 + i * 1000).toISOString(),
            }),
          ),
        );

        // 데이터 누락 없이 20개 모두 온전히 저장되었는지 검증
        const entries = await listEntries();
        expect(entries).toHaveLength(PARALLEL_WRITES);

        // Outbox에도 20개 작업이 모두 등록되었는지 검증
        const pending = await listPendingSyncOperations();
        expect(pending).toHaveLength(PARALLEL_WRITES);
      });
    });

    it("동일 일기에 대한 연속 비동기 수정 시 revision 무결성 및 outbox 순서 보장", async () => {
      const device = new VirtualDevice("device-sequential-edits");
      await device.run(() => createRecoveryKit());

      const entryId = "rapid-edit-target";
      await device.run(async () => {
        await saveEntry({ id: entryId, text: "v1", createdAt: "2026-09-02T14:00:00.000Z" });
        await saveEntry({ id: entryId, text: "v2", createdAt: "2026-09-02T14:00:00.000Z" });
        await saveEntry({ id: entryId, text: "v3", createdAt: "2026-09-02T14:00:00.000Z" });

        const pending = await listPendingSyncOperations();
        // 동일 entryId에 대해 revision 오름차순(1, 2, 3)으로 정렬되는지 확인
        expect(pending.map((p) => p.revision)).toEqual([1, 2, 3]);
        expect(pending.map((p) => p.baseRevision)).toEqual([0, 1, 2]);

        const entries = await listEntries();
        expect(entries[0].text).toBe("v3");
      });
    });

    it("동기화 실행 도중 로컬 쓰기 경합 시 트랜잭션 충돌 없이 outbox 보존", async () => {
      const device = new VirtualDevice("device-sync-in-flight");
      await device.run(() => createRecoveryKit());

      await device.run(async () => {
        await saveEntry({ id: "initial-entry", text: "초기 일기", createdAt: "2026-09-02T15:00:00.000Z" });
      });

      const entered = deferred();
      const release = deferred();
      server.beforePush = async () => { entered.resolve(); await release.promise; };

      await device.run(async () => {
        // 동기화 시작 (비동기)
        const syncPromise = synchronizeJournal(TEST_USER_ID, server);
        await entered.promise;

        // 동기화가 진행 중인 동안 로컬에 새 일기 추가 작성
        await saveEntry({ id: "concurrent-local-entry", text: "동기화 중 작성된 일기", createdAt: "2026-09-02T15:00:01.000Z" });

        release.resolve();
        const syncRes = await syncPromise;
        expect(syncRes.pushed).toBe(1); // 최초 1건 푸시 완료

        // 동기화 중 작성된 2번째 일기는 안전하게 pending outbox에 유지되어야 함
        const snapshot = await getSyncSnapshot();
        expect(snapshot.pending).toBe(1);

        // 다음 동기화 시 정상 푸시되는지 확인
        server.beforePush = undefined;
        const nextSyncRes = await synchronizeJournal(TEST_USER_ID, server);
        expect(nextSyncRes.pushed).toBe(1);
        expect(nextSyncRes.pending).toBe(0);
      });
    });
  });
