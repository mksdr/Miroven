"use client";

import { useCallback, useState } from "react";
import {
  createEncryptedBackup,
  createRecoveryKit,
  ENCRYPTED_BACKUP_MAX_BYTES,
  getLocalVaultEnvelope,
  getSyncSnapshot,
  importEncryptedBackup,
  LegacyBackupDeletionError,
  recoverVault,
  RecoveryPinLockError,
  type VaultEnvelope,
} from "../lib/local-vault";
import { downloadDiagnosticReport } from "../lib/diagnostics";
import {
  downloadVaultEnvelope,
  uploadVaultEnvelope,
  type AuthIdentity,
} from "../lib/remote";
import type { Language, Theme } from "./useAppearance";

type UseVaultBackupRecoveryOptions = {
  identity: AuthIdentity | null;
  isVaultLocked: boolean;
  language: Language;
  refreshEntries: () => Promise<void>;
  remoteEnvelope: VaultEnvelope | null;
  setLocalEnvelope: (envelope: VaultEnvelope | null) => void;
  setPendingSyncCount: (count: number) => void;
  setRemoteEnvelope: (envelope: VaultEnvelope | null) => void;
  showToast: (message: string) => void;
  theme: Theme;
};

function localizedError(
  error: unknown,
  language: Language,
  koFallback: string,
  enFallback: string,
): string {
  if (error instanceof LegacyBackupDeletionError) {
    return language === "ko"
      ? error.message
      : "The deletions in this backup cannot be safely verified. Create a new backup with the latest app on the original device, and keep the existing file.";
  }
  if (error instanceof RecoveryPinLockError) {
    return language === "ko"
      ? error.message
      : "Remove the PIN lock in Account settings before creating a recovery code. You can set it up again afterwards.";
  }
  if (language === "ko" && error instanceof Error) return error.message;
  return language === "ko" ? koFallback : enFallback;
}

