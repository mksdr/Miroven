import type { JournalEntry } from "./vault/types";

export const MAX_PINNED_ENTRIES = 3;

export class EntryPinLimitError extends Error {
  constructor() {
    super("You can pin up to 3 entries.");
    this.name = "EntryPinLimitError";
  }
}

/** Resolve offline devices' concurrent pins consistently before filtering/paging. */
export function orderJournalEntries<T extends Pick<JournalEntry, "id" | "createdAt" | "pinnedAt">>(entries: T[]): T[] {
  const newestFirst = (a: T, b: T) =>
    Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id);
  const pinned = entries.filter((entry) => entry.pinnedAt)
    .sort((a, b) => Date.parse(b.pinnedAt!) - Date.parse(a.pinnedAt!) || newestFirst(a, b));
  const pinnedIds = new Set(pinned.slice(0, MAX_PINNED_ENTRIES).map((entry) => entry.id));
  const regular = entries.filter((entry) => !pinnedIds.has(entry.id)).map((entry) => {
    if (!entry.pinnedAt) return entry;
    // Keep overflow requests encrypted on disk for deterministic sync resolution.
    return { ...entry, pinnedAt: undefined };
  }).sort(newestFirst);
  return [...pinned.slice(0, MAX_PINNED_ENTRIES), ...regular];
}
