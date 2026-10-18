export class EntryQuoteError extends Error {}

/** Quote IDs belong inside encrypted payloads, never in the sync envelope. */
export function validateEntryQuote(entry: { id: string; quotedEntryId?: string }) {
  if (entry.quotedEntryId === undefined) return;
  if (typeof entry.quotedEntryId !== "string" || !entry.quotedEntryId.trim() || entry.quotedEntryId.length > 256) {
    throw new EntryQuoteError("인용할 기록 ID가 올바르지 않습니다.");
  }
  if (entry.quotedEntryId === entry.id) throw new EntryQuoteError("자기 자신을 인용할 수 없습니다.");
}
