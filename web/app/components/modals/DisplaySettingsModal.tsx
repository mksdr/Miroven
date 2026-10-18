import type { FontScale, Language, Theme } from "../../hooks/useAppearance";
import type { JournalCopy } from "../../lib/journal-copy";

export interface DisplaySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  pinSetupOpen: boolean;
  pinRemoveOpen?: boolean;
  deleteModalOpen: boolean;
  language: Language;
  theme: Theme;
  fontScale: FontScale;
  lowSpecMode: boolean;
  copy: JournalCopy;
  onLanguageChange: (lang: Language) => void;
  onThemeChange: (theme: Theme) => void;
  onFontScaleChange: (scale: FontScale) => void;
  onToggleLowSpecMode: (lowSpec: boolean) => void;
}

export function DisplaySettingsModal({
  isOpen,
  onClose,
  pinSetupOpen,
  pinRemoveOpen = false,
  deleteModalOpen,
  language,
  theme,
  fontScale,
  lowSpecMode,
  copy: t,
  onLanguageChange,
  onThemeChange,
  onFontScaleChange,
  onToggleLowSpecMode,
}: DisplaySettingsModalProps) {
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
        aria-labelledby="settings-title"
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
            <h2 id="settings-title">{t.settingsDialog}</h2>
            <p>{t.settingsIntro}</p>
          </div>
        </header>

        <fieldset className="settings-group">
          <legend>{t.language}</legend>
          <div className="choice-row two-up">
            <button className={language === "ko" ? "selected" : ""} type="button" onClick={() => onLanguageChange("ko")}>
              <span className="radio-dot" />{t.korean}
            </button>
            <button className={language === "en" ? "selected" : ""} type="button" onClick={() => onLanguageChange("en")}>
              <span className="radio-dot" />{t.english}
            </button>
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{t.theme}</legend>
          <div className="choice-row theme-row">
            {(["light", "dim", "dark", "high-contrast"] as Theme[]).map((option) => (
              <button
                key={option}
                className={`${theme === option ? "selected" : ""} theme-choice theme-${option}`}
                type="button"
                onClick={() => onThemeChange(option)}
              >
                <span className="theme-preview"><span /></span>
                <span>
                  {option === "light"
                    ? t.light
                    : option === "dim"
                    ? t.dim
                    : option === "dark"
                    ? t.dark
                    : t.highContrast}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{t.fontSize}</legend>
          <div className="choice-row three-up">
            {(["normal", "large", "xlarge"] as FontScale[]).map((scaleOption) => (
              <button
                key={scaleOption}
                className={fontScale === scaleOption ? "selected" : ""}
                type="button"
                onClick={() => onFontScaleChange(scaleOption)}
              >
                <span className="radio-dot" />
                <span>
                  {scaleOption === "normal"
                    ? t.fontSizeNormal
                    : scaleOption === "large"
                    ? t.fontSizeLarge
                    : t.fontSizeXLarge}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="settings-group">
          <legend>{language === "ko" ? "저사양 기기 최적화 모드" : "Low-Spec Device Mode"}</legend>
          <div className="choice-row two-up">
            <button
              className={!lowSpecMode ? "selected" : ""}
              type="button"
              onClick={() => onToggleLowSpecMode(false)}
            >
              <span className="radio-dot" />
              <span>{language === "ko" ? "기본 (화려한 효과)" : "Standard (Full FX)"}</span>
            </button>
            <button
              className={lowSpecMode ? "selected" : ""}
              type="button"
              onClick={() => onToggleLowSpecMode(true)}
            >
              <span className="radio-dot" />
              <span>{language === "ko" ? "저사양 최적화 (빠른 반응)" : "Optimized (Fast & Smooth)"}</span>
            </button>
          </div>
        </fieldset>

        <button className="settings-done" type="button" onClick={onClose}>{t.done}</button>
      </section>
    </div>
  );
}
