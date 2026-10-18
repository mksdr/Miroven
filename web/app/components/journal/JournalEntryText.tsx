import type { ReactNode } from "react";
import { isChoseongOnly } from "../../lib/search";

/** Keep hashtag styling and search highlights independent, including overlapping matches. */
export function JournalEntryText({ text, searchQuery = "", onSearchHashtag }: {
  text: string; searchQuery?: string; onSearchHashtag?: (tag: string) => void;
}) {
  const query = searchQuery.trim();
  const highlights = query && !isChoseongOnly(query)
    ? Array.from(text.matchAll(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")),
      (match) => ({ start: match.index, end: match.index + match[0].length }))
    : [];

  function renderRange(start: number, end: number): ReactNode {
    const parts: ReactNode[] = [];
    let cursor = start;
    for (const match of highlights) {
      if (match.end <= start) continue;
      if (match.start >= end) break;
      const from = Math.max(start, match.start);
      const to = Math.min(end, match.end);
      if (cursor < from) parts.push(text.slice(cursor, from));
      parts.push(<mark key={from} className="search-highlight">{text.slice(from, to)}</mark>);
      cursor = to;
    }
    if (cursor < end) parts.push(text.slice(cursor, end));
    return parts;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  // Use the same hashtag syntax as extractHashtags in the search layer.
  for (const match of text.matchAll(/#[a-zA-Z0-9_가-힣]+/g)) {
    if (cursor < match.index) parts.push(<span key={cursor}>{renderRange(cursor, match.index)}</span>);
    const end = match.index + match[0].length;
    parts.push(onSearchHashtag
      ? <button key={match.index} type="button" className="entry-hashtag entry-hashtag-button"
          onClick={() => onSearchHashtag(match[0])}>{renderRange(match.index, end)}</button>
      : <span key={match.index} className="entry-hashtag">{renderRange(match.index, end)}</span>);
    cursor = end;
  }
  if (cursor < text.length) parts.push(<span key={cursor}>{renderRange(cursor, text.length)}</span>);
  return <>{parts}</>;
}
