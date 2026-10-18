import { describe, expect, it } from "vitest";
import {
  extractChoseong,
  extractHashtags,
  filterJournalEntries,
  isChoseongOnly,
  normalizeSearchText,
} from "../app/lib/search";
import type { JournalEntry } from "../app/lib/local-vault";

describe("search module unit tests", () => {
  it("extracts Korean Choseong correctly", () => {
    expect(extractChoseong("기록하기")).toBe("ㄱㄹㅎㄱ");
    expect(extractChoseong("Miroven 저널 #일기 123")).toBe("Miroven ㅈㄴ #ㅇㄱ 123");
  });

  it("identifies Choseong-only queries", () => {
    expect(isChoseongOnly("ㄱㄹ")).toBe(true);
    expect(isChoseongOnly("ㄱㄹ ㅎㄱ")).toBe(true);
    expect(isChoseongOnly("기록")).toBe(false);
    expect(isChoseongOnly("abc")).toBe(false);
  });

  it("normalizes search text", () => {
    expect(normalizeSearchText("  HELLO   World  ")).toBe("hello world");
  });

  it("extracts hashtags from entry body text", () => {
    expect(extractHashtags("오늘의 기록 #일기 #여행_2026 #미로벤")).toEqual([
      "일기",
      "여행_2026",
      "미로벤",
    ]);
    expect(extractHashtags("태그 없음")).toEqual([]);
  });

  describe("filterJournalEntries", () => {
    const sampleEntries: JournalEntry[] = [
      {
        id: "1",
        text: "오늘 첫 번째 일기를 작성했다. #일기 #시작",
        createdAt: "2026-08-02T10:00:00.000Z",
      },
      {
        id: "2",
        text: "제주도 여행 사진을 공유합니다. #여행 #제주도",
        createdAt: "2026-08-01T15:30:00.000Z",
      },
      {
        id: "3",
        text: "7월의 추억 다이어리 #여행",
        createdAt: "2026-07-20T08:00:00.000Z",
      },
    ];

    const refDate = new Date("2026-08-02T12:00:00.000Z");

    it("filters by text search", () => {
      const results = filterJournalEntries(sampleEntries, { query: "제주도" }, refDate);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("2");
    });

    it("filters by Korean Choseong search (ㄱㄹ -> 기록)", () => {
      const results = filterJournalEntries(sampleEntries, { query: "ㅇㄱ" }, refDate);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("filters by hashtag", () => {
      const results = filterJournalEntries(sampleEntries, { hashtag: "여행" }, refDate);
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toEqual(["2", "3"]);
    });

    it("filters by exact date", () => {
      const results = filterJournalEntries(
        sampleEntries,
        { dateFilterType: "exact", exactDate: "2026-08-01" },
        refDate
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("2");
    });

    it("filters by date range", () => {
      const results = filterJournalEntries(
        sampleEntries,
        {
          dateFilterType: "range",
          startDate: "2026-08-01",
          endDate: "2026-08-02",
        },
        refDate
      );
      expect(results).toHaveLength(2);
    });

    it("filters by quick filter 'today'", () => {
      const results = filterJournalEntries(
        sampleEntries,
        { dateFilterType: "today" },
        refDate
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("1");
    });

    it("filters by quick filter 'this-month'", () => {
      const results = filterJournalEntries(
        sampleEntries,
        { dateFilterType: "this-month" },
        refDate
      );
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toEqual(["1", "2"]);
    });

    it("filters by quick filter 'last-month'", () => {
      const results = filterJournalEntries(
        sampleEntries,
        { dateFilterType: "last-month" },
        refDate
      );
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("3");
    });
  });

  describe("recent searches re-exports in search module", () => {
    it("exports async recent search functions", async () => {
      const {
        addRecentSearch,
        clearRecentSearches,
        getRecentSearches,
        removeRecentSearch,
      } = await import("../app/lib/search");

      expect(typeof addRecentSearch).toBe("function");
      expect(typeof clearRecentSearches).toBe("function");
      expect(typeof getRecentSearches).toBe("function");
      expect(typeof removeRecentSearch).toBe("function");
    });
  });
});
