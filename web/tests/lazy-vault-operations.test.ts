import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  createRecoveryKit, importEncryptedBackup, purgeLocalVaultData,
  RecoveryPinLockError, LegacyBackupDeletionError, setupPinLock,
} from "../app/lib/local-vault";
import { RecoveryPinLockError as RecoveryError } from "../app/lib/recovery";
import { LegacyBackupDeletionError as BackupError } from "../app/lib/backup";
import legacyBackup from "./fixtures/legacy-backup-v1.json";

beforeEach(purgeLocalVaultData);
afterEach(purgeLocalVaultData);

it("keeps the PIN refusal compatible across the public facade and legacy recovery path", async () => {
  await setupPinLock("654321");
  const error = await createRecoveryKit().catch((error: unknown) => error);
  expect(error).toBeInstanceOf(RecoveryPinLockError);
  expect(error).toBeInstanceOf(RecoveryError);
  expect(error).toMatchObject({ code: "PIN_LOCK_CONFIGURED" });
});

it("keeps legacy deletion refusals recognizable after lazy backup loading", async () => {
  const backup = { ...legacyBackup, outbox: [{
    operationId: "77777777-7777-4777-8777-777777777777",
    entryId: legacyBackup.entries[0].id, baseRevision: 1, revision: 2,
    changeType: "delete", createdAt: "2026-10-29T00:00:00Z", status: "pending",
  }] };
  const error = await importEncryptedBackup(JSON.stringify(backup),
    "3P2ZZ-A4763-F7KD3-KPBSY-9HVBT-L5QK8-PTQ4C-PECJ6-23").catch((error: unknown) => error);
  expect(error).toBeInstanceOf(LegacyBackupDeletionError);
  expect(error).toBeInstanceOf(BackupError);
});
