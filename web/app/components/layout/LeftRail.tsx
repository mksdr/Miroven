import { PersonaAvatar, usePersonaDisplay } from "../persona/PersonaContext";
import { memo } from "react";
import type { Language } from "../../hooks/useAppearance";
import { COPY, type JournalCopy, T } from "../../lib/journal-copy";

export interface LeftRailProps {
  activeTab: "journal" | "search";
  language: Language;
  copy: JournalCopy;
  online: boolean;
  onSelectTab: (tab: "journal" | "search") => void;
  onOpenPersona?: () => void;
  personaLoading?: boolean;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
}

export const LeftRail = memo(function LeftRail({
  activeTab,
  language,
  copy: t,
  online,
  onSelectTab,
  onOpenPersona,
  personaLoading = false,
  onOpenAccount,
  onOpenSettings,
}: LeftRailProps) {
  const persona = usePersonaDisplay(language);
  return (
    <aside className="left-rail" aria-label="주요 메뉴">
      <a className="brand" href="#top" aria-label="Miroven">
        <span className="brand-mark" aria-hidden="true">M</span>
        <span className="brand-word">Miroven</span>
      </a>

      <nav className="rail-nav">
        <button
          className={`nav-item ${activeTab === "journal" ? "active" : ""}`}
          type="button"
          onClick={() => onSelectTab("journal")}
          aria-label={t.journal}
        >
          <svg viewBox="0 0 24 24" className="nav-icon-svg" aria-hidden="true">
            <path fill="currentColor" d="M12 2.69l7 7V20a1 1 0 0 1-1 1h-4v-6H10v6H6a1 1 0 0 1-1-1V9.69l7-7z" />
          </svg>
          <span className="nav-label"><T ko={COPY.ko.journal} en={COPY.en.journal} /></span>
        </button>
        <button
          className={`nav-item ${activeTab === "search" ? "active" : ""}`}
          type="button"
          onClick={() => onSelectTab("search")}
          aria-label={t.search}
        >
          <svg viewBox="0 0 24 24" className="nav-icon-svg" aria-hidden="true">
            <path fill="currentColor" d="M21.53 20.47l-5.35-5.35a8.5 8.5 0 1 0-1.06 1.06l5.35 5.35a.75.75 0 0 0 1.06-1.06zM3.5 10.5a7 7 0 1 1 14 0 7 7 0 0 1-14 0z" />
          </svg>
          <span className="nav-label"><T ko={COPY.ko.search} en={COPY.en.search} /></span>
        </button>
        <button
          className="nav-item"
          type="button"
          aria-label={t.account}
          onClick={onOpenAccount}
        >
          <svg viewBox="0 0 24 24" className="nav-icon-svg" aria-hidden="true">
            <path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 10.5c-4.14 0-7.5 2.58-7.5 5.75v1.25a.75.75 0 0 0 .75.75h13.5a.75.75 0 0 0 .75-.75v-1.25c0-3.17-3.36-5.75-7.5-5.75z" />
          </svg>
          <span className="nav-label"><T ko={COPY.ko.account} en={COPY.en.account} /></span>
        </button>
        <button
          className="nav-item"
          type="button"
          aria-label={t.display}
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 24 24" className="nav-icon-svg" aria-hidden="true">
            <path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-5.4-5.4c0-1.81.89-3.41 2.26-4.4C12.92 3.04 12.46 3 12 3z" />
          </svg>
          <span className="nav-label"><T ko={COPY.ko.display} en={COPY.en.display} /></span>
        </button>
      </nav>

      <a className="compose-rail-button" href="#composer" onClick={() => onSelectTab("journal")}>
        <T ko={COPY.ko.write} en={COPY.en.write} />
      </a>

      <button type="button" className="rail-profile" disabled={personaLoading} aria-busy={personaLoading} onClick={event => { event.currentTarget.focus({ preventScroll: true }); onOpenPersona?.(); }} aria-label={language === "ko" ? "프로필 편집" : "Edit profile"}>
        <PersonaAvatar language={language} small />
        <span className="profile-copy">
          <strong>{persona.name}</strong>
          <span>{persona.handle}</span>
        </span>
        <span className={`online-dot ${online ? "" : "offline"}`} title={online ? t.online : t.offline} />
      </button>
    </aside>
  );
});
