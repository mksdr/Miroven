"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ComposerDraft } from "../lib/composer-draft";
import {
  clearStoredDraft,
  getStoredDraft,
  isVaultLocked as isVaultLockedCheck,
  saveDraft,
} from "../lib/local-vault";
import type { Language } from "./useAppearance";

type UseDraftAutosaveOptions = {
  changeQuote: (id: string | undefined) => void;
  composerDraft: ComposerDraft;
  editingEntryId: string | null;
  hasUnsavedChanges: boolean;
  isVaultLocked: boolean;
  language: Language;
  loadEditingImages: (id: string) => Promise<void>;
  quotedEntryId: string | undefined;
  quotedEntryIdRef: MutableRefObject<string | undefined>;
  setEditingEntryId: (id: string | null) => void;
  showToast: (message: string) => void;
  vaultLockedRef: MutableRefObject<boolean>;
};

export function useDraftAutosave({
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
}: UseDraftAutosaveOptions) {
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const draftWriteRef = useRef<Promise<void>>(Promise.resolve());
  const isRestoredRef = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const setDraft = composerDraft.set;

  const cancelAutosave = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
  }, []);

  const clearComposerDraft = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    draftWriteRef.current = draftWriteRef.current
      .catch(() => undefined)
      .then(clearStoredDraft);
    return draftWriteRef.current;
  }, []);

  useEffect(() => {
    if (isVaultLocked || isRestoredRef.current) return;
    let cancelled = false;
    const restoreRevision = composerDraft.getRevision();
    // The initial render can precede the PIN-state check. A locked read is not
    // a completed restore: retry after unlocking before enabling autosave.
    void (async () => {
      if (await isVaultLockedCheck()) return;
      if (cancelled || vaultLockedRef.current) return;
      const stored = await getStoredDraft();
      if (cancelled || vaultLockedRef.current) return;
      return { stored };
    })()
      .then((result) => {
        if (!result || cancelled || vaultLockedRef.current) return;
        const { stored } = result;
        if (
          stored &&
          (stored.text.trim() || stored.quotedEntryId) &&
          !vaultLockedRef.current &&
          composerDraft.getRevision() === restoreRevision &&
          !composerDraft.getSnapshot() &&
          !quotedEntryIdRef.current
        ) {
          setDraft(stored.text);
          changeQuote(stored.quotedEntryId);
          if (stored.editingEntryId) {
            setEditingEntryId(stored.editingEntryId);
            void loadEditingImages(stored.editingEntryId);
          }
          showToast(
            language === "ko"
              ? "작성 중이던 임시 저장 글을 복원했습니다."
              : "Restored your unsaved draft.",
          );
        }
        isRestoredRef.current = true;
        setDraftRestored(true);
      })
      .catch(() => {
        if (cancelled || vaultLockedRef.current) return;
        showToast(
          language === "ko"
            ? "임시 저장 글을 복원하지 못했습니다."
            : "Could not restore your draft.",
        );
      });
    return () => { cancelled = true; };
  }, [
    changeQuote,
    composerDraft,
    isVaultLocked,
    language,
    loadEditingImages,
    quotedEntryIdRef,
    setDraft,
    setEditingEntryId,
    showToast,
    vaultLockedRef,
  ]);

  useEffect(() => {
    if (isVaultLocked || !draftRestored) return;
    const schedule = () => {
      window.clearTimeout(autosaveTimerRef.current);
      if (vaultLockedRef.current) return;
      autosaveTimerRef.current = window.setTimeout(() => {
        const text = composerDraft.getSnapshot();
        draftWriteRef.current = draftWriteRef.current
          .catch(() => undefined)
          .then(() =>
            text.trim() || quotedEntryId
              ? saveDraft({
                  text,
                  editingEntryId,
                  quotedEntryId,
                  updatedAt: new Date().toISOString(),
                })
              : clearStoredDraft(),
          )
          .catch(() =>
            showToast(
              language === "ko"
                ? "임시 저장하지 못했습니다."
                : "Could not save draft.",
            ),
          );
      }, 500);
    };
    schedule();
    const unsubscribe = composerDraft.subscribe(schedule);
    return () => {
      unsubscribe();
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [
    composerDraft,
    draftRestored,
    editingEntryId,
    quotedEntryId,
    isVaultLocked,
    language,
    showToast,
    vaultLockedRef,
  ]);

  useEffect(() => {
    if (!hasUnsavedChanges || isVaultLocked) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasUnsavedChanges, isVaultLocked]);

  return {
    cancelAutosave,
    clearComposerDraft,
  };
}
