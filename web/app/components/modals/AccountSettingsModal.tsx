import type React from "react";
import Link from "next/link";
import type { Language } from "../../hooks/useAppearance";
import type { JournalCopy } from "../../lib/journal-copy";
import {
  ENCRYPTED_BACKUP_ACCEPT,
  type SyncStatus,
  type VaultEnvelope,
} from "../../lib/local-vault";
import type { AuthIdentity } from "../../lib/remote";
import { AccountSyncContent } from "../account/AccountSyncContent";
import { EncryptedBackupContent } from "../account/EncryptedBackupContent";
import { websiteLinks } from "../../lib/site-config";

export interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pinSetupOpen: boolean;
  pinRemoveOpen?: boolean;
  deleteModalOpen: boolean;
  language: Language;
  copy: JournalCopy;
  isApiConfigured: boolean;
  authLoading: boolean;
  identity: AuthIdentity | null;
  syncSummary: { title: string; detail: string };
  canSync: boolean;
  syncStatus: SyncStatus;
  authStep: "email" | "otp";
  email: string;
  otpCode: string;
  authSending: boolean;
  otpVerifying: boolean;
  localEnvelope: VaultEnvelope | null;
  entryCount: number;
  backupBusy: boolean;
  backupRecoveryInput: string;
  isPinConfigured: boolean;
  onEmailChange: (value: string) => void;
  onOtpCodeChange: (value: string) => void;
  onSubmitEmail: (event: React.FormEvent<HTMLFormElement>) => void;
  onSubmitOtp: (event: React.FormEvent<HTMLFormElement>) => void;
  onResetOtp: () => void;
  onSync: () => void;
  onSignOut: () => void;
  onSignOutAll?: () => void;
  onOpenDeleteAccount: () => void;
  onOpenLocalDeleteAccount?: () => void;
  onExportBackup: () => void;
  onBackupRecoveryInputChange: (value: string) => void;
  onImportBackup: (file?: File) => void;
  onRemovePin: () => void;
  onOpenPinSetup: () => void;
  onExportDiagnostics: () => void;
}

