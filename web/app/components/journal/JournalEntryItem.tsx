"use client";

import { PersonaAvatar, usePersonaDisplay } from "../persona/PersonaContext";
import dynamic from "next/dynamic";
import { memo } from "react";
import type {
  JournalEntrySummary,
  JournalReader,
  SyncStatus,
  VaultEnvelope,
} from "../../lib/local-vault";
import { entryImages } from "../../lib/journal-images";
import { JournalEntryImage } from "./JournalEntryImage";
import { JournalQuoteCard } from "./JournalQuoteCard";
import { JournalEntryText } from "./JournalEntryText";
import type { Language } from "../../hooks/useAppearance";

const ConflictResolver = dynamic(
  () => import("../ConflictResolver").then((module) => module.ConflictResolver),
  { ssr: false },
);

export type { SyncStatus };

type EntryCopy = {
  profileName: string;
  profileHandle: string;
  editEntry: string;
  edit: string;
  deleteEntry: string;
  entryPhoto: string;
};

let cachedDateTimeFormatCtor: typeof Intl.DateTimeFormat | null = null;
const entryTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function getEntryTimeFormatter(language: Language, sameDay: boolean): Intl.DateTimeFormat {
  if (cachedDateTimeFormatCtor !== Intl.DateTimeFormat) {
    cachedDateTimeFormatCtor = Intl.DateTimeFormat;
    entryTimeFormatters.clear();
  }
  const key = `${language}:${sameDay ? "same" : "other"}`;
  let formatter = entryTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
      ...(sameDay ? {} : { month: "short", day: "numeric" }),
      hour: "numeric",
      minute: "2-digit",
    });
    entryTimeFormatters.set(key, formatter);
  }
  return formatter;
}

function formatEntryTime(value: string, language: Language): string {
  const date = new Date(value);
  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  return getEntryTimeFormatter(language, sameDay).format(date);
}

function getEntrySyncBadge(
  localEnvelope: unknown,
  syncStatus: SyncStatus,
  language: Language,
) {
  if (!localEnvelope) {
    return {
      label: language === "ko" ? "기기에 암호화됨" : "Encrypted on device",
      className: "status-local",
    };
  }
  switch (syncStatus) {
    case "synced":
      return { label: language === "ko" ? "동기화됨" : "Synced", className: "status-synced" };
    case "syncing":
    case "ready":
      return { label: language === "ko" ? "동기화 대기" : "Sync pending", className: "status-pending" };
    case "conflict":
      return { label: language === "ko" ? "충돌" : "Conflict", className: "status-conflict" };
    case "error":
      return {
        label: language === "ko" ? "오류 (재시도 대기)" : "Sync error",
        className: "status-error",
      };
    default:
      return {
        label: language === "ko" ? "기기에 암호화됨" : "Encrypted on device",
        className: "status-local",
      };
  }
}

type JournalEntryItemProps = {
  entry: JournalEntrySummary;
  reader: JournalReader;
  language: Language;
  searchQuery: string;
  onSearchHashtag?: (tag: string) => void;
  syncStatus: SyncStatus;
  localEnvelope: VaultEnvelope | null;
  t: EntryCopy;
  isFocused?: boolean;
  pinning?: boolean;
  onTogglePin?: (entry: JournalEntrySummary) => Promise<void>;
  onStartEditing: (entry: JournalEntrySummary) => void;
  onQuote?: (entry: JournalEntrySummary) => void;
  quoteEntries?: ReadonlyMap<string, JournalEntrySummary>;
  onOpenEntry?: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onResolveUseLocal: (id: string) => Promise<void>;
  onResolveKeepBoth: (id: string) => Promise<void>;
  onSelectImage?: (src: string, alt: string, gallery?: Array<{ src: string; alt: string }>, index?: number) => void;
};

