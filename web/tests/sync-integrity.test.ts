import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteSyncChange, cleanupExpiredTombstones, cleanupOrphanedBlobs, createRecoveryKit, deleteEntry, getLocalVaultEnvelope, listEntries, listPendingSyncOperations, recoverVault, saveEntry, type RemoteSyncChange, getSyncSnapshot } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { MockRemoteSyncServer, VirtualDevice, TEST_USER_ID, tamperBuffer } from "./helpers/sync";

let server: MockRemoteSyncServer;
beforeEach(() => { server = new MockRemoteSyncServer(); });

describe("3. 무결성 및 보안 (Integrity & Security) 검증", () => {
    it("AES-256-GCM 변조 시 실패를 알리고 커서를 보존", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      await deviceA.run(async () => {
        await saveEntry({
          id: "tamper-target",
          text: "변조될 원문 데이터",
          createdAt: "2026-09-03T10:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // 악의적인 네트워크 공격자 또는 서버 전송 오류로 ciphertext 1바이트 변조
      expect(server.changes).toHaveLength(1);
      const originalPayload = server.changes[0].payload!;
      server.changes[0].payload = {
        ...originalPayload,
        ciphertext: tamperBuffer(originalPayload.ciphertext),
      };

      // 1. 직접 applyRemoteSyncChange를 호출하면 AES-GCM 인증 태그 실패 오류가 발생해야 함
      await deviceB.run(async () => {
        const change: RemoteSyncChange = {
          ...server.changes[0],
          changeType: "upsert",
        };
        await expect(applyRemoteSyncChange(change)).rejects.toThrow();
      });

      // 실패한 기록을 건너뛰지 않고 재시도 가능한 커서 유지
      await deviceB.run(async () => {
        await expect(synchronizeJournal(TEST_USER_ID, server)).rejects.toThrow();
        expect((await getSyncSnapshot()).cursor).toBe(0);

        // 변조된 데이터가 금고에 저장되지 않았는지 확인
        const entries = await listEntries();
        expect(entries).toHaveLength(0);
      });
    });

    it("AAD(추가 인증 데이터) 위조 방어: entryId 위조 시 복호화 즉각 거부", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      await deviceA.run(async () => {
        await saveEntry({
          id: "legit-entry-id",
          text: "정상 일기",
          createdAt: "2026-09-03T11:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // AAD는 `private-journal:sync:entry:legit-entry-id:r1:v1`로 봉인되어 있음
      // 공격자가 entryId를 "spoofed-entry-id"로 바꿔치기
      await deviceB.run(async () => {
        const spoofedChange: RemoteSyncChange = {
          ...server.changes[0],
          entryId: "spoofed-entry-id",
          changeType: "upsert",
        };
        // AAD 불일치로 AES-GCM 복호화 실패 확인
        await expect(applyRemoteSyncChange(spoofedChange)).rejects.toThrow();
      });
    });

    it("AAD 위조 및 Replay Attack 방어: 과거 revision을 가짜 신규 revision으로 재전송 시 복호화 거부", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      await deviceA.run(async () => {
        await saveEntry({
          id: "replay-target",
          text: "v1 원본",
          createdAt: "2026-09-03T12:00:00.000Z",
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // revision 1의 페이로드를 가져와 revision 5로 속여서 주입 시도
      await deviceB.run(async () => {
        const replayChange: RemoteSyncChange = {
          ...server.changes[0],
          revision: 5,
          baseRevision: 4,
          changeType: "upsert",
        };
        // AAD에는 `:r1:`이 포함되어 있으므로 `:r5:`로 복호화 시도 시 실패해야 함
        await expect(applyRemoteSyncChange(replayChange)).rejects.toThrow();
      });
    });

    it("이미지 Blob 암호문 변조 시 복호화 차단 무결성 검증", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      const sampleDataUrl = "data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoBAAEAAQAcJaACdLoAAP7/1/4AAAAAAAA=";

      await deviceA.run(async () => {
        await saveEntry({
          id: "blob-tamper-target",
          text: "사진 포함 일기",
          createdAt: "2026-09-03T13:00:00.000Z",
          image: { dataUrl: sampleDataUrl, width: 1, height: 1, mimeType: "image/webp" },
        });
        await synchronizeJournal(TEST_USER_ID, server);
      });

      // Blob의 암호문 1바이트 변조
      const blobKey = `${TEST_USER_ID}:blob-tamper-target:1`;
      const blobItem = server.blobs.get(blobKey)!;
      expect(blobItem).toBeDefined();
      blobItem.blob.ciphertext = tamperBuffer(blobItem.blob.ciphertext);

      // Device B가 pull할 때 blob 복호화 오류 발생 확인
      await deviceB.run(async () => {
        await expect(synchronizeJournal(TEST_USER_ID, server)).rejects.toThrow();
        expect((await getSyncSnapshot()).cursor).toBe(0);
        // 복호화에 실패한 이미지는 저장되지 않아야 함
        const entries = await listEntries();
        expect(entries).toHaveLength(0);
      });
    });

    it("키 격리(Key Isolation): 다른 사용자의 금고 키로 암호화된 데이터 주입 차단", async () => {
      const userXDevice = new VirtualDevice("user-x");
      const userYDevice = new VirtualDevice("user-y");

      // 서로 다른 두 사용자가 독립된 금고를 생성 (서로 다른 Vault Key 보유)
      await userXDevice.run(() => createRecoveryKit());
      await userYDevice.run(() => createRecoveryKit());

      // User X가 일기 작성 및 푸시
      await userXDevice.run(async () => {
        await saveEntry({
          id: "user-x-private-entry",
          text: "User X의 비밀 일기",
          createdAt: "2026-09-03T14:00:00.000Z",
        });
        await synchronizeJournal("user-x-uuid", server);
      });

      // User Y의 기기에 User X의 암호문 주입 시도
      await userYDevice.run(async () => {
        const userXChange: RemoteSyncChange = {
          ...server.changes[0],
          changeType: "upsert",
        };
        // 키가 다르므로 복호화 태그 검증 실패 확인
        await expect(applyRemoteSyncChange(userXChange)).rejects.toThrow();
      });
    });

    it("Tombstone 순서 보장 및 부활(Resurrection) 방지 무결성", async () => {
      const deviceA = new VirtualDevice("device-a");
      const deviceB = new VirtualDevice("device-b");

      const kit = await deviceA.run(() => createRecoveryKit());
      const envelope = await deviceA.run(() => getLocalVaultEnvelope());
      await deviceB.run(() => recoverVault(envelope!, kit.recoveryCode));

      // 작성 직후 즉시 삭제
      await deviceA.run(async () => {
        await saveEntry({
          id: "entry-rapid-delete",
          text: "작성하자마자 삭제된 일기",
          createdAt: "2026-09-03T15:00:00.000Z",
        });
        await deleteEntry("entry-rapid-delete");

        const pending = await listPendingSyncOperations();
        // Outbox 순서: [upsert(rev 1), delete(rev 2)]
        expect(pending.map((p) => p.changeType)).toEqual(["upsert", "delete"]);
        expect(pending.map((p) => p.revision)).toEqual([1, 2]);

        await synchronizeJournal(TEST_USER_ID, server);
      });

      // Device B가 전체 동기화 실행 시 삭제 상태가 유지되어 부활하지 않는지 확인
      await deviceB.run(async () => {
        const res = await synchronizeJournal(TEST_USER_ID, server);
        expect(res.pulled).toBe(2); // upsert 적용 후 delete 적용됨
        const entries = await listEntries();
        expect(entries).toHaveLength(0); // 절대 목록에 나타나지 않음
      });
    });

    it("고아 블롭 및 만료 툼스톤 정리(Cleanup) 무결성: 정상 데이터 보존 검증", async () => {
      const device = new VirtualDevice("device-cleanup");
      await device.run(() => createRecoveryKit());

      await device.run(async () => {
        await saveEntry({
          id: "clean-entry-1",
          text: "정상 보존될 일기",
          createdAt: "2026-09-03T16:00:00.000Z",
        });

        // 클린업 실행
        const removedBlobs = await cleanupOrphanedBlobs();
        const removedTombstones = await cleanupExpiredTombstones();

        expect(typeof removedBlobs).toBe("number");
        expect(typeof removedTombstones).toBe("number");
        expect(removedBlobs).toBeGreaterThanOrEqual(0);
        expect(removedTombstones).toBeGreaterThanOrEqual(0);

        // 정상 일기는 절대 지워지지 않고 온전히 유지되는지 확인
        const entries = await listEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].text).toBe("정상 보존될 일기");
      });
    });
  });
