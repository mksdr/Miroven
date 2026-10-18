import { createElement, createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JournalSearchWorkspace } from "../app/components/journal/JournalSearchWorkspace";

const copy = {
  search: "Search",
  searchPlaceholder: "Search entries",
  recentSearches: "Recent searches",
  clearRecent: "Clear",
  filterAll: "All",
  filterToday: "Today",
  filterThisWeek: "This week",
  filterThisMonth: "This month",
  filterLastMonth: "Last month",
  filterExact: "Exact date",
  filterRange: "Date range",
  searchResultsCount: (count: number) => `${count} results`,
  clearFilters: "Clear filters",
  entries: (count: number) => `${count} entries`,
  openVault: "Opening vault",
  loadingDetail: "Loading entries",
  noSearchResults: "No results",
};

const baseProps: ComponentProps<typeof JournalSearchWorkspace> = {
  copy,
  inputRef: createRef<HTMLInputElement>(),
  query: "",
  recentSearches: [],
  dateFilterType: "all",
  exactDate: "",
  startDate: "",
  endDate: "",
  hashtags: [],
  selectedHashtag: "",
  isSearchActive: false,
  resultCount: 2,
  totalEntryCount: 2,
  isLoading: false,
  visibleEntryCount: 2,
  remainingEntryCount: 0,
  emptyDetail: "Try another filter",
  loadMoreLabel: "Load more",
  children: createElement("ol", null, createElement("li", null, "Visible entry")),
  onSubmit: vi.fn(),
  onQueryChange: vi.fn(),
  onSelectRecent: vi.fn(),
  onRemoveRecent: vi.fn(),
  onClearRecent: vi.fn(),
  onDateFilterChange: vi.fn(),
  onExactDateChange: vi.fn(),
  onStartDateChange: vi.fn(),
  onEndDateChange: vi.fn(),
  onToggleHashtag: vi.fn(),
  onClearFilters: vi.fn(),
  onLoadMore: vi.fn(),
};

describe("journal search workspace presentation", () => {
  it("renders recent searches and hashtag filters without storage dependencies", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalSearchWorkspace, {
        ...baseProps,
        recentSearches: ["offline notes"],
        hashtags: ["private"],
        selectedHashtag: "private",
      }),
    );

    expect(markup).toContain("Recent searches:");
    expect(markup).toContain("offline notes");
    expect(markup).toContain("#private");
    expect(markup).toContain('search-chip active');
  });

  it("keeps exact-date and range controls mutually exclusive", () => {
    const exactMarkup = renderToStaticMarkup(
      createElement(JournalSearchWorkspace, {
        ...baseProps,
        dateFilterType: "exact",
        exactDate: "2026-09-13",
      }),
    );
    const rangeMarkup = renderToStaticMarkup(
      createElement(JournalSearchWorkspace, {
        ...baseProps,
        dateFilterType: "range",
        startDate: "2026-09-01",
        endDate: "2026-09-13",
      }),
    );

    expect(exactMarkup.match(/type="date"/g)).toHaveLength(1);
    expect(exactMarkup).toContain('value="2026-09-13"');
    expect(rangeMarkup.match(/type="date"/g)).toHaveLength(2);
    expect(rangeMarkup).toContain('value="2026-09-01"');
  });

  it("separates loading, empty, and populated result states", () => {
    const loadingMarkup = renderToStaticMarkup(
      createElement(JournalSearchWorkspace, { ...baseProps, isLoading: true }),
    );
    const emptyMarkup = renderToStaticMarkup(
      createElement(JournalSearchWorkspace, { ...baseProps, visibleEntryCount: 0 }),
    );
    const populatedMarkup = renderToStaticMarkup(
      createElement(JournalSearchWorkspace, {
        ...baseProps,
        isSearchActive: true,
        resultCount: 7,
        remainingEntryCount: 5,
      }),
    );

    expect(loadingMarkup).toContain("Opening vault");
    expect(loadingMarkup).not.toContain("Visible entry");
    expect(emptyMarkup).toContain("No results");
    expect(emptyMarkup).toContain("Try another filter");
    expect(populatedMarkup).toContain("7 results");
    expect(populatedMarkup).toContain("Visible entry");
    expect(populatedMarkup).toContain("Load more (5)");
  });
});
