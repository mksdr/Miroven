import { PERSONA_DOCUMENT_ID, validatePersona, type Persona } from "./persona";
import { readPersona } from "./vault/persona";
import { getSyncSnapshot as personaSyncSnapshot } from "./vault/sync-outbox";
import { withVaultLock } from "./vault/mutation-lock";
import { EntryPinLimitError, MAX_PINNED_ENTRIES, orderJournalEntries } from "./entry-pins";
import { EntryQuoteError, validateEntryQuote } from "./entry-quotes";
import type {
  JournalEntry,
  StoredEntry,
} from "./vault/types";
import {
  ENTRY_STORE,
  KEY_STORE,
  OUTBOX_STORE,
  SYNC_META_STORE,
  STAGE_STORE,
  VAULT_ENVELOPE_ID,
  VAULT_STORE,
} from "./vault/contracts";
import {
  requestToPromise,
  transactionDone,
  withVaultDatabase,
} from "./vault/idb";
import {
  clearStoredDraft,
  getStoredDraft,
  saveDraft,
} from "./vault/drafts";
import { getDeviceKey } from "./vault/device-key";
import { clearPinFailures } from "./vault/pin-lock";
import { mapWithBudget, performancePolicy, prefersLowSpecMode } from "./performance-policy";
import { createJournalReader as createReader } from "./vault/journal-reader";
import {
  decryptEntry,
  encryptEntry,
} from "./vault/entry-crypto";
import {
  createDeleteOperation,
  createUpsertOperation,
  registerEntryLoader,
  resolveConflictKeepBoth as resolveConflictKeepBothInternal,
  resolveConflictUseLocal as resolveConflictUseLocalInternal,
} from "./vault/sync-outbox";

export type { JournalEntrySummary } from "./vault/read-cache";

export type {
  CleanupStats,
  EncryptedBackupExport,
  EncryptedBackupImportResult,
  EncryptedBlobEnvelope,
  EncryptedSyncEnvelope,
  JournalDraft,
  JournalEntry,
  JournalImage,
  LocalSyncSnapshot,
  PinLockEnvelope,
  RemoteSyncChange,
  StoredRecentSearches,
  SyncOperation,
  SyncStatus,
  VaultEnvelope,
} from "./vault/types";

export {
  equalBuffer,
  sameVaultEnvelope,
} from "./vault/codec";

export {
  clearStoredDraft,
  getStoredDraft,
  saveDraft,
};

export {
  ENCRYPTED_BACKUP_ACCEPT,
  ENCRYPTED_BACKUP_MAX_BYTES,
} from "./vault/contracts";

export {
  addRecentSearch,
  clearRecentSearches,
  getRecentSearches,
  removeRecentSearch,
} from "./vault/recent-searches";

export {
  clearPinFailures,
  getPinLockoutRemainingSeconds,
  hasPinLock,
  isRecommendedPinLength,
  isValidPinFormat,
  isVaultLocked,
  lockDeviceKey,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  RECOMMENDED_MIN_PIN_LENGTH,
  removePinLock,
  setupPinLock,
  unlockVaultWithPin,
} from "./vault/pin-lock";

export {
  cleanupExpiredTombstones,
  cleanupOrphanedBlobs,
} from "./vault/cleanup";

export {
  createRecoveryKit,
  getLocalVaultEnvelope,
  recoverVault,
  RecoveryPinLockError,
} from "./vault/recovery";

export {
  createEncryptedBackup,
  importEncryptedBackup,
  LegacyBackupDeletionError,
} from "./vault/backup";

export {
  acknowledgeSyncOperation,
  applyRemoteSyncChange,
  getSyncSnapshot,
  listPendingSyncOperations,
  markSyncOperationConflict,
} from "./vault/sync-outbox";

export {
  decryptEntry,
  encryptEntry,
} from "./vault/entry-crypto";

export function savePersona(persona: Persona, expected: Persona | null): Promise<void> {
  return withVaultLock("mutation", async () => {
    validatePersona(persona);
    const current = await readPersona();
    if (
      JSON.stringify(current) !== JSON.stringify(expected) ||
      (await personaSyncSnapshot()).conflictEntryIds.includes(PERSONA_DOCUMENT_ID)
    ) {
      throw new Error("Persona changed; reload before saving");
    }
    await saveEntryUnlocked({
      id: PERSONA_DOCUMENT_ID,
      text: JSON.stringify(persona),
      createdAt: new Date().toISOString(),
    });
  });
}

