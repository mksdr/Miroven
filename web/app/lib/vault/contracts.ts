export const VAULT_DATABASE_CONTRACT = {
  name: "private-journal",
  version: 4,
  stores: {
    entries: "entries",
    deviceKeys: "device-keys",
    vaultEnvelopes: "vault-envelopes",
    syncOutbox: "sync-outbox",
    syncMeta: "sync-meta",
    remoteStage: "remote-stage",
  },
  keys: {
    device: "primary",
    vaultEnvelope: "primary",
    pinLock: "pin-lock-envelope",
    pinFailure: "pin-failure-meta",
    recentSearches: "recent-searches",
    draft: "miroven-composer-draft",
  },
} as const;

export const VAULT_FORMAT_CONTRACT = {
  backupFormat: "miroven-encrypted-backup",
  backupVersion: 1,
  recoveryFormat: "base32-hkdf-sha256-v1",
  syncCryptoVersion: 1,
  currentEntryCryptoVersion: 3,
  recoveryAad: "private-journal:vault-key-envelope:v1",
  recoveryInfo: "private-journal:recovery-wrap-key:v1",
  recentSearchesCryptoVersion: 1,
  recentSearchesAad: "private-journal:recent-searches:v1",
  draftCryptoVersion: 1,
  draftAad: "private-journal:composer-draft:v1",
} as const;

export const ENCRYPTED_BACKUP_MAX_BYTES = 100 * 1024 * 1024;
export const ENCRYPTED_BACKUP_ACCEPT = ".miroven-backup.json,application/json";

export const ENTRY_STORE = VAULT_DATABASE_CONTRACT.stores.entries;
export const KEY_STORE = VAULT_DATABASE_CONTRACT.stores.deviceKeys;
export const VAULT_STORE = VAULT_DATABASE_CONTRACT.stores.vaultEnvelopes;
export const OUTBOX_STORE = VAULT_DATABASE_CONTRACT.stores.syncOutbox;
export const SYNC_META_STORE = VAULT_DATABASE_CONTRACT.stores.syncMeta;
export const STAGE_STORE = VAULT_DATABASE_CONTRACT.stores.remoteStage;
export const DEVICE_KEY_ID = VAULT_DATABASE_CONTRACT.keys.device;
export const VAULT_ENVELOPE_ID = VAULT_DATABASE_CONTRACT.keys.vaultEnvelope;
export const PIN_LOCK_KEY_ID = VAULT_DATABASE_CONTRACT.keys.pinLock;
export const PIN_FAILURE_META_ID = VAULT_DATABASE_CONTRACT.keys.pinFailure;
export const RECENT_SEARCHES_KEY_ID = VAULT_DATABASE_CONTRACT.keys.recentSearches;
export const DRAFT_STORE_KEY = VAULT_DATABASE_CONTRACT.keys.draft;
