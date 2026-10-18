"use client";

import type { Language, Theme } from "../../hooks/useAppearance";

type VaultLockScreenProps = {
  copy: {
    unlockVault: string;
    vaultLockedDetail: string;
    vaultLockedTitle: string;
  };
  isPinConfigured: boolean;
  language: Language;
  lowSpecMode: boolean;
  onPinInputChange: (value: string) => void;
  onPinUnlock: () => Promise<void>;
  onUnlock: () => Promise<void>;
  pinError: string | null;
  pinInput: string;
  theme: Theme;
};

export function VaultLockScreen({
  copy,
  isPinConfigured,
  language,
  lowSpecMode,
  onPinInputChange,
  onPinUnlock,
  onUnlock,
  pinError,
  pinInput,
  theme,
}: VaultLockScreenProps) {
  return (
    <div className={`app-shell theme-${theme} ${lowSpecMode ? "low-spec-mode" : ""}`}>
      <div className="lock-screen-overlay">
        <div className="lock-card">
          <div className="lock-icon" aria-hidden="true">🔒</div>
          <h2>{copy.vaultLockedTitle}</h2>
          <p>{copy.vaultLockedDetail}</p>
          {isPinConfigured ? (
            <form
              className="pin-unlock-form"
              onSubmit={(event) => {
                event.preventDefault();
                void onPinUnlock();
              }}
            >
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pinInput}
                onChange={(event) => onPinInputChange(event.target.value)}
                placeholder={language === "ko" ? "PIN 번호 입력" : "Enter PIN"}
                className="search-input pin-unlock-input"
                autoFocus
              />
              {pinError ? (
                <p className="pin-error-text">
                  {pinError}
                </p>
              ) : null}
              <button
                className="settings-done btn-full-width"
                type="submit"
                disabled={!pinInput.trim()}
              >
                {language === "ko" ? "PIN으로 잠금 해제" : "Unlock with PIN"}
              </button>
            </form>
          ) : (
            <button
              className="settings-done btn-center-block"
              type="button"
              onClick={() => void onUnlock()}
            >
              {copy.unlockVault}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