export function saveEntry(entry: JournalEntry): Promise<void> {
  return withVaultLock("mutation", () => saveEntryUnlocked(entry));
}

export function setEntryPinned(id: string, pinned: boolean): Promise<void> {
  return withVaultLock("mutation", async () => {
    if (id === PERSONA_DOCUMENT_ID) throw new Error("Entry not found.");
    const target = await withVaultDatabase(async (database) => {
      const key = await getDeviceKey(database);
      const tx = database.transaction(ENTRY_STORE, "readonly");
      const record = (await requestToPromise(
        tx.objectStore(ENTRY_STORE).get(id),
      )) as StoredEntry | undefined;
      if (!record) return null;
      return decryptEntry(key, record);
    });
    if (!target) throw new Error("Entry not found.");
    if (Boolean(target.pinnedAt) === pinned) return;
    if (pinned) {
      const entries = await listEntries();
      if (entries.filter((item) => item.pinnedAt).length >= MAX_PINNED_ENTRIES) {
        throw new EntryPinLimitError();
      }
    }
    await saveEntryUnlocked(
      { ...target, pinnedAt: pinned ? new Date().toISOString() : undefined },
      false,
    );
  });
}

async function saveEntryUnlocked(entry: JournalEntry, preservePin = true): Promise<void> {
  await withVaultDatabase(async (database) => {
    const key = await getDeviceKey(database);
    const readTx = database.transaction([ENTRY_STORE, VAULT_STORE, SYNC_META_STORE], "readonly");
    const existingRequest = readTx.objectStore(ENTRY_STORE).get(entry.id);
    const envelopeRequest = readTx.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID);
    const revisionRequest = readTx.objectStore(SYNC_META_STORE).get(`revision:${entry.id}`);
    const [existing, recoveryEnvelope, knownRevision] = await Promise.all([
      requestToPromise(existingRequest) as Promise<StoredEntry | undefined>,
      requestToPromise(envelopeRequest),
      requestToPromise(revisionRequest) as Promise<number | undefined>,
    ]);
    const hasRecoveryEnvelope = Boolean(recoveryEnvelope);

    if (preservePin) {
      // Editing content cannot overwrite a pin changed in another tab.
      const current = existing ? await decryptEntry(key, existing) : undefined;
      entry = { ...entry, pinnedAt: current?.pinnedAt };
      // Callers predating quotes must not remove a relationship by omission.
      if (!Object.hasOwn(entry, "quotedEntryId") && current?.quotedEntryId) {
        entry = { ...entry, quotedEntryId: current.quotedEntryId };
      }
    }

    validateEntryQuote(entry);
    const visited = new Set([entry.id]);
    let quotedId = entry.quotedEntryId;
    while (quotedId) {
      if (visited.has(quotedId)) throw new EntryQuoteError("인용 관계가 순환할 수 없습니다.");
      visited.add(quotedId);
      const quoted = (await requestToPromise(
        database.transaction(ENTRY_STORE, "readonly").objectStore(ENTRY_STORE).get(quotedId),
      )) as StoredEntry | undefined;
      if (!quoted) break; // References may arrive before their originals during sync/restore.
      quotedId = (await decryptEntry(key, quoted)).quotedEntryId;
    }

    const currentRev = Math.max(existing?.revision ?? 0, knownRevision ?? 0);
    const nextRev = currentRev + 1;
    const storedEntry = await encryptEntry(key, entry);
    const operation = hasRecoveryEnvelope
      ? await createUpsertOperation(key, entry, nextRev, currentRev)
      : null;
    storedEntry.revision = nextRev;
    storedEntry.syncState = operation ? "pending" : "local";
    const transaction = database.transaction(
      operation ? [ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE] : [ENTRY_STORE, SYNC_META_STORE],
      "readwrite",
    );
    transaction.objectStore(ENTRY_STORE).put(storedEntry);
    transaction.objectStore(SYNC_META_STORE).put(nextRev, `revision:${entry.id}`);
    if (operation) transaction.objectStore(OUTBOX_STORE).put(operation);
    await transactionDone(transaction);
  });
}

