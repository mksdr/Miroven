import type { JournalEntry } from "./local-vault";

export type DateFilterType =
  | "all"
  | "exact"
  | "range"
  | "today"
  | "this-week"
  | "this-month"
  | "last-month";

export type SearchOptions = {
  query?: string;
  dateFilterType?: DateFilterType;
  exactDate?: string; // YYYY-MM-DD
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  hashtag?: string;   // e.g. "여행" or "#여행"
};

const CHOSEONG_LIST = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"
];

const CHOSEONG_SET = new Set(CHOSEONG_LIST);

/**
 * Extract Korean Choseong (initial consonants) from a string.
 */
export function extractChoseong(str: string): string {
  let result = "";
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    // Hangul Syllables 0xAC00 ~ 0xD7A3
    if (code >= 0xac00 && code <= 0xd7a3) {
      const choseongIdx = Math.floor((code - 0xac00) / 588);
      result += CHOSEONG_LIST[choseongIdx];
    } else {
      result += str[i];
    }
  }
  return result;
}

/**
 * Check if a search query consists solely of Korean Choseong (and spaces).
 */
export function isChoseongOnly(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === " " || CHOSEONG_SET.has(char)) {
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Normalizes text for search: NFC unicode, lowercase, collapse whitespace.
 */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Extract all hashtags from an entry body.
 * Matches #tag or #태그 (supports Hangul, alphanumeric, underscores).
 */
export function extractHashtags(text: string): string[] {
  const matches = text.match(/#[a-zA-Z0-9_가-힣]+/g);
  if (!matches) return [];
  const tags = new Set<string>();
  for (const match of matches) {
    tags.add(match.slice(1).normalize("NFC").toLowerCase());
  }
  return Array.from(tags);
}

type EntrySearchCache = {
  text: string;
  normalizedText: string;
  hashtags: string[];
  choseong?: string;
};

const entrySearchCache = new WeakMap<object, EntrySearchCache>();

function getEntrySearchMetadata(entry: { text: string }): EntrySearchCache {
  const existing = entrySearchCache.get(entry);
  if (existing && existing.text === entry.text) {
    return existing;
  }
  const normalizedText = normalizeSearchText(entry.text);
  const hashtags = extractHashtags(entry.text);
  const metadata: EntrySearchCache = {
    text: entry.text,
    normalizedText,
    hashtags,
  };
  entrySearchCache.set(entry, metadata);
  return metadata;
}

export function getCachedEntryHashtags(entry: { text: string }): string[] {
  return getEntrySearchMetadata(entry).hashtags;
}

function createDateMatcher(
  options: SearchOptions,
  now: Date = new Date(),
): (createdAtIso: string) => boolean {
  const filterType = options.dateFilterType || "all";
  if (filterType === "all") return () => true;

  if (filterType === "exact" && options.exactDate) {
    const exactDate = options.exactDate;
    return (createdAtIso) =>
      !Number.isNaN(Date.parse(createdAtIso)) &&
      createdAtIso.slice(0, 10) === exactDate;
  }

  if (filterType === "range") {
    const { startDate, endDate } = options;
    return (createdAtIso) => {
      if (Number.isNaN(Date.parse(createdAtIso))) return false;
      const entryYyyyMmDd = createdAtIso.slice(0, 10);
      if (startDate && entryYyyyMmDd < startDate) return false;
      if (endDate && entryYyyyMmDd > endDate) return false;
      return true;
    };
  }

  if (filterType === "today") {
    const todayStr = formatYyyyMmDd(now);
    return (createdAtIso) =>
      !Number.isNaN(Date.parse(createdAtIso)) &&
      createdAtIso.slice(0, 10) === todayStr;
  }

  if (filterType === "this-week") {
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay(); // 0 is Sunday
    const diffToMon = day === 0 ? -6 : 1 - day; // Monday as start of week
    startOfWeek.setDate(startOfWeek.getDate() + diffToMon);
    startOfWeek.setHours(0, 0, 0, 0);
    const startMs = startOfWeek.getTime();

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    const endMs = endOfWeek.getTime();

    return (createdAtIso) => {
      const entryMs = Date.parse(createdAtIso);
      return !Number.isNaN(entryMs) && entryMs >= startMs && entryMs <= endMs;
    };
  }

  if (filterType === "this-month") {
    const currentYear = now.getFullYear();
    const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
    const prefix = `${currentYear}-${currentMonth}`;
    return (createdAtIso) =>
      !Number.isNaN(Date.parse(createdAtIso)) &&
      createdAtIso.slice(0, 10).startsWith(prefix);
  }

  if (filterType === "last-month") {
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const year = lastMonthDate.getFullYear();
    const month = String(lastMonthDate.getMonth() + 1).padStart(2, "0");
    const prefix = `${year}-${month}`;
    return (createdAtIso) =>
      !Number.isNaN(Date.parse(createdAtIso)) &&
      createdAtIso.slice(0, 10).startsWith(prefix);
  }

  return (createdAtIso) => !Number.isNaN(Date.parse(createdAtIso));
}

/**
 * Checks if a given ISO date string matches date search options.
 */
export function matchesDateFilter(
  createdAtIso: string,
  options: SearchOptions,
  now: Date = new Date()
): boolean {
  return createDateMatcher(options, now)(createdAtIso);
}

function formatYyyyMmDd(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Filter journal entries by query text, Korean Choseong, hashtag, and date filters.
 */
export function filterJournalEntries<T extends Pick<JournalEntry, "text" | "createdAt">>(
  entries: T[],
  options: SearchOptions,
  now: Date = new Date()
): T[] {
  const rawQuery = options.query ? options.query.trim() : "";
  const query = rawQuery ? normalizeSearchText(rawQuery) : "";
  const hashtag = options.hashtag ? normalizeSearchText(options.hashtag.replace(/^#/, "").trim()) : "";
  const filterType = options.dateFilterType || "all";

  if (!query && !hashtag && filterType === "all") {
    return entries;
  }

  const queryIsChoseong = query ? isChoseongOnly(query) : false;
  const dateMatches = createDateMatcher(options, now);

  return entries.filter((entry) => {
    // 1. Date Filter
    if (!dateMatches(entry.createdAt)) {
      return false;
    }

    const metadata = getEntrySearchMetadata(entry);

    // 2. Hashtag Filter
    if (hashtag && !metadata.hashtags.includes(hashtag)) {
      return false;
    }

    // 3. Query Text / Choseong Filter
    if (query) {
      if (queryIsChoseong) {
        metadata.choseong ??= extractChoseong(metadata.normalizedText);
        if (!metadata.choseong.includes(query)) {
          return false;
        }
      } else {
        const entryDateNormalized = entry.createdAt.slice(0, 10);
        const matchesBody = metadata.normalizedText.includes(query);
        const matchesDate = entryDateNormalized.includes(query);
        const matchesTag = metadata.hashtags.some(
          (t) => t.includes(query) || `#${t}`.includes(query),
        );

        if (!matchesBody && !matchesDate && !matchesTag) {
          return false;
        }
      }
    }

    return true;
  });
}

export {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from "./vault/recent-searches";
