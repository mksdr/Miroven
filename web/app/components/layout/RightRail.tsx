import { memo } from "react";
import type { Language } from "../../hooks/useAppearance";
import type { JournalCopy } from "../../lib/journal-copy";
import type { VaultEnvelope } from "../../lib/local-vault";

export interface RightRailProps {
  language: Language;
  copy: JournalCopy;
  date: { day: string; detail: string };
  localEnvelope: VaultEnvelope | null;
  storageEstimate: {
    usedMB: string;
    totalMB: string;
    percent: number;
    isLow: boolean;
    remainingMB: string;
  } | null;
  isPersistentStorage: boolean;
  onRequestPersistent: () => void;
  identityEmail: string | null;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
}

export const RightRail = memo(function RightRail({
  language,
  copy: t,
  date,
  localEnvelope,
  storageEstimate,
  isPersistentStorage,
  onRequestPersistent,
  identityEmail,
  onOpenAccount,
  onOpenSettings,
}: RightRailProps) {
  return (
    <aside className="right-rail" aria-label="오늘과 보안 정보">
      <section className="side-card date-card">
        <p className="eyebrow">{t.today}</p>
        <div className="date-number" suppressHydrationWarning>{date.day}</div>
        <div className="date-detail" suppressHydrationWarning>{date.detail}</div>
      </section>

      <section className="side-card">
        <p className="eyebrow">{t.privacy}</p>
        <h2>{t.privacyTitle}</h2>
        <p>{t.privacyDetail}</p>
        <div className="security-list">
          <div className="security-row">
            <span>{t.localStorage}</span>
            <strong>AES-256-GCM</strong>
          </div>
          <div className="security-row">
            <span>{t.imageProcessing}</span>
            <strong>1000px · EXIF</strong>
          </div>
          <div className="security-row">
            <span>{t.sharing}</span>
            <strong>{t.none}</strong>
          </div>
          <div className="security-row">
            <span>{t.recoveryReady}</span>
            <strong>{localEnvelope ? t.done : t.needed}</strong>
          </div>
        </div>
      </section>

      <section className="side-card">
        <p className="eyebrow">{t.storageUsage}</p>
        <h2>{t.localStorage}</h2>
        {storageEstimate ? (
          <p>{t.storageInfo(storageEstimate.usedMB, storageEstimate.totalMB)} ({storageEstimate.percent}%)</p>
        ) : null}
        <div className="security-list">
          <div className="security-row">
            <span>{t.persistentStorage}</span>
            <strong>{isPersistentStorage ? (language === "ko" ? "승인" : "Granted") : (language === "ko" ? "미승인" : "Not granted")}</strong>
          </div>
        </div>
        {!isPersistentStorage ? (
          <button
            className="edit-button full-width-button"
            type="button"
            onClick={onRequestPersistent}
          >
            {t.requestPersistent}
          </button>
        ) : null}
      </section>

      <section className="side-card account-card" id="account">
        <p className="eyebrow">{t.accountSync}</p>
        <p className="side-card-description">
          {identityEmail ?? t.localMode}
        </p>
        <button
          type="button"
          className="edit-button side-card-button"
          onClick={onOpenAccount}
        >
          {language === "ko" ? "계정 설정 열기" : "Account Settings"}
        </button>
      </section>

      <section className="side-card display-card">
        <p className="eyebrow">{t.display}</p>
        <h2>{t.settingsTitle}</h2>
        <p>{t.settingsDetail}</p>
        <button type="button" onClick={onOpenSettings}>{t.openSettings}</button>
      </section>
    </aside>
  );
});
