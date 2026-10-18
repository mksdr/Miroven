import type { ReactNode, Ref } from "react";
import type { DateFilterType } from "../../lib/search";
import { JournalFeedContent } from "./JournalFeedSection";

const DATE_FILTERS: DateFilterType[] = [
  "all",
  "today",
  "this-week",
  "this-month",
  "last-month",
  "exact",
  "range",
];

type SearchWorkspaceCopy = {
  search: string;
  searchPlaceholder: string;
  recentSearches: string;
  clearRecent: string;
  filterAll: string;
  filterToday: string;
  filterThisWeek: string;
  filterThisMonth: string;
  filterLastMonth: string;
  filterExact: string;
  filterRange: string;
  searchResultsCount: (count: number) => string;
  clearFilters: string;
  entries: (count: number) => string;
  openVault: string;
  loadingDetail: string;
  noSearchResults: string;
};

type JournalSearchWorkspaceProps = {
  copy: SearchWorkspaceCopy;
  inputRef: Ref<HTMLInputElement>;
  query: string;
  recentSearches: string[];
  dateFilterType: DateFilterType;
  exactDate: string;
  startDate: string;
  endDate: string;
  hashtags: string[];
  selectedHashtag: string;
  isSearchActive: boolean;
  resultCount: number;
  totalEntryCount: number;
  isLoading: boolean;
  visibleEntryCount: number;
  remainingEntryCount: number;
  emptyDetail: string;
  loadMoreLabel: string;
  children: ReactNode;
  onSubmit: () => void;
  onQueryChange: (query: string) => void;
  onSelectRecent: (query: string) => void;
  onRemoveRecent: (query: string) => void;
  onClearRecent: () => void;
  onDateFilterChange: (filter: DateFilterType) => void;
  onExactDateChange: (date: string) => void;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onToggleHashtag: (hashtag: string) => void;
  onClearFilters: () => void;
  onLoadMore: () => void;
};

function dateFilterLabel(filter: DateFilterType, copy: SearchWorkspaceCopy) {
  switch (filter) {
    case "all":
      return copy.filterAll;
    case "today":
      return copy.filterToday;
    case "this-week":
      return copy.filterThisWeek;
    case "this-month":
      return copy.filterThisMonth;
    case "last-month":
      return copy.filterLastMonth;
    case "exact":
      return copy.filterExact;
    case "range":
      return copy.filterRange;
  }
}

export function JournalSearchWorkspace({
  copy,
  inputRef,
  query,
  recentSearches,
  dateFilterType,
  exactDate,
  startDate,
  endDate,
  hashtags,
  selectedHashtag,
  isSearchActive,
  resultCount,
  totalEntryCount,
  isLoading,
  visibleEntryCount,
  remainingEntryCount,
  emptyDetail,
  loadMoreLabel,
  children,
  onSubmit,
  onQueryChange,
  onSelectRecent,
  onRemoveRecent,
  onClearRecent,
  onDateFilterChange,
  onExactDateChange,
  onStartDateChange,
  onEndDateChange,
  onToggleHashtag,
  onClearFilters,
  onLoadMore,
}: JournalSearchWorkspaceProps) {
  return (
    <>
      <section className="search-section" id="search-section" aria-label={copy.search}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="search-input-wrapper"
        >
          <span className="search-input-icon" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="search-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.search}
          />
          {query ? (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => onQueryChange("")}
              aria-label={copy.clearFilters}
            >
              ×
            </button>
          ) : null}
        </form>

        {recentSearches.length > 0 && !query.trim() ? (
          <div className="recent-searches-row">
            <span>{copy.recentSearches}:</span>
            {recentSearches.map((recentQuery) => (
              <span key={recentQuery} className="recent-chip">
                <button type="button" onClick={() => onSelectRecent(recentQuery)}>
                  {recentQuery}
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveRecent(recentQuery)}
                  aria-label={`${copy.clearRecent}: ${recentQuery}`}
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="clear-search-link" onClick={onClearRecent}>
              {copy.clearRecent}
            </button>
          </div>
        ) : null}

        <div className="search-filters-row">
          {DATE_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              className={`search-chip ${dateFilterType === filter ? "active" : ""}`}
              onClick={() => onDateFilterChange(filter)}
            >
              {dateFilterLabel(filter, copy)}
            </button>
          ))}
        </div>

        {dateFilterType === "exact" ? (
          <div className="search-date-inputs">
            <input
              type="date"
              value={exactDate}
              onChange={(event) => onExactDateChange(event.target.value)}
            />
          </div>
        ) : dateFilterType === "range" ? (
          <div className="search-date-inputs">
            <input
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
            />
            <span>~</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
            />
          </div>
        ) : null}

        {hashtags.length > 0 ? (
          <div className="search-filters-row">
            {hashtags.map((hashtag) => (
              <button
                key={hashtag}
                type="button"
                className={`search-chip ${selectedHashtag === hashtag ? "active" : ""}`}
                onClick={() => onToggleHashtag(hashtag)}
              >
                #{hashtag}
              </button>
            ))}
          </div>
        ) : null}

        {isSearchActive ? (
          <div className="active-filter-bar">
            <span>{copy.searchResultsCount(resultCount)}</span>
            <button type="button" className="clear-search-link" onClick={onClearFilters}>
              {copy.clearFilters}
            </button>
          </div>
        ) : null}
      </section>

      <div className="feed-label">
        <span>
          {isSearchActive
            ? copy.searchResultsCount(resultCount)
            : copy.entries(totalEntryCount)}
        </span>
      </div>

      <JournalFeedContent
        copy={copy}
        isLoading={isLoading}
        visibleEntryCount={visibleEntryCount}
        remainingEntryCount={remainingEntryCount}
        emptyDetail={emptyDetail}
        loadMoreLabel={loadMoreLabel}
        onLoadMore={onLoadMore}
      >
        {children}
      </JournalFeedContent>
    </>
  );
}
