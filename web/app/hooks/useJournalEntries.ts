"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createComposerDraft } from "../lib/composer-draft";
import {
  createJournalReader,
  deleteEntry,
  getSyncSnapshot,
  isVaultLocked as isVaultLockedCheck,
  lockDeviceKey,
  saveEntry,
  setEntryPinned,
  type JournalEntry,
  type JournalEntrySummary,
  type VaultEnvelope,
} from "../lib/local-vault";
import type { Language } from "./useAppearance";
import { EntryPinLimitError, orderJournalEntries } from "../lib/entry-pins";
import { EntryQuoteError } from "../lib/entry-quotes";
import { useComposerImages, type ComposerImage } from "./useComposerImages";
import { useDraftAutosave } from "./useDraftAutosave";

export type { ComposerImage };

type UseJournalEntriesOptions = {
  hydrated: boolean;
  language: Language;
  localEnvelope: VaultEnvelope | null;
  lowSpecMode: boolean;
  refreshStorageInfo: () => Promise<void>;
  refreshSyncState: () => Promise<void>;
  runSync: () => Promise<void>;
  setPendingSyncCount: (count: number) => void;
  showToast: (message: string) => void;
};

class EditingEntryChangedError extends Error {}

export function useJournalEntries({
  hydrated,
  language,
  localEnvelope,
  lowSpecMode,
  refreshStorageInfo,
  refreshSyncState,
  runSync,
  setPendingSyncCount,
  showToast,
}: UseJournalEntriesOptions) {
  const [entries, setEntries] = useState<JournalEntrySummary[]>([]);
  const [journalReader] = useState(() => createJournalReader());
  const [composerDraft] = useState(createComposerDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [firstEntrySaved, setFirstEntrySaved] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteInFlightRef = useRef(false);
  const pinInFlightRef = useRef(false);
  const [pinning, setPinning] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [quotedEntryId, setQuotedEntryId] = useState<string | undefined>();
  const quotedEntryIdRef = useRef<string | undefined>(undefined);
  const changeQuote = useCallback((id: string | undefined) => {
    quotedEntryIdRef.current = id;
    setQuotedEntryId(id);
  }, []);
  const [isVaultLocked, setVaultLockedState] = useState(false);

  const entryReadRef = useRef<AbortController | null>(null);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const vaultLockedRef = useRef(false);
  const setDraft = composerDraft.set;

  const {
    cancelImageRequests,
    clearImages,
    editingContentVersionRef,
    editingImageState,
    handleImage,
    imageBusyRef,
    imageProcessing,
    images,
    imagesChanged,
    loadEditingImages,
    removeImage,
    serializeComposerImages,
  } = useComposerImages({
    isVaultLocked,
    journalReader,
    language,
    lowSpecMode,
    saving,
    showToast,
    vaultLockedRef,
  });

  useEffect(() => {
    journalReader.configure(lowSpecMode);
  }, [journalReader, lowSpecMode]);

  const setIsVaultLocked = useCallback(
    (locked: boolean) => {
      vaultLockedRef.current = locked;
      if (locked) {
        setPendingDeleteId(null);
        entryReadRef.current?.abort();
        journalReader.clear();
      }
      setVaultLockedState(locked);
    },
    [journalReader],
  );

  const refreshEntries = useCallback(async () => {
    if (vaultLockedRef.current) return;
    if (saveInFlightRef.current) {
      await saveInFlightRef.current;
      if (vaultLockedRef.current) return;
    }
    entryReadRef.current?.abort();
    const controller = new AbortController();
    entryReadRef.current = controller;
    try {
      const loaded = await journalReader.list({ signal: controller.signal });
      if (!controller.signal.aborted && !vaultLockedRef.current) {
        setEntries((previous) =>
          previous.length === loaded.length &&
          previous.every((entry, index) => entry === loaded[index])
            ? previous
            : loaded,
        );
      }
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    }
  }, [journalReader]);

  useEffect(
    () => () => {
      entryReadRef.current?.abort();
      journalReader.clear();
    },
    [journalReader],
  );

  const editingEntry = editingEntryId
    ? entries.find((entry) => entry.id === editingEntryId)
    : undefined;
  const draftChanged = useSyncExternalStore(
    composerDraft.subscribe,
    () =>
      editingEntry
        ? composerDraft.getSnapshot() !== editingEntry.text
        : Boolean(composerDraft.getSnapshot()),
    () => false,
  );
  const hasUnsavedChanges =
    draftChanged ||
    imagesChanged ||
    imageProcessing ||
    quotedEntryId !== editingEntry?.quotedEntryId;

  const { cancelAutosave, clearComposerDraft } = useDraftAutosave({
    changeQuote,
    composerDraft,
    editingEntryId,
    hasUnsavedChanges,
    isVaultLocked,
    language,
    loadEditingImages,
    quotedEntryId,
    quotedEntryIdRef,
    setEditingEntryId,
    showToast,
    vaultLockedRef,
  });

  const cancelEditing = useCallback(() => {
    cancelImageRequests();
    void clearComposerDraft();
    setEditingEntryId(null);
    changeQuote(undefined);
    setDraft("");
    clearImages();
  }, [cancelImageRequests, changeQuote, clearComposerDraft, clearImages, setDraft]);

  useEffect(() => {
    const initialLoadTimer = window.setTimeout(() => {
      void isVaultLockedCheck().then((locked) => {
        if (locked) {
          setIsVaultLocked(true);
          setLoading(false);
          scheduleIdleRefresh();
          return;
        }
        return refreshEntries()
          .catch(() =>
            showToast(
              language === "ko"
                ? "로컬 금고를 여는 중 문제가 생겼습니다."
                : "We couldn’t open the local vault.",
            ),
          )
          .finally(() => {
            setLoading(false);
            scheduleIdleRefresh();
          });
      });
    }, 0);

    function scheduleIdleRefresh() {
      const scheduleIdle =
        "requestIdleCallback" in window
          ? (callback: () => void) => window.requestIdleCallback(callback)
          : (callback: () => void) => window.setTimeout(callback, 100);
      scheduleIdle(() => {
        void refreshStorageInfo();
        void refreshSyncState().catch(() => null);
      });
    }

    return () => window.clearTimeout(initialLoadTimer);
  }, [
    language,
    refreshEntries,
    refreshStorageInfo,
    refreshSyncState,
    setIsVaultLocked,
    showToast,
  ]);

  const startEditing = useCallback(
    (entry: JournalEntrySummary) => {
      if (saveInFlightRef.current) return;
      cancelImageRequests();
      setEditingEntryId(entry.id);
      changeQuote(entry.quotedEntryId);
      setDraft(entry.text);
      clearImages();
      void loadEditingImages(entry.id);
      const composerEl = document.getElementById("composer");
      // Match quoting: the next composer click must not race an animated jump.
      composerEl?.scrollIntoView({ behavior: "instant" });
    },
    [cancelImageRequests, changeQuote, clearImages, loadEditingImages, setDraft],
  );

  const startQuoting = useCallback(
    (entry: JournalEntrySummary) => {
      if (saveInFlightRef.current || vaultLockedRef.current) return false;
      if (editingEntryId) {
        showToast(
          language === "ko"
            ? "수정을 저장하거나 취소한 뒤 인용해 주세요."
            : "Save or cancel your edit before quoting.",
        );
        return false;
      }
      changeQuote(entry.id);
      return true;
    },
    [changeQuote, editingEntryId, language, showToast],
  );

  const lockEntries = useCallback(() => {
    vaultLockedRef.current = true;
    entryReadRef.current?.abort();
    cancelAutosave();
    cancelImageRequests();
    void lockDeviceKey();
    clearImages();
    setDraft("");
    setEditingEntryId(null);
    changeQuote(undefined);
    setEntries([]);
    setIsVaultLocked(true);
  }, [
    cancelAutosave,
    cancelImageRequests,
    changeQuote,
    clearImages,
    setDraft,
    setIsVaultLocked,
  ]);

  const unlockVault = useCallback(async () => {
    vaultLockedRef.current = false;
    setIsVaultLocked(false);
    setLoading(true);
    try {
      await refreshEntries();
    } catch {
      showToast(
        language === "ko"
          ? "잠금 해제 후 기록을 불러오지 못했습니다."
          : "Could not load entries after unlocking.",
      );
    } finally {
      setLoading(false);
    }
  }, [language, refreshEntries, setIsVaultLocked, showToast]);

  const handleSubmit = useCallback(async () => {
    const text = composerDraft.getSnapshot().trim();
    if (
      !hydrated ||
      loading ||
      saving ||
      imageBusyRef.current ||
      isVaultLocked ||
      editingImageState !== "ready"
    ) {
      return;
    }

    const isEditing = Boolean(editingEntryId);
    const existingEntry = entries.find((entry) => entry.id === editingEntryId);
    const hasImage = images.length > 0;
    if (isEditing && !existingEntry) return;
    if (!text && !hasImage && !quotedEntryId) return;

    setSaving(true);
    let releaseSave: () => void = () => undefined;
    saveInFlightRef.current = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    try {
      if (isEditing && existingEntry) {
        const currentSummary = await journalReader.summary(existingEntry.id);
        if (currentSummary.contentVersion !== editingContentVersionRef.current) {
          throw new EditingEntryChangedError();
        }
        const finalImages = await serializeComposerImages();
        const updatedEntry: JournalEntry = {
          id: existingEntry.id,
          text,
          createdAt: existingEntry.createdAt,
          pinnedAt: existingEntry.pinnedAt,
          quotedEntryId,
          images: finalImages,
          attachmentVersion: 2,
        };
        entryReadRef.current?.abort();
        await saveEntry(updatedEntry);
        const updatedSummary = await journalReader.summary(updatedEntry.id);
        if (vaultLockedRef.current) return;
        setEntries((current) =>
          orderJournalEntries(
            current.map((entry) =>
              entry.id === updatedEntry.id ? updatedSummary : entry,
            ),
          ),
        );
        showToast(language === "ko" ? "기록을 수정했습니다." : "Entry updated.");
        cancelEditing();
      } else {
        const entry: JournalEntry = {
          id: crypto.randomUUID(),
          text,
          createdAt: new Date().toISOString(),
          quotedEntryId,
          images: await serializeComposerImages(),
          attachmentVersion: 2,
        };
        entryReadRef.current?.abort();
        await saveEntry(entry);
        if (entries.length === 0) setFirstEntrySaved(true);
        const summary = await journalReader.summary(entry.id, undefined, entry);
        if (vaultLockedRef.current) return;
        // Finish deleting the old draft before publishing the saved entry: the
        // user may reload as soon as it appears in the feed.
        const draftCleared = await clearComposerDraft().then(() => true, () => false);
        if (vaultLockedRef.current) return;
        setDraft("");
        changeQuote(undefined);
        clearImages();
        setEntries((current) =>
          orderJournalEntries([
            summary,
            ...current.filter((item) => item.id !== entry.id),
          ]),
        );
        setPendingSyncCount((await getSyncSnapshot()).pending);
        showToast(
          !draftCleared
            ? language === "ko"
              ? "기록은 저장했지만 임시 저장 글을 지우지 못했습니다."
              : "Entry saved, but the stored draft could not be cleared."
            : language === "ko"
              ? localEnvelope
                ? "암호화해 저장하고 동기화 대기열에 추가했습니다."
                : "기기에 암호화해 저장했습니다."
              : localEnvelope
                ? "Encrypted, saved, and added to the sync queue."
                : "Encrypted and saved on this device.",
        );
      }
      void runSync();
      void refreshStorageInfo();
    } catch (error) {
      showToast(
        error instanceof EntryQuoteError
          ? language === "ko"
            ? error.message
            : "This quote is invalid or would create a circular reference."
          : error instanceof EditingEntryChangedError
            ? language === "ko"
              ? "다른 곳에서 기록이 변경되었습니다. 작성 내용은 유지했습니다. 수정 취소 후 최신 기록을 확인해 주세요."
              : "This entry changed elsewhere. Your draft is preserved. Cancel editing to review the latest entry."
            : language === "ko"
              ? "저장하지 못했습니다. 기기 공간을 확인해 주세요."
              : "We couldn’t save. Check the available space on this device.",
      );
    } finally {
      releaseSave();
      saveInFlightRef.current = null;
      setSaving(false);
    }
  }, [
    cancelEditing,
    changeQuote,
    clearComposerDraft,
    clearImages,
    composerDraft,
    editingContentVersionRef,
    editingEntryId,
    editingImageState,
    entries,
    hydrated,
    imageBusyRef,
    images.length,
    isVaultLocked,
    journalReader,
    language,
    loading,
    localEnvelope,
    quotedEntryId,
    refreshStorageInfo,
    runSync,
    saving,
    serializeComposerImages,
    setDraft,
    setPendingSyncCount,
    showToast,
  ]);

  const handleTogglePin = useCallback(
    async (entry: JournalEntrySummary) => {
      if (vaultLockedRef.current || pinInFlightRef.current) return;
      pinInFlightRef.current = true;
      setPinning(true);
      try {
        await setEntryPinned(entry.id, !entry.pinnedAt);
        await refreshEntries();
        setPendingSyncCount((await getSyncSnapshot()).pending);
        showToast(
          language === "ko"
            ? entry.pinnedAt
              ? "기록 고정을 해제했습니다."
              : "기록을 고정했습니다."
            : entry.pinnedAt
              ? "Entry unpinned."
              : "Entry pinned.",
        );
        void runSync();
      } catch (error) {
        showToast(
          error instanceof EntryPinLimitError
            ? language === "ko"
              ? "기록은 최대 3개까지 고정할 수 있습니다."
              : "You can pin up to 3 entries."
            : language === "ko"
              ? "고정 상태를 변경하지 못했습니다."
              : "Could not change the pin.",
        );
      } finally {
        pinInFlightRef.current = false;
        setPinning(false);
      }
    },
    [language, refreshEntries, runSync, setPendingSyncCount, showToast],
  );

  const handleDelete = useCallback(async (id: string) => {
    if (!vaultLockedRef.current && !deleteInFlightRef.current) {
      setPendingDeleteId(id);
    }
  }, []);

  const cancelDelete = useCallback(() => {
    if (!deleteInFlightRef.current) setPendingDeleteId(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId || vaultLockedRef.current || deleteInFlightRef.current) {
      return;
    }
    const id = pendingDeleteId;
    deleteInFlightRef.current = true;
    setDeleting(true);
    try {
      await deleteEntry(id);
      setPendingDeleteId(null);
      entryReadRef.current?.abort();
      setPendingSyncCount((await getSyncSnapshot()).pending);
      setEntries((current) => current.filter((entry) => entry.id !== id));
      showToast(language === "ko" ? "기록을 삭제했습니다." : "Entry deleted.");
      void runSync();
    } catch {
      showToast(
        language === "ko"
          ? "삭제하지 못했습니다."
          : "We couldn’t delete the entry.",
      );
    } finally {
      deleteInFlightRef.current = false;
      setDeleting(false);
    }
  }, [pendingDeleteId, language, runSync, setPendingSyncCount, showToast]);

  const resetEntriesAfterPurge = useCallback(() => {
    setPendingDeleteId(null);
    entryReadRef.current?.abort();
    journalReader.clear();
    cancelAutosave();
    cancelImageRequests();
    clearImages();
    setDraft("");
    setEditingEntryId(null);
    changeQuote(undefined);
    setEntries([]);
  }, [
    cancelAutosave,
    cancelImageRequests,
    changeQuote,
    clearImages,
    journalReader,
    setDraft,
  ]);

  return {
    cancelDelete,
    confirmDelete,
    deleting,
    pendingDeleteId,
    cancelEditing,
    composerDraft,
    editingEntry,
    editingEntryId,
    quotedEntryId,
    removeQuote: () => {
      if (!saveInFlightRef.current) changeQuote(undefined);
    },
    startQuoting,
    editingImageState,
    entries,
    handleDelete,
    handleTogglePin,
    pinning,
    handleImage,
    handleSubmit,
    firstEntrySaved,
    hasUnsavedChanges,
    images,
    imageProcessing,
    retryEditingImages: () =>
      editingEntryId && void loadEditingImages(editingEntryId),
    isVaultLocked,
    journalReader,
    loading,
    lockEntries,
    refreshEntries,
    removeImage,
    resetEntriesAfterPurge,
    saving,
    setIsVaultLocked,
    startEditing,
    unlockVault,
  };
}
