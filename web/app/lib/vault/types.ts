export type JournalImage = {
  id?: string;
  dataUrl: string;
  width: number;
  height: number;
  mimeType: string;
};

export type JournalEntry = {
  id: string;
  text: string;
  createdAt: string;
  image?: JournalImage;
  images?: JournalImage[];
  attachmentVersion?: 2;
  pinnedAt?: string;
  quotedEntryId?: string;
};

export type VaultEnvelope = {
  wrappedVaultKey: ArrayBuffer;
  wrappingNonce: ArrayBuffer;
  recoverySalt: ArrayBuffer;
  recoveryFormat: "base32-hkdf-sha256-v1";
  cryptoVersion: 1;
  keyVersion: 1;
};

export type StoredEntry = {
  id: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  wrappedDataKey?: ArrayBuffer;
  keyNonce?: ArrayBuffer;
  cryptoVersion: 1 | 2 | 3;
  revision?: number;
  syncState: "local" | "pending" | "synced" | "conflict";
};

export type SyncStatus =
  | "local"
  | "ready"
  | "syncing"
  | "synced"
  | "conflict"
  | "error";

export type EncryptedSyncEnvelope = {
  ciphertext: ArrayBuffer;
  contentNonce: ArrayBuffer;
  wrappedDataKey: ArrayBuffer;
  keyNonce: ArrayBuffer;
  cryptoVersion: 1;
};

export type EncryptedBlobEnvelope = EncryptedSyncEnvelope & {
  id: string;
};

export type SyncOperation = {
  operationId: string;
  entryId: string;
  baseRevision: number;
  revision: number;
  changeType: "upsert" | "delete";
  payload?: EncryptedSyncEnvelope;
  blob?: EncryptedBlobEnvelope;
  blobs?: EncryptedBlobEnvelope[];
  attachmentVersion?: 2;
  createdAt: string;
  status: "pending" | "conflict";
  lastError?: string;
};

export type RemoteSyncChange = {
  serverCursor: number | string;
  operationId: string;
  entryId: string;
  baseRevision: number;
  revision: number;
  changeType: "upsert" | "delete";
  payload?: EncryptedSyncEnvelope;
};

export type CloudEntryPayload = Omit<JournalEntry, "image" | "images"> & {
  image?: Omit<JournalImage, "dataUrl"> & { blobId: string };
  images?: Array<Omit<JournalImage, "dataUrl"> & { blobId: string }>;
};

export type StoredVaultEnvelope = VaultEnvelope & { id: "primary" };

export type SerializedSyncEnvelope = {
  ciphertext: string;
  contentNonce: string;
  wrappedDataKey: string;
  keyNonce: string;
  cryptoVersion: 1;
};

export type SerializedSyncOperation = {
  operationId: string;
  entryId: string;
  baseRevision: number;
  revision: number;
  changeType: "upsert" | "delete";
  payload?: SerializedSyncEnvelope;
  blob?: SerializedSyncEnvelope & { id: string };
  blobs?: Array<SerializedSyncEnvelope & { id: string }>;
  attachmentVersion?: 2;
  createdAt: string;
  status: "pending" | "conflict";
};

export type EncryptedBackupV1 = {
  format: "miroven-encrypted-backup";
  version: 1;
  exportedAt: string;
  vault: {
    wrappedVaultKey: string;
    wrappingNonce: string;
    recoverySalt: string;
    recoveryFormat: "base32-hkdf-sha256-v1";
    cryptoVersion: 1;
    keyVersion: 1;
  };
  entries: Array<{
    id: string;
    iv: string;
    ciphertext: string;
    wrappedDataKey: string;
    keyNonce: string;
    cryptoVersion: 3;
    revision: number;
    syncState: "local" | "pending" | "synced" | "conflict";
  }>;
  outbox: SerializedSyncOperation[];
  serverCursor: number;
};

export type EncryptedBackupV2 = Omit<EncryptedBackupV1, "version"> & {
  version: 2;
  authentication: {
    algorithm: "hmac-sha256";
    tag: string;
  };
};

export type EncryptedBackupExport = {
  json: string;
  filename: string;
  entryCount: number;
};

export type EncryptedBackupImportResult = {
  entries: number;
  pending: number;
  conflicts: number;
};

export type LocalSyncSnapshot = {
  conflictEntryIds: string[];
  pending: number;
  conflicts: number;
  cursor: number | string;
};

export type PinLockEnvelope = {
  salt: ArrayBuffer;
  iv: ArrayBuffer;
  wrappedKey: ArrayBuffer;
  iterations: number;
};

export type JournalDraft = {
  text: string;
  editingEntryId?: string | null;
  quotedEntryId?: string;
  updatedAt: string;
};

export type StoredDraft = {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  cryptoVersion: 1;
};

export type CleanupStats = {
  removedTombstones: number;
  removedOrphanedBlobs: number;
};

export type StoredRecentSearches = {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
  cryptoVersion: 1;
  updatedAt: string;
};
