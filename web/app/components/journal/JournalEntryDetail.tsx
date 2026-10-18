"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { JournalEntrySummary, JournalReader } from "../../lib/local-vault";
import { entryImages } from "../../lib/journal-images";
import { JournalEntryImage } from "./JournalEntryImage";
import { JournalEntryText } from "./JournalEntryText";
import { JournalQuoteCard, QuoteUnavailable } from "./JournalQuoteCard";
import { JournalImageLightbox, type JournalLightboxImage } from "./JournalImageLightbox";

export function JournalEntryDetail({ id, entries, reader, language, onClose, onSearchHashtag }: {
  id: string; entries: ReadonlyMap<string, JournalEntrySummary>; reader: JournalReader;
  language: "ko" | "en"; onClose: () => void;
  onSearchHashtag?: (tag: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState([id]);
  const [image, setImage] = useState<JournalLightboxImage | null>(null);
  const currentId = history[history.length - 1];
  const entry = entries.get(currentId);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    return () => { dialog?.close(); document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialogRef} className="settings-dialog entry-detail-dialog" aria-labelledby="entry-detail-title"
    onCancel={(event) => { event.preventDefault(); if (image) setImage(null); else onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header className="settings-dialog-header">
      <button type="button" className="dialog-close" aria-label={language === "ko" ? "닫기" : "Close"} onClick={onClose}>×</button>
      <h2 id="entry-detail-title">{language === "ko" ? "원문 보기" : "Original entry"}</h2>
    </header>
    <div className="entry-detail-body">
      {history.length > 1 ? <button type="button" className="edit-button" onClick={() => setHistory((items) => items.slice(0, -1))}>← {language === "ko" ? "이전 기록으로" : "Back"}</button> : null}
      {entry ? <>
        <time className="quote-card-date" dateTime={entry.createdAt}>{new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { dateStyle: "long", timeStyle: "short" }).format(new Date(entry.createdAt))}</time>
        {entry.text ? <p className="entry-text"><JournalEntryText text={entry.text} onSearchHashtag={onSearchHashtag} /></p> : null}
        {entryImages(entry).length ? <JournalEntryImage key={entry.id} entry={entry} reader={reader} language={language}
          alt={language === "ko" ? "기록 사진" : "Entry photo"} onSelect={(src, alt, gallery, index) => setImage({ src, alt, gallery, index })} /> : null}
        {entry.quotedEntryId ? <JournalQuoteCard id={entry.quotedEntryId} entries={entries} reader={reader} language={language}
          onSearchHashtag={onSearchHashtag}
          onOpen={(next) => { setHistory((items) => items.includes(next) ? items.slice(0, items.indexOf(next) + 1) : [...items, next]); dialogRef.current?.scrollTo(0, 0); }} /> : null}
      </> : <QuoteUnavailable id={currentId} entries={entries} reader={reader} language={language} />}
    </div>
    <JournalImageLightbox image={entry ? image : null} language={language} dialogLabel={language === "ko" ? "사진 확대보기" : "Photo viewer"}
      closeLabel={language === "ko" ? "닫기" : "Close"} onClose={() => setImage(null)}
      onNavigate={(index) => setImage((previous) => { const next = previous?.gallery?.[index]; return previous && next ? { ...previous, ...next, index } : previous; })} />
  </dialog>;
}
