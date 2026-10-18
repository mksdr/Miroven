import { createElement, createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { JournalWorkspace } from "../app/components/journal/JournalWorkspace";
import { createComposerDraft } from "../app/lib/composer-draft";

const copy = {
  write: "Write",
  editingNotice: "Editing entry",
  cancelEdit: "Cancel",
  composerPlaceholder: "Write privately",
  photoPreview: "Photo preview",
  removePhoto: "Remove photo",
  photo: "Photo",
  imageProcessingLabel: "Optimizing photo...",
  recoveryCode: "Recovery Code",
  recoveryOnce: "Save this code now",
  recoveryStore: "Keep it separately",
  copyCode: "Copy code",
  storedSafely: "Stored safely",
  newDevice: "New device",
  existingVault: "Existing vault",
  existingVaultDetail: "Enter your code",
  recovering: "Recovering",
  recoverHere: "Recover here",
  protectVault: "Protect vault",
  prepareRecovery: "Prepare recovery",
  prepareRecoveryDetail: "Create a recovery code",
  convertingVault: "Converting vault",
  createRecovery: "Create recovery",
  entries: (count: number) => `${count} entries`,
  openVault: "Opening vault",
  loadingDetail: "Loading entries",
  firstTitle: "Write your first entry",
  firstDetail: "Text or one photo is enough",
  noSearchResults: "No matching entries",
};

const baseProps: ComponentProps<typeof JournalWorkspace> = {
  copy,
  avatarLabel: "M",
  draft: createComposerDraft(),
  textareaRef: createRef<HTMLTextAreaElement>(),
  isEditing: false,
  editorDisabled: false,
  image: null,
  imageMetadataLabel: "EXIF removed",
  acceptedImageTypes: "image/*",
  imageInputDisabled: false,
  imageProcessingLabel: "",
  hydrated: true,
  submitDisabled: false,
  hasImage: false,
  submitLabel: "Save",
  recoveryCode: null,
  recoveryCodePanelLabel: "Recovery code panel",
  hasRemoteRecovery: false,
  hasLocalEnvelope: true,
  remoteRecoveryPanelLabel: "Remote recovery panel",
  remoteRecoveryEyebrow: "Server recovery",
  remoteRecoveryTitle: "Restore server key",
  remoteRecoveryDetail: "Merge this device with the server key",
  setupRecoveryPanelLabel: "Setup recovery panel",
  recoveryInput: "",
  vaultBusy: false,
  entryCount: 1,
  isLoading: false,
  visibleEntryCount: 1,
  remainingEntryCount: 0,
  filteredEmptyDetail: "Try another filter",
  loadMoreLabel: "Load more",
  children: createElement("ol", null, createElement("li", null, "Visible entry")),
  onCancelEditing: vi.fn(),
  onRemoveImage: vi.fn(),
  onSelectImage: vi.fn(),
  onSubmit: vi.fn(async () => undefined),
  onCopyRecoveryCode: vi.fn(),
  onDismissRecoveryCode: vi.fn(),
  onRecoveryInputChange: vi.fn(),
  onRecoverVault: vi.fn(),
  onCreateRecoveryKit: vi.fn(),
  onLoadMore: vi.fn(),
};

describe("journal workspace presentation", () => {
  it("renders editing and local photo-preview states", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalWorkspace, {
        ...baseProps,
        isEditing: true,
        image: { previewUrl: "blob:test-preview", width: 800, height: 600 },
        hasImage: true,
      }),
    );

    expect(markup).toContain("Editing entry");
    expect(markup).toContain("blob:test-preview");
    expect(markup).toContain("800 × 600 · EXIF removed");
    expect(markup).toContain("Visible entry");
  });

  it("renders X-style SVG photo icon and hides note by default, showing note only when processing", () => {
    const idleMarkup = renderToStaticMarkup(createElement(JournalWorkspace, baseProps));

    expect(idleMarkup).toContain("photo-button-icon");
    expect(idleMarkup).toContain('type="file"');
    expect(idleMarkup).toContain('aria-label="Photo"');
    expect(idleMarkup).not.toContain("▧");
    expect(idleMarkup).not.toContain("composer-note");

    const processingMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, {
        ...baseProps,
        imageProcessingLabel: "사진 최적화 중...",
      }),
    );

    expect(processingMarkup).toContain("composer-note");
    expect(processingMarkup).toContain("사진 최적화 중...");
  });

  it("shows a newly issued recovery code before other recovery states", () => {
    const markup = renderToStaticMarkup(
      createElement(JournalWorkspace, {
        ...baseProps,
        recoveryCode: "TEST-RECOVERY-CODE",
        hasRemoteRecovery: true,
        hasLocalEnvelope: false,
      }),
    );

    expect(markup).toContain("TEST-RECOVERY-CODE");
    expect(markup).toContain("Save this code now");
    expect(markup).not.toContain("Existing vault");
  });

  it("keeps remote recovery and first-device setup states distinct", () => {
    const remoteMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, {
        ...baseProps,
        hasRemoteRecovery: true,
        recoveryInput: "TEST-CODE",
      }),
    );
    const setupMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, {
        ...baseProps,
        hasLocalEnvelope: false,
      }),
    );

    expect(remoteMarkup).toContain("Restore server key");
    expect(remoteMarkup).toContain("Recover here");
    expect(setupMarkup).toContain("Prepare recovery");
    expect(setupMarkup).toContain("Create recovery");
  });

  it("separates loading, first-entry, filtered-empty, and paginated states", () => {
    const loadingMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, { ...baseProps, isLoading: true }),
    );
    const firstEntryMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, {
        ...baseProps,
        entryCount: 0,
        visibleEntryCount: 0,
      }),
    );
    const filteredMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, { ...baseProps, visibleEntryCount: 0 }),
    );
    const paginatedMarkup = renderToStaticMarkup(
      createElement(JournalWorkspace, { ...baseProps, remainingEntryCount: 7 }),
    );

    expect(loadingMarkup).toContain("Opening vault");
    expect(firstEntryMarkup).toContain("Write your first entry");
    expect(filteredMarkup).toContain("No matching entries");
    expect(filteredMarkup).toContain("Try another filter");
    expect(paginatedMarkup).toContain("Load more (7)");
  });
});
