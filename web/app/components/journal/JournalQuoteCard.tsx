"use client";

import { useEffect, useState } from "react";
import type { JournalEntrySummary, JournalReader } from "../../lib/local-vault";
import { entryImages } from "../../lib/journal-images";
import { JournalEntryImage } from "./JournalEntryImage";
import { JournalEntryText } from "./JournalEntryText";

export function QuoteUnavailable({ id, entries, reader, language }: {
  id: string; entries: ReadonlyMap<string, JournalEntrySummary>; reader: JournalReader; language: "ko" | "en";
}) {
  const [state, setState] = useState<{ entries: typeof entries; id: string; value: "deleted" | "missing" | "error" }>();
  useEffect(() => {
    const controller = new AbortController();
    void reader.missingQuoteState(id, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) setState({ entries, id, value });
    }).catch(() => {
      if (!controller.signal.aborted) setState({ entries, id, value: "error" });
    });
    return () => controller.abort();
  }, [entries, id, reader]);
  const value = state?.entries === entries && state.id === id ? state.value : undefined;
  return <p className="quote-unavailable" role="status">{value === "deleted"
    ? language === "ko" ? "삭제된 기록입니다." : "This entry was deleted."
    : value === "missing" ? language === "ko" ? "원문을 아직 불러오지 못했습니다." : "The original entry has not arrived yet."
    : value === "error" ? language === "ko" ? "원문을 확인하지 못했습니다." : "Could not check the original entry."
    : language === "ko" ? "원문 확인 중…" : "Checking original entry…"}</p>;
}

let quoteFormatterCtor: typeof Intl.DateTimeFormat | null = null;
const quoteFormatters = new Map<"ko" | "en", Intl.DateTimeFormat>();

function formatQuoteDate(value: string, language: "ko" | "en"): string {
  if (quoteFormatterCtor !== Intl.DateTimeFormat) {
    quoteFormatterCtor = Intl.DateTimeFormat;
    quoteFormatters.clear();
  }
  let formatter = quoteFormatters.get(language);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    quoteFormatters.set(language, formatter);
  }
  return formatter.format(new Date(value));
}

export function JournalQuoteCard({ id, entries, reader, language, onOpen, onSearchHashtag }: {
  id: string; entries: ReadonlyMap<string, JournalEntrySummary>; reader: JournalReader;
  language: "ko" | "en"; onOpen: (id: string) => void;
  onSearchHashtag?: (tag: string) => void;
}) {
  const original = entries.get(id);
  const hasPhotos = original && entryImages(original).length > 0;
  return <div className={`quote-card${hasPhotos ? " quote-card-with-photo" : ""}`}>
    {original ? <>
      <button type="button" className="quote-card-open" aria-label={language === "ko" ? "원문 보기" : "View original"}
        onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); onOpen(id); }} />
      <div className="quote-card-date">{language === "ko" ? "이전 기록 · " : "Quoted entry · "}
        <time dateTime={original.createdAt}>{formatQuoteDate(original.createdAt, language)}</time>
      </div>
      {original.text ? <p className="quote-card-text"><JournalEntryText text={original.text} onSearchHashtag={onSearchHashtag} /></p> : null}
      {hasPhotos ? <JournalEntryImage entry={original} reader={reader} language={language} alt={language === "ko" ? "인용한 기록의 사진" : "Photo from quoted entry"} compact /> : null}
      {original.quotedEntryId ? <p className="quote-card-note">{language === "ko" ? "이 기록에도 인용이 있습니다." : "This entry also contains a quote."}</p> : null}
      <span className="quote-card-link">{language === "ko" ? "원문 보기" : "View original"} →</span>
    </> : <QuoteUnavailable id={id} entries={entries} reader={reader} language={language} />}
  </div>;
}
