"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePersona } from "../hooks/usePersona";
import { PersonaContext } from "./persona/PersonaContext";
import { PersonaSettingsModal } from "./modals/PersonaSettingsModal";
import { PERSONA_DOCUMENT_ID } from "../lib/persona";
import { savePersona } from "../lib/local-vault";
import { resolvePersonaConflict } from "../lib/vault/sync-outbox";
import { JOURNAL_IMAGE_ACCEPT } from "../lib/image";
import { isApiConfigured } from "../lib/remote";
import { useAppearance } from "../hooks/useAppearance";
import { useJournalSearch } from "../hooks/useJournalSearch";
import { useStorageHealth } from "../hooks/useStorageHealth";
import { useJournalKeyboardShortcuts } from "../hooks/useJournalKeyboardShortcuts";
import { useVaultPin } from "../hooks/useVaultPin";
import { useVaultAuth } from "../hooks/useVaultAuth";
import { useVaultSync } from "../hooks/useVaultSync";
import { useVaultBackupRecovery } from "../hooks/useVaultBackupRecovery";
import { useJournalEntries } from "../hooks/useJournalEntries";
import {
  useIdleVaultLock,
  useServiceWorkerRegistration,
  useVaultResetBroadcast,
} from "../hooks/useAppEnvironmentEffects";
import { JournalEntryList } from "./journal/JournalFeedSection";
import { JournalQuoteCard } from "./journal/JournalQuoteCard";
import type { JournalLightboxImage } from "./journal/JournalImageLightbox";
import { JournalSearchWorkspace } from "./journal/JournalSearchWorkspace";
import { JournalWorkspace } from "./journal/JournalWorkspace";
import { JournalOnboarding } from "./journal/JournalOnboarding";
import { VaultLockScreen } from "./vault/VaultLockScreen";
import {
  COPY,
  currentDateParts,
  sameVaultEnvelope,
  syncStatusText,
  T,
} from "../lib/journal-copy";
import { LeftRail } from "./layout/LeftRail";
import { TimelineHeader } from "./layout/TimelineHeader";
import { RightRail } from "./layout/RightRail";
import { MobileNav } from "./layout/MobileNav";

const AccountSettingsModal = dynamic(
  () => import("./modals/AccountSettingsModal").then((m) => m.AccountSettingsModal),
  { ssr: false },
);
const DisplaySettingsModal = dynamic(
  () => import("./modals/DisplaySettingsModal").then((m) => m.DisplaySettingsModal),
  { ssr: false },
);
const DeleteEntryModal = dynamic(
  () => import("./modals/DeleteEntryModal").then((m) => m.DeleteEntryModal),
  { ssr: false },
);
const JournalImageLightbox = dynamic(
  () => import("./journal/JournalImageLightbox").then((m) => m.JournalImageLightbox),
  { ssr: false },
);
const DeleteAccountModal = dynamic(
  () => import("./DeleteAccountModal").then((m) => m.DeleteAccountModal),
  { ssr: false },
);
const JournalEntryDetail = dynamic(
  () => import("./journal/JournalEntryDetail").then((m) => m.JournalEntryDetail),
  { ssr: false },
);
const PinSetupModal = dynamic(
  () => import("./PinSetupModal").then((m) => m.PinSetupModal),
  { ssr: false },
);
const PinRemoveModal = dynamic(
  () => import("./PinRemoveModal").then((m) => m.PinRemoveModal),
  { ssr: false },
);
const IosPwaPrompt = dynamic(
  () => import("./IosPwaPrompt").then((m) => m.IosPwaPrompt),
  { ssr: false },
);
const KeyboardShortcutsModal = dynamic(
  () => import("./KeyboardShortcutsModal").then((m) => m.KeyboardShortcutsModal),
  { ssr: false },
);

