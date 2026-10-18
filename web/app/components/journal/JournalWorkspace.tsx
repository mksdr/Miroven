import { PersonaAvatar } from "../persona/PersonaContext";
import { useRef, type ReactNode, type RefObject } from "react";
import type { ComposerDraft } from "../../lib/composer-draft";
import { ComposerSubmit, ComposerText } from "./ComposerText";
import { JournalFeedContent } from "./JournalFeedSection";

type JournalWorkspaceCopy = {
  write: string;
  editingNotice: string;
  cancelEdit: string;
  composerPlaceholder: string;
  photoPreview: string;
  removePhoto: string;
  photo: string;
  imageNote?: string;
  imageProcessingLabel?: string;
  recoveryCode: string;
  recoveryOnce: string;
  recoveryStore: string;
  copyCode: string;
  storedSafely: string;
  newDevice: string;
  existingVault: string;
  existingVaultDetail: string;
  recovering: string;
  recoverHere: string;
  protectVault: string;
  prepareRecovery: string;
  prepareRecoveryDetail: string;
  convertingVault: string;
  createRecovery: string;
  entries: (count: number) => string;
  openVault: string;
  loadingDetail: string;
  firstTitle: string;
  firstDetail: string;
  noSearchResults: string;
};

type ImagePreview = {
  id?: string;
  previewUrl: string;
  width: number;
  height: number;
};

type JournalWorkspaceProps = {
  copy: JournalWorkspaceCopy;
  avatarLabel: string;
  onOpenPersona?: () => void;
  draft: ComposerDraft;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isEditing: boolean;
  editorDisabled: boolean;
  image?: ImagePreview | null;
  images?: ImagePreview[];
  language?: "ko" | "en";
  editingImageState?: "ready" | "loading" | "failed";
  onRetryImages?: () => void;
  imageMetadataLabel: string;
  acceptedImageTypes: string;
  imageInputDisabled: boolean;
  imageProcessingLabel: string;
  hydrated: boolean;
  submitDisabled: boolean;
  hasImage: boolean;
  submitLabel: string;
  recoveryCode: string | null;
  recoveryCodePanelLabel: string;
  hasRemoteRecovery: boolean;
  hasLocalEnvelope: boolean;
  showRecoverySetup?: boolean;
  remoteRecoveryPanelLabel: string;
  remoteRecoveryEyebrow: string;
  remoteRecoveryTitle: string;
  remoteRecoveryDetail: string;
  setupRecoveryPanelLabel: string;
  recoveryInput: string;
  vaultBusy: boolean;
  entryCount: number;
  isLoading: boolean;
  visibleEntryCount: number;
  remainingEntryCount: number;
  filteredEmptyDetail: string;
  loadMoreLabel: string;
  children: ReactNode;
  quotePreview?: ReactNode;
  hasQuote?: boolean;
  onCancelEditing: () => void;
  onRemoveImage: (id: string) => void;
  onSelectImage: (files: File[], replaceId?: string) => void;
  onSubmit: () => Promise<void>;
  onCopyRecoveryCode: () => void;
  onDismissRecoveryCode: () => void;
  onRecoveryInputChange: (value: string) => void;
  onRecoverVault: () => void;
  onCreateRecoveryKit: () => void;
  onLoadMore: () => void;
};

