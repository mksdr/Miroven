import type { ReactNode } from "react";
import type {
  JournalEntrySummary,
  JournalReader,
  SyncStatus,
  VaultEnvelope,
} from "../../lib/local-vault";
import type { Language } from "../../hooks/useAppearance";
import { JournalEntryItem } from "./JournalEntryItem";

type FeedCopy = {
  openVault: string;
  loadingDetail: string;
  firstTitle?: string;
  firstDetail?: string;
  noSearchResults: string;
};

type JournalFeedContentProps = {
  copy: FeedCopy;
  isLoading: boolean;
  showFirstEntryEmpty?: boolean;
  visibleEntryCount: number;
  remainingEntryCount: number;
  emptyDetail: string;
  loadMoreLabel: string;
  onLoadMore: () => void;
  children: ReactNode;
};

export function JournalFeedContent({
  copy,
  isLoading,
  showFirstEntryEmpty = false,
  visibleEntryCount,
  remainingEntryCount,
  emptyDetail,
  loadMoreLabel,
  onLoadMore,
  children,
}: JournalFeedContentProps) {
  if (isLoading) {
    return (
      <div className="empty-state" role="status">
        <div className="empty-mark">M</div>
        <h2>{copy.openVault}</h2>
        <p>{copy.loadingDetail}</p>
      </div>
    );
  }
  if (showFirstEntryEmpty) {
    return (
      <div className="empty-state">
        <div className="empty-mark">M</div>
        <h2>{copy.firstTitle}</h2>
        <p>{copy.firstDetail}</p>
      </div>
    );
  }
  if (visibleEntryCount === 0) {
    return (
      <div className="empty-state">
        <h2>{copy.noSearchResults}</h2>
        <p>{emptyDetail}</p>
      </div>
    );
  }
  return (
    <>
      {children}
      {remainingEntryCount > 0 ? (
        <div className="load-more-container">
          <button
            type="button"
            className="post-button load-more-button"
            onClick={onLoadMore}
          >
            {loadMoreLabel} ({remainingEntryCount})
          </button>
        </div>
      ) : null}
    </>
  );
}

type EntryListCopy = {
  profileName: string;
  profileHandle: string;
  editEntry: string;
  edit: string;
  deleteEntry: string;
  entryPhoto: string;
};

type JournalEntryListProps = {
  entries: JournalEntrySummary[];
  reader: JournalReader;
  language: Language;
  searchQuery: string;
  onSearchHashtag?: (tag: string) => void;
  hasIdentity: boolean;
  conflictEntryIds: string[];
  effectiveSyncStatus: SyncStatus;
  localEnvelope: VaultEnvelope | null;
  copy: EntryListCopy;
  focusedEntryIndex: number;
  pinning: boolean;
  saving: boolean;
  quoteEntries: ReadonlyMap<string, JournalEntrySummary>;
  onStartEditing: (entry: JournalEntrySummary) => void;
  onQuote: (entry: JournalEntrySummary) => void;
  onOpenEntry: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onTogglePin: (entry: JournalEntrySummary) => Promise<void>;
  onResolveUseLocal: (id: string) => Promise<void>;
  onResolveKeepBoth: (id: string) => Promise<void>;
  onSelectImage: (
    src: string,
    alt: string,
    gallery?: Array<{ src: string; alt: string }>,
    index?: number,
  ) => void;
};

export function JournalEntryList({
  entries,
  reader,
  language,
  searchQuery,
  onSearchHashtag,
  hasIdentity,
  conflictEntryIds,
  effectiveSyncStatus,
  localEnvelope,
  copy,
  focusedEntryIndex,
  pinning,
  saving,
  quoteEntries,
  onStartEditing,
  onQuote,
  onOpenEntry,
  onDelete,
  onTogglePin,
  onResolveUseLocal,
  onResolveKeepBoth,
  onSelectImage,
}: JournalEntryListProps) {
  const conflictSet =
    hasIdentity && conflictEntryIds.length > 0 ? new Set(conflictEntryIds) : null;
  const fallbackSyncStatus =
    effectiveSyncStatus === "conflict" ? "synced" : effectiveSyncStatus;

  return (
    <ol className="entry-list">
      {entries.map((entry, index) => (
        <JournalEntryItem
          key={entry.id}
          entry={entry}
          reader={reader}
          language={language}
          searchQuery={searchQuery}
          onSearchHashtag={onSearchHashtag}
          syncStatus={conflictSet?.has(entry.id) ? "conflict" : fallbackSyncStatus}
          localEnvelope={localEnvelope}
          t={copy}
          isFocused={focusedEntryIndex === index}
          onStartEditing={onStartEditing}
          onQuote={onQuote}
          quoteEntries={quoteEntries}
          onOpenEntry={onOpenEntry}
          onDelete={onDelete}
          onTogglePin={onTogglePin}
          pinning={pinning}
          saving={saving}
          onResolveUseLocal={onResolveUseLocal}
          onResolveKeepBoth={onResolveKeepBoth}
          onSelectImage={onSelectImage}
        />
      ))}
    </ol>
  );
}
