import type { ReactNode } from "react";
import type { Language } from "../../hooks/useAppearance";
import type { JournalCopy } from "../../lib/journal-copy";

/** Lightweight shell shared by the loading state and loaded Account settings. */
export function AccountSettingsDialog({ onClose, blockEscape = false, busy = false, language, copy: t, children }: {
  onClose: () => void;
  blockEscape?: boolean;
  busy?: boolean;
  language: Language;
  copy: JournalCopy;
  children: ReactNode;
}) {
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
        aria-busy={busy || undefined}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && !blockEscape) {
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

        {children}
      </section>
    </div>
  );
}