export function JournalWorkspace({
  copy,
  onOpenPersona,
  draft,
  textareaRef,
  isEditing,
  editorDisabled,
  image,
  images,
  language = "ko",
  editingImageState = "ready",
  onRetryImages,
  imageMetadataLabel,
  acceptedImageTypes,
  imageInputDisabled,
  imageProcessingLabel,
  hydrated,
  submitDisabled,
  hasImage,
  submitLabel,
  recoveryCode,
  recoveryCodePanelLabel,
  hasRemoteRecovery,
  hasLocalEnvelope,
  showRecoverySetup = true,
  remoteRecoveryPanelLabel,
  remoteRecoveryEyebrow,
  remoteRecoveryTitle,
  remoteRecoveryDetail,
  setupRecoveryPanelLabel,
  recoveryInput,
  vaultBusy,
  entryCount,
  isLoading,
  visibleEntryCount,
  remainingEntryCount,
  filteredEmptyDetail,
  loadMoreLabel,
  children,
  quotePreview,
  hasQuote = false,
  onCancelEditing,
  onRemoveImage,
  onSelectImage,
  onSubmit,
  onCopyRecoveryCode,
  onDismissRecoveryCode,
  onRecoveryInputChange,
  onRecoverVault,
  onCreateRecoveryKit,
  onLoadMore,
}: JournalWorkspaceProps) {
  const replacementInput = useRef<HTMLInputElement>(null);
  const replacingId = useRef<string | undefined>(undefined);
  const photos = images ?? (image ? [image] : []);
  return (
    <>
      <section className="composer" id="composer" aria-label={copy.write}>
        <button type="button" className="persona-composer-button" onClick={event => { event.currentTarget.focus({ preventScroll: true }); onOpenPersona?.(); }} aria-label={language === "ko" ? "프로필 편집" : "Edit profile"}><PersonaAvatar language={language} /></button>
        <div className="composer-main">
          {isEditing ? (
            <div className="editing-badge">
              <span>✏️ {copy.editingNotice}</span>
              <button className="edit-button" type="button" disabled={editorDisabled} onClick={onCancelEditing}>
                {copy.cancelEdit}
              </button>
            </div>
          ) : null}

          <ComposerText
            draft={draft}
            textareaRef={textareaRef}
            placeholder={copy.composerPlaceholder}
            disabled={editorDisabled}
          />
          {quotePreview}

          {editingImageState === "loading" ? <p role="status">{language === "ko" ? "기존 사진을 불러오는 중…" : "Loading existing photos…"}</p> : null}
          {editingImageState === "failed" ? <button type="button" onClick={onRetryImages}>
            {language === "ko" ? "기존 사진 다시 불러오기" : "Retry existing photos"}
          </button> : null}
          {photos.length > 0 ? <div className={`photo-grid photo-grid-${photos.length} composer-photo-grid`}>
            {photos.map((photo, index) => <div className="image-preview" key={photo.id ?? index}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.previewUrl} alt={`${copy.photoPreview} ${index + 1}`} />
              <button
                className="remove-image"
                type="button"
                onClick={() => onRemoveImage(photo.id ?? "legacy")}
                disabled={imageInputDisabled}
                aria-label={`${copy.removePhoto} ${index + 1}`}
              >
                ×
              </button>
              <button className="replace-image" type="button" disabled={imageInputDisabled}
                aria-label={language === "ko" ? `사진 ${index + 1} 교체` : `Replace photo ${index + 1}`}
                onClick={() => { replacingId.current = photo.id; replacementInput.current?.click(); }}>
                {language === "ko" ? "교체" : "Replace"}
              </button>
              <span className="image-meta">
                {photo.width} × {photo.height} · {imageMetadataLabel}
              </span>
            </div>)}
          </div> : null}
          <input ref={replacementInput} type="file" accept={acceptedImageTypes} hidden
            aria-label={language === "ko" ? "교체할 사진 선택" : "Choose replacement photo"}
            disabled={imageInputDisabled} onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file && replacingId.current) onSelectImage([file], replacingId.current);
              event.currentTarget.value = "";
            }} />

          <div className="composer-footer">
            <div className="composer-actions">
              <label className="photo-button">
                <svg viewBox="0 0 24 24" className="photo-button-icon" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M3 5.5C3 4.119 4.119 3 5.5 3h13C19.881 3 21 4.119 21 5.5v13c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 21 3 19.881 3 18.5v-13zM5.5 5c-.276 0-.5.224-.5.5v9.086l3.293-3.293a1 1 0 0 1 1.414 0l1.293 1.293 4.293-4.293a1 1 0 0 1 1.414 0L19 10.586V5.5c0-.276-.224-.5-.5-.5h-13zM19 13.414l-3.293-3.293-4.293 4.293-1.293-1.293L5 18.243V18.5c0 .276.224.5.5.5h13c.276 0 .5-.224.5-.5v-5.086zM8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
                  />
                </svg>
                <span className="action-label">{copy.photo}</span>
                <input
                  type="file"
                  multiple
                  accept={acceptedImageTypes}
                  aria-label={copy.photo}
                  disabled={imageInputDisabled || photos.length >= 4}
                  onChange={(event) => {
                    onSelectImage(Array.from(event.target.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              <span className="photo-count" aria-label={language === "ko" ? `사진 ${photos.length}/4장` : `${photos.length}/4 photos`}>{photos.length}/4</span>
              {imageProcessingLabel ? (
                <span className="composer-note" role="status">
                  {imageProcessingLabel}
                </span>
              ) : null}
            </div>
            <ComposerSubmit
              draft={draft}
              hydrated={hydrated}
              disabled={submitDisabled}
              hasImage={hasImage || hasQuote}
              label={submitLabel}
              onSubmit={onSubmit}
            />
          </div>
        </div>
      </section>

      {recoveryCode ? (
        <section className="vault-setup recovery-code-panel" aria-label={recoveryCodePanelLabel}>
          <div>
            <p className="eyebrow">{copy.recoveryCode}</p>
            <h2>{copy.recoveryOnce}</h2>
            <p>{copy.recoveryStore}</p>
          </div>
          <code>{recoveryCode}</code>
          <div className="vault-actions">
            <button type="button" onClick={onCopyRecoveryCode}>
              {copy.copyCode}
            </button>
            <button className="secondary" type="button" onClick={onDismissRecoveryCode}>
              {copy.storedSafely}
            </button>
          </div>
        </section>
      ) : hasRemoteRecovery ? (
        <section className="vault-setup" aria-label={remoteRecoveryPanelLabel}>
          <div>
            <p className="eyebrow">
              {hasLocalEnvelope ? remoteRecoveryEyebrow : copy.newDevice}
            </p>
            <h2>{hasLocalEnvelope ? remoteRecoveryTitle : copy.existingVault}</h2>
            <p>{hasLocalEnvelope ? remoteRecoveryDetail : copy.existingVaultDetail}</p>
          </div>
          <form
            className="recovery-form"
            onSubmit={(event) => {
              event.preventDefault();
              onRecoverVault();
            }}
          >
            <input
              value={recoveryInput}
              onChange={(event) => onRecoveryInputChange(event.target.value)}
              placeholder="XXXXX-XXXXX-…-XX"
              aria-label={copy.recoveryCode}
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" disabled={vaultBusy || !recoveryInput.trim()}>
              {vaultBusy ? copy.recovering : copy.recoverHere}
            </button>
          </form>
        </section>
      ) : !hasLocalEnvelope && showRecoverySetup ? (
        <section className="vault-setup" aria-label={setupRecoveryPanelLabel}>
          <div>
            <p className="eyebrow">{copy.protectVault}</p>
            <h2>{copy.prepareRecovery}</h2>
            <p>{copy.prepareRecoveryDetail}</p>
          </div>
          <button type="button" onClick={onCreateRecoveryKit} disabled={vaultBusy}>
            {vaultBusy ? copy.convertingVault : copy.createRecovery}
          </button>
        </section>
      ) : null}

      <div className="feed-label">
        <span>{copy.entries(entryCount)}</span>
      </div>

      <JournalFeedContent
        copy={copy}
        isLoading={isLoading}
        showFirstEntryEmpty={entryCount === 0}
        visibleEntryCount={visibleEntryCount}
        remainingEntryCount={remainingEntryCount}
        emptyDetail={filteredEmptyDetail}
        loadMoreLabel={loadMoreLabel}
        onLoadMore={onLoadMore}
      >
        {children}
      </JournalFeedContent>
    </>
  );
}