export function useVaultBackupRecovery({
  identity,
  isVaultLocked,
  language,
  refreshEntries,
  remoteEnvelope,
  setLocalEnvelope,
  setPendingSyncCount,
  setRemoteEnvelope,
  showToast,
  theme,
}: UseVaultBackupRecoveryOptions) {
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [backupRecoveryInput, setBackupRecoveryInput] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [vaultBusy, setVaultBusy] = useState(false);

  const handleCreateRecoveryKit = useCallback(async () => {
    if (vaultBusy) return;
    setVaultBusy(true);
    try {
      if (identity) {
        const existingRemote = await downloadVaultEnvelope(identity.id);
        if (existingRemote) {
          setRemoteEnvelope(existingRemote);
          throw new Error(
            language === "ko"
              ? "기존 금고가 발견되었습니다. 새 코드를 만들지 말고 복구해 주세요."
              : "An existing vault was found. Recover it instead of creating a new code.",
          );
        }
      }
      const created = await createRecoveryKit();
      setLocalEnvelope(created.envelope);
      setRecoveryCode(created.recoveryCode);
      setPendingSyncCount((await getSyncSnapshot()).pending);
      await refreshEntries();
      if (identity) {
        try {
          await uploadVaultEnvelope(identity.id, created.envelope);
        } catch {
          showToast(
            language === "ko"
              ? "복구 코드는 만들었지만 서버 백업은 아직 완료되지 않았습니다."
              : "The recovery code was created, but the server backup is not complete yet.",
          );
          return;
        }
      }
      showToast(
        language === "ko"
          ? "복구 코드를 만들고 기록을 새 키로 암호화했습니다."
          : "Recovery code created and entries re-encrypted with a new key.",
      );
    } catch (error) {
      showToast(
        localizedError(
          error,
          language,
          "복구 코드를 만들지 못했습니다.",
          "We couldn’t create a recovery code.",
        ),
      );
    } finally {
      setVaultBusy(false);
    }
  }, [
    identity,
    language,
    refreshEntries,
    setLocalEnvelope,
    setPendingSyncCount,
    setRemoteEnvelope,
    showToast,
    vaultBusy,
  ]);

  const handleRecoverVault = useCallback(async () => {
    if (!remoteEnvelope || !recoveryInput.trim() || vaultBusy) return;
    setVaultBusy(true);
    try {
      await recoverVault(remoteEnvelope, recoveryInput);
      setLocalEnvelope(remoteEnvelope);
      setRemoteEnvelope(null);
      setRecoveryInput("");
      showToast(
        language === "ko"
          ? "복구 코드로 이 기기의 금고를 열었습니다."
          : "The vault was opened on this device with your recovery code.",
      );
    } catch (error) {
      showToast(
        localizedError(
          error,
          language,
          "금고를 복구하지 못했습니다.",
          "We couldn’t recover the vault.",
        ),
      );
    } finally {
      setVaultBusy(false);
    }
  }, [
    language,
    recoveryInput,
    remoteEnvelope,
    setLocalEnvelope,
    setRemoteEnvelope,
    showToast,
    vaultBusy,
  ]);

  const handleCopyRecoveryCode = useCallback(async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      showToast(language === "ko" ? "복구 코드를 복사했습니다." : "Recovery code copied.");
    } catch {
      showToast(
        language === "ko"
          ? "자동 복사하지 못했습니다. 코드를 직접 선택해 주세요."
          : "Automatic copy failed. Select and copy the code manually.",
      );
    }
  }, [language, recoveryCode, showToast]);

  const handleExportBackup = useCallback(async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const backup = await createEncryptedBackup();
      const url = URL.createObjectURL(
        new Blob([backup.json], { type: "application/json" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = backup.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast(
        language === "ko"
          ? `${backup.entryCount}개 기록의 암호화 백업을 내려받았습니다.`
          : `Downloaded an encrypted backup of ${backup.entryCount} ${backup.entryCount === 1 ? "entry" : "entries"}.`,
      );
    } catch (error) {
      showToast(
        localizedError(
          error,
          language,
          "암호화 백업을 만들지 못했습니다.",
          "We couldn’t create the encrypted backup.",
        ),
      );
    } finally {
      setBackupBusy(false);
    }
  }, [backupBusy, language, showToast]);

  const handleImportBackup = useCallback(
    async (file?: File) => {
      if (!file || backupBusy) return;
      if (!backupRecoveryInput.trim()) {
        showToast(
          language === "ko"
            ? "백업을 복구할 코드를 먼저 입력해 주세요."
            : "Enter the recovery code before importing the backup.",
        );
        return;
      }
      if (file.size > ENCRYPTED_BACKUP_MAX_BYTES) {
        showToast(
          language === "ko"
            ? "100MB 이하의 암호화 백업만 가져올 수 있습니다."
            : "Encrypted backups must be 100MB or smaller.",
        );
        return;
      }
      setBackupBusy(true);
      try {
        const result = await importEncryptedBackup(
          await file.text(),
          backupRecoveryInput,
        );
        const [envelope, snapshot] = await Promise.all([
          getLocalVaultEnvelope(),
          getSyncSnapshot(),
        ]);
        setLocalEnvelope(envelope);
        setPendingSyncCount(snapshot.pending);
        setBackupRecoveryInput("");
        await refreshEntries();
        showToast(
          language === "ko"
            ? `${result.entries}개 기록을 암호화 상태로 복구했습니다.`
            : `Restored ${result.entries} encrypted ${result.entries === 1 ? "entry" : "entries"}.`,
        );
      } catch (error) {
        showToast(
          localizedError(
            error,
            language,
            "암호화 백업을 가져오지 못했습니다.",
            "We couldn’t import the encrypted backup.",
          ),
        );
      } finally {
        setBackupBusy(false);
      }
    },
    [
      backupBusy,
      backupRecoveryInput,
      language,
      refreshEntries,
      setLocalEnvelope,
      setPendingSyncCount,
      showToast,
    ],
  );

  const handleExportDiagnostics = useCallback(async () => {
    try {
      await downloadDiagnosticReport({ language, theme, isVaultLocked });
      showToast(
        language === "ko"
          ? "개인정보가 미포함된 진단 정보 리포트를 내려받았습니다."
          : "Downloaded privacy-safe diagnostic report.",
      );
    } catch {
      showToast(
        language === "ko"
          ? "진단 정보를 생성하지 못했습니다."
          : "Failed to generate diagnostic report.",
      );
    }
  }, [isVaultLocked, language, showToast, theme]);

  return {
    backupBusy,
    backupRecoveryInput,
    handleCopyRecoveryCode,
    handleCreateRecoveryKit,
    handleExportBackup,
    handleExportDiagnostics,
    handleImportBackup,
    handleRecoverVault,
    recoveryCode,
    recoveryInput,
    setBackupRecoveryInput,
    setRecoveryCode,
    setRecoveryInput,
    vaultBusy,
  };
}