export const JournalEntryItem = memo(function JournalEntryItem({
  entry,
  reader,
  language,
  searchQuery,
  onSearchHashtag,
  syncStatus,
  localEnvelope,
  t,
  isFocused = false,
  pinning = false,
  onTogglePin,
  onStartEditing,
  onQuote,
  quoteEntries,
  onOpenEntry,
  onDelete,
  onResolveUseLocal,
  onResolveKeepBoth,
  onSelectImage,
}: JournalEntryItemProps) {
  const persona = usePersonaDisplay(language);
  const badge = getEntrySyncBadge(localEnvelope, syncStatus, language);
  const formattedTime = formatEntryTime(entry.createdAt, language);

  return (
    <li
      className={`entry ${isFocused ? "timeline-item-focused" : ""}`}
      tabIndex={0}
      aria-label={`${persona.name}, ${formattedTime}`}
    >
      <PersonaAvatar language={language} />
      <article className="entry-content">
        {entry.pinnedAt ? (
          <div className="entry-pin-label"><span aria-hidden="true">📌</span> {language === "ko" ? "고정된 기록" : "Pinned entry"}</div>
        ) : null}
        <header className="entry-head">
          <div className="entry-author">
            <strong>{persona.name}</strong>
            <span>{persona.handle}</span>
            <time dateTime={entry.createdAt}>{formattedTime}</time>
          </div>
          <button
            className="delete-button"
            type="button"
            onClick={() => void onDelete(entry.id)}
            aria-label={t.deleteEntry}
          >
            ···
          </button>
        </header>
        {syncStatus === "conflict" ? (
          <ConflictResolver
            entry={entry}
            language={language}
            onResolveUseLocal={onResolveUseLocal}
            onResolveKeepBoth={onResolveKeepBoth}
          />
        ) : null}
        {entry.text ? (
          <p className="entry-text"><JournalEntryText text={entry.text} searchQuery={searchQuery} onSearchHashtag={onSearchHashtag} /></p>
        ) : null}
        {entryImages(entry).length > 0 ? (
          <JournalEntryImage entry={entry} reader={reader} language={language} alt={t.entryPhoto} onSelect={onSelectImage} />
        ) : null}
        {entry.quotedEntryId && quoteEntries && onOpenEntry ? <JournalQuoteCard
          id={entry.quotedEntryId} entries={quoteEntries} reader={reader} language={language} onOpen={onOpenEntry} onSearchHashtag={onSearchHashtag} /> : null}
        <footer className="entry-footer">
          <div className="entry-actions">
            {onQuote ? <button className="entry-action" type="button" onClick={() => onQuote(entry)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11V9a3 3 0 0 1 3-3h15m-4-4 4 4-4 4M21 13v2a3 3 0 0 1-3 3H3m4-4-4 4 4 4" /></svg>
              <span>{language === "ko" ? "인용" : "Quote"}</span>
            </button> : null}
            {onTogglePin ? <button
              className="entry-action entry-pin-button"
              type="button"
              aria-label={language === "ko" ? entry.pinnedAt ? "기록 고정 해제" : "기록 고정" : entry.pinnedAt ? "Unpin entry" : "Pin entry"}
              aria-pressed={Boolean(entry.pinnedAt)}
              disabled={pinning}
              onClick={() => void onTogglePin(entry)}
              title={language === "ko" ? entry.pinnedAt ? "고정 해제" : "최대 3개까지 고정할 수 있습니다." : entry.pinnedAt ? "Unpin entry" : "Pin up to 3 entries."}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6m-5 0v6l-4 5v2h12v-2l-4-5V3M12 16v5" /></svg>
              <span>{language === "ko" ? "고정" : "Pin"}</span>
            </button> : null}
            <button className="entry-action" type="button" onClick={() => onStartEditing(entry)} aria-label={t.editEntry}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6Z" /></svg>
              <span>{t.edit}</span>
            </button>
          </div>
          <div className={`entry-status ${badge.className}`}>
            <span aria-hidden="true">◇</span> {badge.label}
          </div>
        </footer>
      </article>
    </li>
  );
});
