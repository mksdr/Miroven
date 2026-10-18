"use client";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

type ActiveTab = "journal" | "search";
type LightboxImage = { src: string; alt: string } | null;

type ShortcutOptions = {
  accountOpen: boolean;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  onSubmit: () => Promise<void>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedLightboxImage: LightboxImage;
  setAccountOpen: Dispatch<SetStateAction<boolean>>;
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  setFocusedEntryIndex: Dispatch<SetStateAction<number>>;
  setSelectedLightboxImage: Dispatch<SetStateAction<LightboxImage>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setShortcutsModalOpen: Dispatch<SetStateAction<boolean>>;
  shortcutsModalOpen: boolean;
  visibleEntryCount: number;
};

export function useJournalKeyboardShortcuts({
  accountOpen,
  composerTextareaRef,
  onSubmit,
  searchInputRef,
  selectedLightboxImage,
  setAccountOpen,
  setActiveTab,
  setFocusedEntryIndex,
  setSelectedLightboxImage,
  setSettingsOpen,
  setShortcutsModalOpen,
  shortcutsModalOpen,
  visibleEntryCount,
}: ShortcutOptions) {
  useEffect(() => {
    const focusSearch = () => window.setTimeout(() => searchInputRef.current?.focus(), 50);
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const activeElement = document.activeElement;
      const isInputActive = Boolean(
        activeElement &&
          (activeElement.tagName === "INPUT" ||
            activeElement.tagName === "TEXTAREA" ||
            (activeElement as HTMLElement).isContentEditable),
      );

      if (event.key === "Escape") {
        if (selectedLightboxImage) {
          setSelectedLightboxImage(null);
          return;
        }
        if (shortcutsModalOpen) {
          setShortcutsModalOpen(false);
          return;
        }
        if (accountOpen) {
          setAccountOpen(false);
          return;
        }
        if (isInputActive && activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
          return;
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void onSubmit();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setActiveTab("search");
        focusSearch();
        return;
      }
      if (!isInputActive && event.key === "/") {
        event.preventDefault();
        setActiveTab("search");
        focusSearch();
        return;
      }
      if (isInputActive) return;

      if (event.key === "?" || (event.shiftKey && event.key === "/")) {
        event.preventDefault();
        setShortcutsModalOpen((current) => !current);
        return;
      }
      if (["n", "c"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        setActiveTab("journal");
        composerTextareaRef.current?.focus();
        return;
      }

      if (event.key >= "1" && event.key <= "4") {
        event.preventDefault();
        if (event.key === "1") {
          setActiveTab("journal");
          window.location.hash = "#top";
        } else if (event.key === "2") {
          setActiveTab("search");
          window.location.hash = "#search-section";
          focusSearch();
        } else if (event.key === "3") {
          setAccountOpen(true);
        } else {
          setSettingsOpen(true);
        }
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        if (visibleEntryCount > 0) {
          event.preventDefault();
          setFocusedEntryIndex((current) => Math.min(current + 1, visibleEntryCount - 1));
        }
      } else if (event.key === "k" || event.key === "ArrowUp") {
        if (visibleEntryCount > 0) {
          event.preventDefault();
          setFocusedEntryIndex((current) => Math.max(current - 1, 0));
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [
    accountOpen,
    composerTextareaRef,
    onSubmit,
    searchInputRef,
    selectedLightboxImage,
    setAccountOpen,
    setActiveTab,
    setFocusedEntryIndex,
    setSelectedLightboxImage,
    setSettingsOpen,
    setShortcutsModalOpen,
    shortcutsModalOpen,
    visibleEntryCount,
  ]);
}
