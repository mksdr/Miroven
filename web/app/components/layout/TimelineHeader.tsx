import { memo } from "react";
import type { Language } from "../../hooks/useAppearance";
import { COPY, type JournalCopy, T } from "../../lib/journal-copy";

export interface TimelineHeaderProps {
  activeTab: "journal" | "search";
  language: Language;
  copy: JournalCopy;
  onOpenShortcuts: () => void;
  onManualLock: () => void;
}

export const TimelineHeader = memo(function TimelineHeader({
  activeTab,
  language,
  copy: t,
  onOpenShortcuts,
  onManualLock,
}: TimelineHeaderProps) {
  return (
    <header className="timeline-header">
      <div className="timeline-title">
        <strong>
          {activeTab === "search" ? t.search : <T ko={COPY.ko.timelineTitle} en={COPY.en.timelineTitle} />}
        </strong>
        <span>
          {activeTab === "search"
            ? language === "ko"
              ? "기록 검색 및 필터"
              : "Search & filter entries"
            : <T ko={COPY.ko.timelineSubtitle} en={COPY.en.timelineSubtitle} />}
        </span>
      </div>
      <div className="timeline-header-actions">
        <button
          className="edit-button"
          type="button"
          onClick={onOpenShortcuts}
          aria-label={language === "ko" ? "키보드 단축키 안내 (?)" : "Keyboard Shortcuts (?)"}
          title={language === "ko" ? "키보드 단축키 안내 (?)" : "Keyboard Shortcuts (?)"}
        >
          ⌨️ {language === "ko" ? "단축키 (?)" : "Shortcuts (?)"}
        </button>
        <span className="lock-pill"><span aria-hidden="true">●</span> {t.encrypted}</span>
        <button
          className="edit-button"
          type="button"
          onClick={onManualLock}
          aria-label={t.lockVault}
        >
          🔒 {t.lockVault}
        </button>
      </div>
    </header>
  );
});