async function listVaultDocuments(
  options: { lowSpecMode?: boolean; signal?: AbortSignal } = {},
): Promise<JournalEntry[]> {
  options.signal?.throwIfAborted();
  return withVaultDatabase(async (database) => {
    const key = await getDeviceKey(database);
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    const records = (await requestToPromise(
      transaction.objectStore(ENTRY_STORE).getAll(),
    )) as StoredEntry[];
    const policy = performancePolicy(options.lowSpecMode ?? prefersLowSpecMode());
    const entries = await mapWithBudget(records, (record) => decryptEntry(key, record), {
      concurrency: policy.decryptConcurrency,
      workSliceMs: policy.workSliceMs,
      signal: options.signal,
    });
    return orderJournalEntries(entries);
  });
}

export async function listEntries(
  options: { lowSpecMode?: boolean; signal?: AbortSignal } = {},
): Promise<JournalEntry[]> {
  return (await listVaultDocuments(options)).filter(
    (entry) => entry.id !== PERSONA_DOCUMENT_ID,
  );
}

registerEntryLoader(listVaultDocuments);

export function createJournalReader(lowSpecMode = prefersLowSpecMode()) {
  return createReader(decryptEntry, lowSpecMode);
}

export type JournalReader = ReturnType<typeof createJournalReader>;

export function deleteEntry(id: string): Promise<void> {
  return withVaultLock("mutation", () => deleteEntryUnlocked(id));
}

async function deleteEntryUnlocked(id: string): Promise<void> {
  await withVaultDatabase(async (database) => {
    const readTransaction = database.transaction([ENTRY_STORE, VAULT_STORE], "readonly");
    const recordRequest = readTransaction.objectStore(ENTRY_STORE).get(id);
    const envelopeRequest = readTransaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID);
    const [record, recoveryEnvelope] = await Promise.all([
      requestToPromise(recordRequest) as Promise<StoredEntry | undefined>,
      requestToPromise(envelopeRequest),
    ]);
    if (!record) return;
    const hasRecoveryEnvelope = Boolean(recoveryEnvelope);
    const baseRevision = record.revision ?? 1;
    const nextRevision = baseRevision + 1;
    const transaction = database.transaction(
      [ENTRY_STORE, OUTBOX_STORE, SYNC_META_STORE],
      "readwrite",
    );
    transaction.objectStore(ENTRY_STORE).delete(id);
    transaction.objectStore(SYNC_META_STORE).put(nextRevision, `revision:${id}`);
    if (hasRecoveryEnvelope) {
      transaction
        .objectStore(OUTBOX_STORE)
        .put(createDeleteOperation(id, nextRevision, baseRevision));
    }
    await transactionDone(transaction);
  });
}

export function resolveConflictUseLocal(
  entryId: string,
  options: { reload?: boolean } = {},
): Promise<JournalEntry[]> {
  return resolveConflictUseLocalInternal(entryId, options, listEntries);
}

export function resolveConflictKeepBoth(
  entryId: string,
  options: { reload?: boolean } = {},
): Promise<JournalEntry[]> {
  return resolveConflictKeepBothInternal(entryId, options, listEntries);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export async function purgeLocalVaultData(): Promise<void> {
  return withVaultLock("mutation", purgeLocalVaultDataUnlocked);
}

export async function purgeAccountVaultData(expectedScope: string): Promise<boolean> {
  return withVaultLock("mutation", async () => {
    const matches = await withVaultDatabase(async (database) => {
      const tx = database.transaction(SYNC_META_STORE, "readonly");
      const scope = await requestToPromise(tx.objectStore(SYNC_META_STORE).get("remote-scope"));
      return scope === expectedScope;
    });
    if (!matches) return false;
    await purgeLocalVaultDataUnlocked();
    return true;
  });
}

async function purgeLocalVaultDataUnlocked(): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("miroven:recent_searches");
      localStorage.removeItem("miroven:ios_pwa_prompt_dismissed");
      await clearPinFailures();
    } catch {
      // Ignore
    }
  }

  await withVaultDatabase(async (database) => {
    const stores = [
      ENTRY_STORE,
      KEY_STORE,
      VAULT_STORE,
      OUTBOX_STORE,
      SYNC_META_STORE,
      STAGE_STORE,
    ];
    const transaction = database.transaction(stores, "readwrite");
    for (const storeName of stores) {
      transaction.objectStore(storeName).clear();
    }
    await transactionDone(transaction);
    if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel("miroven-vault-reset");
        channel.postMessage("cleared");
        channel.close();
      } catch {
        /* Local deletion succeeded even if other tabs cannot be notified. */
      }
    }
  });
}
