import { beforeEach, describe, expect, it } from "vitest";
import { createRecoveryKit, deleteEntry, getLocalVaultEnvelope, getSyncSnapshot, listEntries, listPendingSyncOperations, recoverVault, saveEntry } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { MockRemoteSyncServer, VirtualDevice, TEST_USER_ID } from "./helpers/sync";

let server: MockRemoteSyncServer;
beforeEach(() => { server = new MockRemoteSyncServer(); });

describe("1. 자동화된 동기화 (Synchronization) 검증", () => {
    it("다중 기기 기본 동기화: Device A 작성 -> Push -> Device B 복원 및 Pull로 완전 일치", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      // 1. Device A: 금고 생성 및 일기 작성
      const recoveryKit = await deviceA.run(async () => {
        const kit = await createRecoveryKit();
        await saveEntry({
          id: "entry-sync-1",
          text: "기기 A에서 작성한 첫 번째 비밀 일기",
          createdAt: "2026-09-01T10:00:00.000Z",
        });
        return kit;
      });

      const envelope = await deviceA.run(async () => getLocalVaultEnvelope());
      expect(envelope).not.toBeNull();

      // 2. Device A: 동기화 (Push)
      const pushResult = await deviceA.run(async () =>
        synchronizeJournal(TEST_USER_ID, server),
      );
      expect(pushResult.pushed).toBe(1);
      expect(server.changes.length).toBe(1);

      // 3. Device B: 복구 코드로 금고 복원
      await deviceB.run(async () => {
        await recoverVault(envelope!, recoveryKit.recoveryCode);
      });

      // 4. Device B: 동기화 (Pull)
      const pullResult = await deviceB.run(async () =>
        synchronizeJournal(TEST_USER_ID, server),
      );
      expect(pullResult.pulled).toBe(1);

      // 5. Device B 검증: 원격 암호문이 정상 복호화되어 동일한 내용으로 저장되었는가
      const entriesOnB = await deviceB.run(async () => listEntries());
      expect(entriesOnB).toHaveLength(1);
      expect(entriesOnB[0]).toEqual({
        id: "entry-sync-1",
        text: "기기 A에서 작성한 첫 번째 비밀 일기",
        createdAt: "2026-09-01T10:00:00.000Z",
      });
    });

    it("양방향 순차 동기화: A 작성 -> B pull & 수정 -> A pull하여 최신 수정본 수렴", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      // Setup vaults on both devices
      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      // Device A 작성 및 동기화
      await deviceA.run(async () => {
        await saveEntry({
          id: "entry-bidir",
          text: "초기 작성본 (Device A)",
          createdAt: "2026-09-01T12:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // Device B가 pull 후 수정하여 push
      await deviceB.run(async () => {
        await synchronizeJournal(TEST_USER_ID, server);
        const entries = await listEntries();
        expect(entries[0].text).toBe("초기 작성본 (Device A)");

        // Device B에서 내용 수정
        await saveEntry({
          ...entries[0],
          text: "Device B에서 수정한 버전",
        });
        const syncRes = await synchronizeJournal(TEST_USER_ID, server);
        expect(syncRes.pushed).toBe(1);
      });

      // Device A가 다시 pull하여 최신 내용 확인
      await deviceA.run(async () => {
        const syncRes = await synchronizeJournal(TEST_USER_ID, server);
        expect(syncRes.pulled).toBe(1);
        const entries = await listEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe("Device B에서 수정한 버전");
      });
    });

    it("암호화 이미지(Blob) 동기화: A에서 이미지 첨부 -> B에서 다운로드 및 복호화 무결성 확인", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      const sampleDataUrl = "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/1/4AAAAAAAA=";

      // Device A: 사진이 포함된 일기 저장
      await deviceA.run(async () => {
        await saveEntry({
          id: "entry-image-1",
          text: "사진이 포함된 일기",
          createdAt: "2026-09-01T15:00:00.000Z",
          image: {
            dataUrl: sampleDataUrl,
            width: 1,
            height: 1,
            mimeType: "image/webp",
          },
        });
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pushed).toBe(1);
      });

      // 서버에 blob이 정상 등록되었는지 검증
      expect(server.blobs.size).toBe(1);

      // Device B: 동기화 실행
      await deviceB.run(async () => {
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pulled).toBe(1);
        const entries = await listEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].image).toBeDefined();
        expect(entries[0].image?.dataUrl).toBe(sampleDataUrl);
        expect(entries[0].image?.width).toBe(1);
        expect(entries[0].image?.height).toBe(1);
        expect(entries[0].image?.mimeType).toBe("image/webp");
      });
    });

    it("삭제(Tombstone) 동기화: A에서 삭제 -> B에서 pull 후 정상 삭제 반영", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      // 생성 및 양쪽 동기화
      await deviceA.run(async () => {
        await saveEntry({
          id: "entry-del",
          text: "삭제될 일기",
          createdAt: "2026-09-01T16:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });
      await deviceB.run(() => synchronizeJournal(TEST_USER_ID, server));

      // Device A에서 삭제 후 push
      await deviceA.run(async () => {
        await deleteEntry("entry-del");
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pushed).toBe(1);
      });

      // Device B에서 pull 후 삭제 확인
      await deviceB.run(async () => {
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pulled).toBe(1);
        const entries = await listEntries();
        expect(entries).toHaveLength(0);
      });
    });

    it("오프라인 큐 누적 후 온라인 복구 시 일괄 전송", async () => {
      const device = new VirtualDevice("device-offline");
      await device.run(() => createRecoveryKit());

      // 오프라인 상태에서 3개의 일기 연속 저장
      await device.run(async () => {
        for (let i = 1; i <= 3; i++) {
          await saveEntry({
            id: `offline-${i}`,
            text: `오프라인 기록 ${i}`,
            createdAt: `2026-09-01T1${i}:00:00.000Z`,
          });
        }
        const pending = await listPendingSyncOperations();
        expect(pending).toHaveLength(3);
      });

      // 온라인 복구 후 일괄 동기화
      await device.run(async () => {
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pushed).toBe(3);
        expect(res.pending).toBe(0);
      });

      // 전송을 마친 작업은 대기 큐에서 제거됨
      const pendingOps = await device.run(() => listPendingSyncOperations());
      expect(pendingOps).toHaveLength(0);

      // 서버에 정확히 3개의 체인지가 존재하는지 검증
      expect(server.changes).toHaveLength(3);
    });

    it("대규모 커서 페이지네이션 (250건 배치 경계 동기화)", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      const TOTAL = 250;
      // Device A에서 250개 일기 생성 및 서버 푸시
      await deviceA.run(async () => {
        for (let i = 1; i <= TOTAL; i++) {
          await saveEntry({
            id: `bulk-${i}`,
            text: `대량 일기 번호 ${i}`,
            createdAt: new Date(1700000000000 + i * 1000).toISOString(),
          });
        }
        await synchronizeJournal(TEST_USER_ID, server);
      });
      expect(server.changes).toHaveLength(TOTAL);

      // Device B: 동기화 (기본 배치 사이즈 200 -> 2회 분할 페이징 처리)
      server.requests.length = 0;
      await deviceB.run(async () => {
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pulled).toBe(TOTAL);
        const snapshot = await getSyncSnapshot();
        expect(snapshot.cursor).toBe(TOTAL);

        const entries = await listEntries();
        expect(entries).toHaveLength(TOTAL);
        expect(server.requests).toEqual([{ cursor: 0, limit: 200 }, { cursor: 200, limit: 200 }]);
        expect(new Set(entries.map(entry => entry.id)).size).toBe(TOTAL);
      });
    });
  });