export function JournalApp() {
  const {
    fontScale,
    hydrated,
    language,
    lowSpecMode,
    setFontScale,
    setLanguage,
    setLowSpecMode,
    setTheme,
    theme,
  } = useAppearance();
  const t = COPY[language];
  const date = currentDateParts(language);
  const [personaRevision, setPersonaRevision] = useState(0);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"journal" | "search">("journal");
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [selectedLightboxImage, setSelectedLightboxImage] =
    useState<JournalLightboxImage | null>(null);
  const [focusedEntryIndex, setFocusedEntryIndex] = useState(-1);
  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const refreshEntriesRef = useRef<() => Promise<void>>(async () => undefined);
  const signedOutRef = useRef<() => void>(() => undefined);
  const accountDeletedRef = useRef<() => void>(() => undefined);
  const pinResetRef = useRef<() => void>(() => undefined);
  const recoveryResetRef = useRef<() => void>(() => undefined);

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const refreshEntriesBridge = useCallback(async () => {
    await refreshEntriesRef.current();
    setPersonaRevision((value) => value + 1);
  }, []);
  const onSignedOut = useCallback(() => signedOutRef.current(), []);
  const onAccountDeleted = useCallback(() => accountDeletedRef.current(), []);

  const {
    authLoading,
    authSending,
    authStep,
    deleteModalOpen,
    email,
    handleAccountDelete,
    handleSendCode,
    handleSignOut,
    handleSignOutAll,
    handleVerifyOtp,
    identity,
    isDeletingAccount,
    otpCode,
    otpVerifying,
    resetOtp,
    openDeleteModal,
    openLocalDeleteModal,
    deletionMode,
    closeDeleteModal,
    deletionIdentity,
    deletionReceipt,
    deletionStatus,
    deletionError,
    deletionCodeSending,
    deletionCodeSent,
    nextCodeRequestAt,
    requestDeletionCode,
    retryDeletionStatus,
    setEmail,
    setOtpCode,
  } = useVaultAuth({ language, onAccountDeleted, onSignedOut, showToast });

  const {
    isPersistentStorage,
    refreshStorageInfo,
    requestPersistence,
    storageEstimate,
  } = useStorageHealth();

  const {
    effectiveSyncStatus,
    conflictEntryIds,
    handleResolveConflictKeepBoth,
    handleResolveConflictUseLocal,
    localEnvelope,
    online,
    pendingSyncCount,
    refreshLocalSyncState,
    remoteEnvelope,
    resetVaultSync,
    runSync,
    setLocalEnvelope,
    setPendingSyncCount,
    setRemoteEnvelope,
    syncStatus,
  } = useVaultSync({
    identity,
    language,
    refreshEntries: refreshEntriesBridge,
    showToast,
  });

  const {
    cancelDelete,
    confirmDelete,
    deleting,
    pendingDeleteId,
    cancelEditing,
    composerDraft,
    editingEntryId,
    quotedEntryId,
    removeQuote,
    startQuoting,
    editingImageState,
    retryEditingImages,
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
  } = useJournalEntries({
    hydrated,
    language,
    localEnvelope,
    lowSpecMode,
    refreshStorageInfo,
    refreshSyncState: refreshLocalSyncState,
    runSync,
    setPendingSyncCount,
    showToast,
  });

  const { persona, ready: personaReady } = usePersona({
    hydrated,
    locked: isVaultLocked,
    scope: identity?.id || "local",
    refreshToken: personaRevision,
  });
  const openPersona = () => {
    if (personaReady) setPersonaOpen(true);
    else {
      showToast(
        language === "ko"
          ? "프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
          : "Could not load your profile. Please retry.",
      );
    }
  };

  const quoteEntries = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry])),
    [entries],
  );
  const openEntry = useCallback((id: string) => setDetailEntryId(id), []);

  useLayoutEffect(() => {
    refreshEntriesRef.current = refreshEntries;
  }, [refreshEntries]);

  const {
    allHashtags,
    clearFilters: handleClearAllSearchFilters,
    clearRecents: handleClearRecentSearches,
    dateFilterType,
    deferredSearchQuery,
    endDate,
    exactDate,
    filteredEntries,
    isSearchActive,
    recentSearches,
    removeRecent: handleRemoveRecentSearch,
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
    submitSearch: handleSearchSubmit,
    visibleEntries,
  } = useJournalSearch(entries, isVaultLocked);

  const handleQuote = useCallback(
    (entry: (typeof entries)[number]) => {
      if (!startQuoting(entry)) return;
      handleClearAllSearchFilters();
      setActiveTab("journal");
      requestAnimationFrame(() => {
        composerTextareaRef.current?.focus({ preventScroll: true });
        document.getElementById("composer")?.scrollIntoView({ behavior: "instant" });
      });
    },
    [handleClearAllSearchFilters, startQuoting],
  );

  useLayoutEffect(() => {
    signedOutRef.current = () => {
      setPersonaOpen(false);
      journalReader.clear();
      setRemoteEnvelope(null);
    };
    accountDeletedRef.current = () => {
      setPersonaOpen(false);
      pinResetRef.current();
      recoveryResetRef.current();
      setIsVaultLocked(false);
      setSelectedLightboxImage(null);
      setDetailEntryId(null);
      resetEntriesAfterPurge();
      setPersonaRevision((value) => value + 1);
      resetVaultSync();
      setSearchQuery("");
      setSelectedHashtag("");
    };
  }, [
    journalReader,
    resetEntriesAfterPurge,
    resetVaultSync,
    setRemoteEnvelope,
    setSearchQuery,
    setSelectedHashtag,
    setIsVaultLocked,
  ]);

  useVaultResetBroadcast(onAccountDeleted);

  const {
    backupBusy,
    backupRecoveryInput,
    handleCopyRecoveryCode,
    handleCreateRecoveryKit,
    handleExportBackup,
    handleExportDiagnostics,
    handleImportBackup,
    handleRecoverVault,
    recoveryCode,
    recoveryInput,
    setBackupRecoveryInput,
    setRecoveryCode,
    setRecoveryInput,
    vaultBusy,
  } = useVaultBackupRecovery({
    identity,
    isVaultLocked,
    language,
    refreshEntries: refreshEntriesBridge,
    remoteEnvelope,
    setLocalEnvelope,
    setPendingSyncCount,
    setRemoteEnvelope,
    showToast,
    theme,
  });

  useLayoutEffect(() => {
    recoveryResetRef.current = () => {
      setRecoveryCode("");
      setRecoveryInput("");
      setBackupRecoveryInput("");
    };
  }, [setRecoveryCode, setRecoveryInput, setBackupRecoveryInput]);

  const lockVault = useCallback(() => {
    setPersonaOpen(false);
    lockEntries();
    setSelectedLightboxImage(null);
    setDetailEntryId(null);
    handleClearAllSearchFilters();
  }, [handleClearAllSearchFilters, lockEntries]);

  const {
    handleConfirmRemovePin,
    handlePinUnlock,
    handleRemovePin,
    handleSavePinSetup,
    isPinConfigured,
    resetPinState,
    pinError,
    pinInput,
    pinRemoveOpen,
    pinSetupOpen,
    setPinRemoveOpen,
    setPinSetupOpen,
    updatePinInput,
  } = useVaultPin({
    language,
    onUnlocked: unlockVault,
    setVaultLocked: setIsVaultLocked,
    showToast,
  });

  useLayoutEffect(() => {
    pinResetRef.current = resetPinState;
  }, [resetPinState]);

  function handleManualLock() {
    if (hasUnsavedChanges && !window.confirm(t.discardDraftAndLock)) return;
    lockVault();
  }

  const handleRequestPersistent = useCallback(async () => {
    const granted = await requestPersistence();
    if (granted) showToast(t.persistentEnabled);
  }, [requestPersistence, showToast, t.persistentEnabled]);

  useIdleVaultLock(isVaultLocked, lockVault);
  useServiceWorkerRegistration();

  useLayoutEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pinSetupOpen && !pinRemoveOpen && !deleteModalOpen) {
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen, pinSetupOpen, pinRemoveOpen, deleteModalOpen]);

  const syncCopy = syncStatusText(
    effectiveSyncStatus,
    pendingSyncCount,
    language,
  );

  const handleSelectTab = useCallback((tab: "journal" | "search") => {
    setActiveTab(tab);
    if (tab === "search") {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, []);

  const handleSearchHashtag = useCallback((tag: string) => {
    handleClearAllSearchFilters();
    setSearchQuery(tag);
    setDisplayLimit(20);
    setFocusedEntryIndex(-1);
    setDetailEntryId(null);
    setActiveTab("search");
    void handleSearchSubmit(tag);
    requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
      document.getElementById("search-section")?.scrollIntoView({ behavior: "instant" });
    });
  }, [handleClearAllSearchFilters, setSearchQuery, setDisplayLimit, handleSearchSubmit]);

  const handleOpenSettings = useCallback(() => {
    void refreshStorageInfo();
    setSettingsOpen(true);
  }, [refreshStorageInfo]);

  const handleSelectLightboxImage = useCallback(
    (
      src: string,
      alt: string,
      gallery?: Array<{ src: string; alt: string }>,
      index?: number,
    ) => {
      setSelectedLightboxImage({ src, alt, gallery, index });
    },
    [],
  );

  useJournalKeyboardShortcuts({
    accountOpen,
    composerTextareaRef,
    onSubmit: handleSubmit,
    searchInputRef,
    selectedLightboxImage,
    setAccountOpen,
    setActiveTab,
    setFocusedEntryIndex,
    setSelectedLightboxImage,
    setSettingsOpen,
    setShortcutsModalOpen,
    shortcutsModalOpen,
    visibleEntryCount: visibleEntries.length,
  });

  if (isVaultLocked) {
    return (
      <VaultLockScreen
        copy={t}
        isPinConfigured={isPinConfigured}
        language={language}
        lowSpecMode={lowSpecMode}
        onPinInputChange={updatePinInput}
        onPinUnlock={handlePinUnlock}
        onUnlock={unlockVault}
        pinError={pinError}
        pinInput={pinInput}
        theme={theme}
      />
    );
  }

  const sharedEntryListProps = {
    entries: visibleEntries,
    reader: journalReader,
    language,
    hasIdentity: Boolean(identity),
    conflictEntryIds,
    effectiveSyncStatus,
    localEnvelope,
    copy: t,
    focusedEntryIndex,
    pinning,
    quoteEntries,
    onStartEditing: startEditing,
    onQuote: handleQuote,
    onOpenEntry: openEntry,
    onSearchHashtag: handleSearchHashtag,
    onDelete: handleDelete,
    onTogglePin: handleTogglePin,
    onResolveUseLocal: handleResolveConflictUseLocal,
    onResolveKeepBoth: handleResolveConflictKeepBoth,
    onSelectImage: handleSelectLightboxImage,
  };

  return (
    <PersonaContext.Provider value={persona}>
      <div className={`app-shell ${lowSpecMode ? "low-spec-mode" : ""}`}>
        <a href="#main-content" className="skip-to-content">
          <T ko="본문 콘텐츠로 바로가기" en="Skip to main content" />
        </a>

        <LeftRail
          onOpenPersona={openPersona}
          activeTab={activeTab}
          language={language}
          copy={t}
          online={online}
          onSelectTab={handleSelectTab}
          onOpenAccount={() => setAccountOpen(true)}
          onOpenSettings={handleOpenSettings}
        />

        <main className="timeline" id="main-content">
          <h1 className="sr-only">Miroven - 나만 볼 수 있는 암호화 저널</h1>
          <TimelineHeader
            activeTab={activeTab}
            language={language}
            copy={t}
            onOpenShortcuts={() => setShortcutsModalOpen(true)}
            onManualLock={handleManualLock}
          />

          {storageEstimate?.isLow ? (
            <section
              className="storage-warning"
              role="alert"
              aria-labelledby="storage-warning-title"
            >
              <strong id="storage-warning-title">{t.lowStorageTitle}</strong>
              <span>{t.lowStorageDetail(storageEstimate.remainingMB)}</span>
            </section>
          ) : null}

          <IosPwaPrompt language={language} />

          {activeTab === "journal" ? (
            <JournalOnboarding
              ready={hydrated && !loading && !authLoading}
              existingUser={entries.length > 0 || Boolean(localEnvelope || remoteEnvelope || identity)}
              firstEntrySaved={firstEntrySaved}
              language={language}
              onWrite={() => composerTextareaRef.current?.focus()}
              onRestore={() => setAccountOpen(true)}
            />
          ) : null}

          {activeTab === "journal" ? (
            <JournalWorkspace
              onOpenPersona={openPersona}
              copy={t}
              avatarLabel={language === "ko" ? "나" : "M"}
              draft={composerDraft}
              textareaRef={composerTextareaRef}
              isEditing={Boolean(editingEntryId)}
              editorDisabled={saving || !hydrated}
              images={images}
              language={language}
              editingImageState={editingImageState}
              onRetryImages={retryEditingImages}
              imageMetadataLabel="EXIF 제거"
              acceptedImageTypes={JOURNAL_IMAGE_ACCEPT}
              imageInputDisabled={
                imageProcessing ||
                saving ||
                editingImageState !== "ready" ||
                isVaultLocked
              }
              imageProcessingLabel={imageProcessing ? t.imageProcessingLabel : ""}
              hydrated={hydrated}
              submitDisabled={
                loading ||
                saving ||
                imageProcessing ||
                isVaultLocked ||
                editingImageState !== "ready"
              }
              hasImage={images.length > 0}
              hasQuote={Boolean(quotedEntryId)}
              quotePreview={
                quotedEntryId ? (
                  <div className="composer-quote">
                    <div className="composer-quote-heading">
                      <span>{language === "ko" ? "인용한 기록" : "Quoted entry"}</span>
                      <button
                        type="button"
                        className="edit-button"
                        aria-label={language === "ko" ? "인용 해제" : "Remove quote"}
                        disabled={saving}
                        onClick={removeQuote}
                      >
                        ×
                      </button>
                    </div>
                    <JournalQuoteCard
                      id={quotedEntryId}
                      entries={quoteEntries}
                      reader={journalReader}
                      language={language}
                      onOpen={openEntry}
                      onSearchHashtag={handleSearchHashtag}
                    />
                  </div>
                ) : null
              }
              submitLabel={saving ? t.saving : editingEntryId ? t.saveEdit : t.save}
              recoveryCode={recoveryCode}
              recoveryCodePanelLabel="복구 코드"
              hasRemoteRecovery={Boolean(
                remoteEnvelope &&
                  (!localEnvelope || !sameVaultEnvelope(localEnvelope, remoteEnvelope)),
              )}
              hasLocalEnvelope={Boolean(localEnvelope)}
              showRecoverySetup={entries.length > 0 || Boolean(identity)}
              remoteRecoveryPanelLabel="금고 복구"
              remoteRecoveryEyebrow={
                language === "ko" ? "서버 금고 키 복구" : "Server Vault Recovery"
              }
              remoteRecoveryTitle={
                language === "ko" ? "서버의 금고 키로 복구" : "Restore Server Vault Key"
              }
              remoteRecoveryDetail={
                language === "ko"
                  ? "서버에 다른 기기에서 생성된 복구 가능한 금고 키가 있습니다. 복구 코드를 입력하여 이 기기에 통합하세요."
                  : "A vault key from another device exists on the server. Enter your recovery code to sync on this device."
              }
              setupRecoveryPanelLabel="복구 코드 설정"
              recoveryInput={recoveryInput}
              vaultBusy={vaultBusy}
              entryCount={entries.length}
              isLoading={loading}
              visibleEntryCount={visibleEntries.length}
              remainingEntryCount={filteredEntries.length - visibleEntries.length}
              filteredEmptyDetail={
                language === "ko"
                  ? "검색어나 필터를 변경해 보세요."
                  : "Try changing your query or filter."
              }
              loadMoreLabel={language === "ko" ? "더 보기" : "Load More"}
              onCancelEditing={cancelEditing}
              onRemoveImage={removeImage}
              onSelectImage={(files, replaceId) => void handleImage(files, replaceId)}
              onSubmit={handleSubmit}
              onCopyRecoveryCode={() => void handleCopyRecoveryCode()}
              onDismissRecoveryCode={() => setRecoveryCode(null)}
              onRecoveryInputChange={setRecoveryInput}
              onRecoverVault={() => void handleRecoverVault()}
              onCreateRecoveryKit={() => void handleCreateRecoveryKit()}
              onLoadMore={() => setDisplayLimit((previous) => previous + 20)}
            >
              <JournalEntryList {...sharedEntryListProps} searchQuery="" />
            </JournalWorkspace>
          ) : (
            <JournalSearchWorkspace
              copy={t}
              inputRef={searchInputRef}
              query={searchQuery}
              recentSearches={recentSearches}
              dateFilterType={dateFilterType}
              exactDate={exactDate}
              startDate={startDate}
              endDate={endDate}
              hashtags={allHashtags}
              selectedHashtag={selectedHashtag}
              isSearchActive={isSearchActive}
              resultCount={filteredEntries.length}
              totalEntryCount={entries.length}
              isLoading={loading}
              visibleEntryCount={visibleEntries.length}
              remainingEntryCount={filteredEntries.length - visibleEntries.length}
              emptyDetail={
                language === "ko"
                  ? "검색어나 필터를 변경해 보세요."
                  : "Try changing your query or filter."
              }
              loadMoreLabel={language === "ko" ? "더 보기" : "Load More"}
              onSubmit={handleSearchSubmit}
              onQueryChange={setSearchQuery}
              onSelectRecent={setSearchQuery}
              onRemoveRecent={handleRemoveRecentSearch}
              onClearRecent={handleClearRecentSearches}
              onDateFilterChange={setDateFilterType}
              onExactDateChange={setExactDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              onToggleHashtag={(tag) =>
                setSelectedHashtag(selectedHashtag === tag ? "" : tag)
              }
              onClearFilters={handleClearAllSearchFilters}
              onLoadMore={() => setDisplayLimit((previous) => previous + 20)}
            >
              <JournalEntryList
                {...sharedEntryListProps}
                searchQuery={deferredSearchQuery}
              />
            </JournalSearchWorkspace>
          )}
        </main>

        <RightRail
          language={language}
          copy={t}
          date={date}
          localEnvelope={localEnvelope}
          storageEstimate={storageEstimate}
          isPersistentStorage={isPersistentStorage}
          onRequestPersistent={() => void handleRequestPersistent()}
          identityEmail={identity ? identity.email : null}
          onOpenAccount={() => setAccountOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <MobileNav
          activeTab={activeTab}
          copy={t}
          onSelectTab={handleSelectTab}
          onOpenAccount={() => setAccountOpen(true)}
          onOpenSettings={handleOpenSettings}
        />

        {accountOpen ? (
          <AccountSettingsModal
            isOpen={accountOpen}
            onClose={() => setAccountOpen(false)}
            pinSetupOpen={pinSetupOpen}
            pinRemoveOpen={pinRemoveOpen}
            deleteModalOpen={deleteModalOpen}
            language={language}
            copy={t}
            isApiConfigured={isApiConfigured}
            authLoading={authLoading}
            identity={identity}
            syncSummary={syncCopy}
            canSync={Boolean(localEnvelope && online)}
            syncStatus={syncStatus}
            authStep={authStep}
            email={email}
            otpCode={otpCode}
            authSending={authSending}
            otpVerifying={otpVerifying}
            localEnvelope={localEnvelope}
            entryCount={entries.length}
            backupBusy={backupBusy}
            backupRecoveryInput={backupRecoveryInput}
            isPinConfigured={isPinConfigured}
            onEmailChange={setEmail}
            onOtpCodeChange={setOtpCode}
            onSubmitEmail={(event) => void handleSendCode(event)}
            onSubmitOtp={(event) => void handleVerifyOtp(event)}
            onResetOtp={resetOtp}
            onSync={() => void runSync()}
            onSignOut={() => void handleSignOut()}
            onSignOutAll={() => void handleSignOutAll()}
            onOpenDeleteAccount={openDeleteModal}
            onOpenLocalDeleteAccount={openLocalDeleteModal}
            onExportBackup={() => void handleExportBackup()}
            onBackupRecoveryInputChange={setBackupRecoveryInput}
            onImportBackup={(file) => void handleImportBackup(file)}
            onRemovePin={() => void handleRemovePin()}
            onOpenPinSetup={() => setPinSetupOpen(true)}
            onExportDiagnostics={() => void handleExportDiagnostics()}
          />
        ) : null}

        {settingsOpen ? (
          <DisplaySettingsModal
            isOpen={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            pinSetupOpen={pinSetupOpen}
            pinRemoveOpen={pinRemoveOpen}
            deleteModalOpen={deleteModalOpen}
            language={language}
            theme={theme}
            fontScale={fontScale}
            lowSpecMode={lowSpecMode}
            copy={t}
            onLanguageChange={setLanguage}
            onThemeChange={setTheme}
            onFontScaleChange={setFontScale}
            onToggleLowSpecMode={setLowSpecMode}
          />
        ) : null}

        {detailEntryId && !isVaultLocked ? (
          <JournalEntryDetail
            key={detailEntryId}
            id={detailEntryId}
            entries={quoteEntries}
            reader={journalReader}
            language={language}
            onClose={() => setDetailEntryId(null)}
            onSearchHashtag={handleSearchHashtag}
          />
        ) : null}

        {pendingDeleteId && !isVaultLocked ? (
          <DeleteEntryModal
            language={language}
            title={t.deleteEntry}
            description={t.deleteConfirm}
            deleting={deleting}
            onClose={cancelDelete}
            onConfirm={confirmDelete}
          />
        ) : null}

        {pinSetupOpen ? (
          <PinSetupModal
            isOpen={pinSetupOpen}
            language={language}
            onClose={() => setPinSetupOpen(false)}
            onSavePin={handleSavePinSetup}
          />
        ) : null}

        {pinRemoveOpen ? (
          <PinRemoveModal
            isOpen={pinRemoveOpen}
            language={language}
            onClose={() => setPinRemoveOpen(false)}
            onRemovePin={handleConfirmRemovePin}
          />
        ) : null}

        {deletionReceipt && !deleteModalOpen && (
          <button
            type="button"
            className="toast deletion-status-banner"
            onClick={openDeleteModal}
          >
            {language === "ko" ? "계정 삭제 상태 확인" : "Check account deletion"}
          </button>
        )}
        {deleteModalOpen ? (
          <DeleteAccountModal
            isOpen={deleteModalOpen}
            language={language}
            isDeleting={isDeletingAccount}
            isServerAccount={deletionMode === "server"}
            email={deletionIdentity?.email}
            status={deletionMode === "server" ? deletionStatus : null}
            error={deletionError}
            codeSending={deletionCodeSending}
            codeSent={deletionCodeSent}
            nextCodeRequestAt={nextCodeRequestAt}
            onRequestCode={requestDeletionCode}
            onRetryStatus={retryDeletionStatus}
            onClose={closeDeleteModal}
            onConfirmDelete={handleAccountDelete}
          />
        ) : null}

        {shortcutsModalOpen ? (
          <KeyboardShortcutsModal
            isOpen={shortcutsModalOpen}
            onClose={() => setShortcutsModalOpen(false)}
            lang={language}
          />
        ) : null}

        {selectedLightboxImage ? (
          <JournalImageLightbox
            image={selectedLightboxImage}
            dialogLabel={language === "ko" ? "사진 확대보기" : "Photo Viewer"}
            closeLabel={t.close}
            language={language}
            onClose={() => setSelectedLightboxImage(null)}
            onNavigate={(index) =>
              setSelectedLightboxImage((previous) => {
                const next = previous?.gallery?.[index];
                return previous && next ? { ...previous, ...next, index } : previous;
              })
            }
          />
        ) : null}

        {personaOpen && personaReady && (
          <PersonaSettingsModal
            persona={persona}
            language={language}
            conflict={conflictEntryIds.includes(PERSONA_DOCUMENT_ID)}
            onClose={() => setPersonaOpen(false)}
            onSave={async (value, expected) => {
              await savePersona(value, expected);
              setPersonaRevision((value) => value + 1);
              void refreshLocalSyncState().then(runSync).catch(() => undefined);
              showToast(language === "ko" ? "프로필을 저장했습니다." : "Profile saved.");
            }}
            onResolve={async (remote) => {
              await resolvePersonaConflict(remote);
              setPersonaRevision((value) => value + 1);
              void refreshLocalSyncState().then(runSync).catch(() => undefined);
            }}
          />
        )}
        {toast ? (
          <div className="toast" role="status">
            {toast}
          </div>
        ) : null}
      </div>
    </PersonaContext.Provider>
  );
}
