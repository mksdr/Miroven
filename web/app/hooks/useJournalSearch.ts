"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  addRecentSearch,
  clearRecentSearches,
  filterJournalEntries,
  getCachedEntryHashtags,
  getRecentSearches,
  removeRecentSearch,
  type DateFilterType,
} from "../lib/search";
import type { JournalEntrySummary } from "../lib/local-vault";

export function useJournalSearch(
  entries: JournalEntrySummary[],
  isVaultLocked = false,
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedHashtag, setSelectedHashtag] = useState("");
  const [dateFilterType, setDateFilterType] = useState<DateFilterType>("all");
  const [exactDate, setExactDate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [displayLimit, setDisplayLimit] = useState(20);
  const recentSearchGeneration = useRef(0);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  const resetRecentSearchState = useCallback(() => {
    recentSearchGeneration.current += 1;
    setRecentSearches([]);
  }, []);

  useEffect(() => {
    if (isVaultLocked) return;
    let cancelled = false;
    const generation = recentSearchGeneration.current;
    void getRecentSearches().then((recents) => {
      if (!cancelled && generation === recentSearchGeneration.current) {
        setRecentSearches(recents);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isVaultLocked]);

  const activeRecentSearches = isVaultLocked ? [] : recentSearches;

  const filteredEntries = useMemo(
    () =>
      filterJournalEntries(entries, {
        query: deferredSearchQuery,
        hashtag: selectedHashtag,
        dateFilterType,
        exactDate,
        startDate,
        endDate,
      }),
    [
      entries,
      deferredSearchQuery,
      selectedHashtag,
      dateFilterType,
      exactDate,
      startDate,
      endDate,
    ],
  );

  const allHashtags = useMemo(() => {
    const tags = new Set<string>();
    for (const entry of entries) {
      for (const tag of getCachedEntryHashtags(entry)) {
        tags.add(tag);
      }
    }
    return Array.from(tags);
  }, [entries]);

  const visibleEntries = useMemo(
    () => filteredEntries.slice(0, displayLimit),
    [filteredEntries, displayLimit],
  );

  const submitSearch = async (queryToSubmit?: string) => {
    const query = (queryToSubmit ?? searchQuery).trim();
    if (!query) return;
    const generation = recentSearchGeneration.current;
    const updated = await addRecentSearch(query);
    if (generation === recentSearchGeneration.current) setRecentSearches(updated);
  };

  const removeRecent = async (query: string) => {
    const generation = recentSearchGeneration.current;
    const updated = await removeRecentSearch(query);
    if (generation === recentSearchGeneration.current) setRecentSearches(updated);
  };

  const clearRecents = async () => {
    const generation = recentSearchGeneration.current;
    await clearRecentSearches();
    if (generation === recentSearchGeneration.current) setRecentSearches([]);
  };

  const refreshRecentSearches = async () => {
    if (isVaultLocked) {
      setRecentSearches([]);
      return;
    }
    const generation = recentSearchGeneration.current;
    const recents = await getRecentSearches();
    if (generation === recentSearchGeneration.current) setRecentSearches(recents);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedHashtag("");
    setDateFilterType("all");
    setExactDate("");
    setStartDate("");
    setEndDate("");
  };

  return {
    allHashtags,
    clearFilters,
    clearRecents,
    dateFilterType,
    deferredSearchQuery,
    endDate,
    exactDate,
    filteredEntries,
    isSearchActive: Boolean(
      searchQuery.trim() || selectedHashtag || dateFilterType !== "all",
    ),
    recentSearches: activeRecentSearches,
    refreshRecentSearches,
    removeRecent,
    resetRecentSearchState,
    searchQuery,
    selectedHashtag,
    setDateFilterType,
    setDisplayLimit,
    setEndDate,
    setExactDate,
    setSearchQuery,
    setSelectedHashtag,
    setStartDate,
    startDate,
    submitSearch,
    visibleEntries,
  };
}