export function AccountSettingsModal({
  isOpen,
  onClose,
  pinSetupOpen,
  pinRemoveOpen = false,
  deleteModalOpen,
  language,
  copy: t,
  isApiConfigured,
  authLoading,
  identity,
  syncSummary,
  canSync,
  syncStatus,
  authStep,
  email,
  otpCode,
  authSending,
  otpVerifying,
  localEnvelope,
  entryCount,
  backupBusy,
  backupRecoveryInput,
  isPinConfigured,
  onEmailChange,
  onOtpCodeChange,
  onSubmitEmail,
  onSubmitOtp,
  onResetOtp,
  onSync,
  onSignOut,
  onSignOutAll,
  onOpenDeleteAccount,
  onOpenLocalDeleteAccount,
  onExportBackup,
  onBackupRecoveryInputChange,
  onImportBackup,
  onRemovePin,
  onOpenPinSetup,
  onExportDiagnostics,
}: AccountSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && !pinSetupOpen && !pinRemoveOpen && !deleteModalOpen) {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="settings-dialog-header">
          <button className="dialog-close" type="button" onClick={onClose} aria-label={t.close}>×</button>
          <div>
            <h2 id="account-dialog-title">{t.account}</h2>
            <p>{language === "ko" ? "계정 동기화, 백업 및 보안 설정" : "Account sync, backup, and security settings"}</p>
          </div>
        </header>

        <fieldset className="settings-group">
          <legend>{t.accountSync}</legend>
          <div className="settings-section-row">
            <AccountSyncContent
              inputId="modal-auth-email"
              copy={t}
              isConfigured={isApiConfigured}
              isLoading={authLoading}
              isSignedIn={Boolean(identity)}
              identityEmail={identity?.email ?? null}
              identityId={identity?.id}
              language={language}
              syncSummary={syncSummary}
              canSync={canSync}
              isSyncing={syncStatus === "syncing"}
              authStep={authStep}
              email={email}
              otpCode={otpCode}
              isSending={authSending}
              isVerifying={otpVerifying}
              deleteAccountLabel={language === "ko" ? "계정 및 모든 데이터 삭제" : "Delete account & all data"}
              onEmailChange={onEmailChange}
              onOtpCodeChange={onOtpCodeChange}
              onSubmitEmail={onSubmitEmail}
              onSubmitOtp={onSubmitOtp}
              onResetOtp={onResetOtp}
              onSync={onSync}
              onSignOut={onSignOut}
              onSignOutAll={onSignOutAll}
              onDeleteAccount={onOpenDeleteAccount}
            />
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{t.encryptedBackup}</legend>
          <div className="settings-section-row">
            <p className="settings-section-title">{t.backupTitle}</p>
            <EncryptedBackupContent
              inputId="modal-backup"
              copy={t}
              hasLocalEnvelope={Boolean(localEnvelope)}
              entryCount={entryCount}
              busy={backupBusy}
              recoveryInput={backupRecoveryInput}
              acceptedFileTypes={ENCRYPTED_BACKUP_ACCEPT}
              onExport={onExportBackup}
              onRecoveryInputChange={onBackupRecoveryInputChange}
              onImport={onImportBackup}
            />
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{language === "ko" ? "PIN 암호화 잠금" : "PIN Vault Lock"}</legend>
          <div className="settings-section-row font-13">
            <p className="settings-section-desc">
              {isPinConfigured
                ? language === "ko"
                  ? "🔒 PIN 번호로 기기 금고 키가 암호화 보호되고 있습니다."
                  : "🔒 Vault key is encrypted with your PIN."
                : language === "ko"
                ? "PIN 번호를 설정하면 기기 금고 키를 암호화하여 타인의 무단 열람을 방지합니다 (오프라인 공격 대비 6자리 이상 권장)."
                : "Set a PIN to encrypt your local vault key (6+ digits recommended against offline attacks)."}
            </p>
            {isPinConfigured ? (
              <button
                type="button"
                className="delete-button text-danger"
                onClick={onRemovePin}
              >
                {language === "ko" ? "PIN 잠금 해제" : "Remove PIN Lock"}
              </button>
            ) : (
              <button
                type="button"
                className="edit-button"
                onClick={onOpenPinSetup}
              >
                {language === "ko" ? "PIN 잠금 설정" : "Setup PIN Lock"}
              </button>
            )}
          </div>
        </fieldset>

        {!identity && (
          <fieldset className="settings-group">
            <legend>{language === "ko" ? "로컬 금고 초기화" : "Local Vault Reset"}</legend>
            <div className="settings-section-row font-13">
              <p className="settings-section-desc">
                {language === "ko"
                  ? "이 기기에 저장된 기록, 사진, 금고 키와 PIN을 삭제합니다. 서버 계정과 데이터, 다른 기기의 기록 및 내보낸 백업은 유지됩니다."
                  : "Delete entries, photos, vault keys, and the PIN stored on this device. Your server account and data, entries on other devices, and exported backups are preserved."}
              </p>
              <button
                type="button"
                className="edit-button"
                onClick={onOpenLocalDeleteAccount ?? onOpenDeleteAccount}
              >
                {language === "ko" ? "이 기기의 로컬 금고 초기화" : "Clear this device's local vault"}
              </button>
            </div>
          </fieldset>
        )}

        <fieldset className="settings-group">
          <legend>{language === "ko" ? "진단 및 문제 신고" : "Diagnostics & Support"}</legend>
          <div className="settings-section-row font-13">
            <p className="settings-section-desc">
              {language === "ko"
                ? "일기 본문, 사진, 복구 코드가 완전히 배제된 기술 상태 정보만 포함된 JSON 리포트를 내보냅니다."
                : "Export a JSON report containing system metrics with zero entry text, photos, or secret keys."}
            </p>
            <button
              type="button"
              className="edit-button"
              onClick={onExportDiagnostics}
            >
              {language === "ko" ? "진단 정보 리포트 내보내기" : "Export Diagnostic Report"}
            </button>
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{language === "ko" ? "Miroven 및 정책" : "Miroven & Policies"}</legend>
          <div className="choice-row three-up">
            <a
              href={websiteLinks.about}
              target="_blank"
              rel="noopener noreferrer"
              className="legal-nav-btn"
            >
              <span>{language === "ko" ? "Miroven 소개 ↗" : "About Miroven ↗"}</span>
            </a>
            <a
              href={websiteLinks.terms}
              target="_blank"
              rel="noopener noreferrer"
              className="legal-nav-btn"
            >
              <span>{language === "ko" ? "서비스 이용약관 ↗" : "Terms of Service ↗"}</span>
            </a>
            <a
              href={websiteLinks.privacy}
              target="_blank"
              rel="noopener noreferrer"
              className="legal-nav-btn"
            >
              <span>{language === "ko" ? "개인정보처리방침 ↗" : "Privacy Policy ↗"}</span>
            </a>
          </div>
          <p className="settings-notice-link">
            <a href="/guide" target="_blank" rel="noopener noreferrer">
              {language === "ko" ? "사용 안내" : "User guide"}
              <span className="sr-only">{language === "ko" ? " (새 탭)" : " (new tab)"}</span>
            </a>
            {" "}<span aria-hidden="true">|</span>{" "}
            <Link href="/notice">
              {language === "ko" ? "저작권 및 오픈 소스 라이선스" : "Copyright & Open Source Licenses"}
            </Link>
          </p>
        </fieldset>

        <button className="settings-done" type="button" onClick={onClose}>{t.done}</button>
      </section>
    </div>
  );
}
