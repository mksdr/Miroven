"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ComposerDraft } from "../lib/composer-draft";
import {
  clearStoredDraft,
  getStoredDraft,
  isVaultLocked as isVaultLockedCheck,
  saveDraft,
} from "../lib/local-vault";
import { VaultResetError } from "../lib/vault/operation-errors";
import type { Language } from "./useAppearance";

type UseDraftAutosaveOptions = {
  changeQuote: (id: string | undefined) => void;
  composerDraft: ComposerDraft;
  editingEntryId: string | null;
  getComposerResetToken: () => Promise<string>;
  hasUnsavedChanges: boolean;
  isVaultLocked: boolean;
  language: Language;
  loadEditingImages: (id: string) => Promise<void>;
  onVaultReset: () => void;
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
  getComposerResetToken,
  hasUnsavedChanges,
  isVaultLocked,
  language,
  loadEditingImages,
  onVaultReset,
  quotedEntryId,
  quotedEntryIdRef,
  setEditingEntryId,
  showToast,
  vaultLockedRef,
}: UseDraftAutosaveOptions) {
  const autosaveTimerRef = useRef<number | undefined>(undefined);
  const draftWriteRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveGenerationRef = useRef(0);
  const needsDraftClearRef = useRef(false);
  const isRestoredRef = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const setDraft = composerDraft.set;

  const cancelAutosave = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
  }, []);

  const invalidateAutosave = useCallback(() => {
    cancelAutosave();
    autosaveGenerationRef.current++;
    needsDraftClearRef.current = false;
    draftWriteRef.current = Promise.resolve();
  }, [cancelAutosave]);

  useEffect(() => invalidateAutosave, [invalidateAutosave]);

  const resetAutosave = useCallback(() => {
    invalidateAutosave();
    isRestoredRef.current = true;
    setDraftRestored(true);
  }, [invalidateAutosave]);

  const queueDraftWrite = useCallback((
    generation: number,
    resetToken: Promise<string>,
    write: (token: string) => Promise<void>,
  ) => {
    draftWriteRef.current = draftWriteRef.current
      .catch(() => undefined)
      .then(async () => {
        if (generation !== autosaveGenerationRef.current) return;
        const token = await resetToken;
        if (generation !== autosaveGenerationRef.current) return;
        await write(token);
      })
      .catch((error: unknown) => {
        if (generation !== autosaveGenerationRef.current) return;
        if (error instanceof VaultResetError) onVaultReset();
        throw error;
      });
    return draftWriteRef.current;
  }, [onVaultReset]);

  const clearComposerDraft = useCallback((expectedResetToken?: string) => {
    cancelAutosave();
    needsDraftClearRef.current = false;
    return queueDraftWrite(
      autosaveGenerationRef.current,
      expectedResetToken === undefined ? getComposerResetToken() : Promise.resolve(expectedResetToken),
      clearStoredDraft,
    );
  }, [cancelAutosave, getComposerResetToken, queueDraftWrite]);

  useEffect(() => {
    if (isVaultLocked || isRestoredRef.current) return;
    let cancelled = false;
    const restoreRevision = composerDraft.getRevision();
    const generation = autosaveGenerationRef.current;
    // The initial render can precede the PIN-state check. A locked read is not
    // a completed restore: retry after unlocking before enabling autosave.
    void (async () => {
      if (await isVaultLockedCheck()) return;
      if (cancelled || vaultLockedRef.current) return;
      const token = await getComposerResetToken();
      if (cancelled || generation !== autosaveGenerationRef.current) return;
      const stored = await getStoredDraft(token);
      if (cancelled || vaultLockedRef.current) return;
      return { stored };
    })()
      .then((result) => {
        if (!result || cancelled || generation !== autosaveGenerationRef.current || vaultLockedRef.current) return;
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
      .catch((error: unknown) => {
        if (cancelled || generation !== autosaveGenerationRef.current || vaultLockedRef.current) return;
        if (error instanceof VaultResetError) {
          onVaultReset();
          return;
        }
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
    getComposerResetToken,
    isVaultLocked,
    language,
    loadEditingImages,
    onVaultReset,
    quotedEntryIdRef,
    setDraft,
    setEditingEntryId,
    showToast,
    vaultLockedRef,
  ]);

  useEffect(() => {
    if (isVaultLocked || !draftRestored) return;
    const schedule = () => {
      cancelAutosave();
      if (vaultLockedRef.current) return;
      const text = composerDraft.getSnapshot();
      const quote = quotedEntryIdRef.current;
      const hasDraft = Boolean(text.trim() || quote);
      // A new or reset composer must leave drafts written by other tabs alone.
      if (!hasDraft && !needsDraftClearRef.current) return;
      const generation = autosaveGenerationRef.current;
      const resetToken = getComposerResetToken();
      needsDraftClearRef.current = true;
      autosaveTimerRef.current = window.setTimeout(() => {
        if (generation !== autosaveGenerationRef.current) return;
        needsDraftClearRef.current = hasDraft;
        void queueDraftWrite(generation, resetToken, (token) =>
          hasDraft
            ? saveDraft({
                text,
                editingEntryId,
                quotedEntryId: quote,
                updatedAt: new Date().toISOString(),
              }, token)
            : clearStoredDraft(token),
        )
          .catch((error: unknown) => {
            if (generation !== autosaveGenerationRef.current || error instanceof VaultResetError) return;
            showToast(
              language === "ko"
                ? "임시 저장하지 못했습니다."
                : "Could not save draft.",
            );
          });
      }, 500);
    };
    schedule();
    const unsubscribe = composerDraft.subscribe(schedule);
    return () => {
      unsubscribe();
      cancelAutosave();
    };
  }, [
    cancelAutosave,
    composerDraft,
    draftRestored,
    editingEntryId,
    getComposerResetToken,
    quotedEntryId,
    quotedEntryIdRef,
    queueDraftWrite,
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
    resetAutosave,
  };
}
