import type { JournalDraft, StoredDraft } from "./types";
import { DRAFT_STORE_KEY, KEY_STORE, VAULT_FORMAT_CONTRACT } from "./contracts";
import { expectBufferLength, toArrayBuffer } from "./codec";
import { getDeviceKey } from "./device-key";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";

const DRAFT_AAD = new TextEncoder().encode(VAULT_FORMAT_CONTRACT.draftAad);

function isJournalDraft(value: unknown): value is JournalDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<JournalDraft>;
  return (
    typeof draft.text === "string" &&
    (draft.quotedEntryId === undefined ||
      (typeof draft.quotedEntryId === "string" &&
        !!draft.quotedEntryId.trim() &&
        draft.quotedEntryId.length <= 256)) &&
    typeof draft.updatedAt === "string" &&
    (draft.editingEntryId === undefined ||
      draft.editingEntryId === null ||
      typeof draft.editingEntryId === "string")
  );
}

function isStoredDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<StoredDraft>;
  return (
    draft.cryptoVersion === VAULT_FORMAT_CONTRACT.draftCryptoVersion &&
    draft.iv instanceof ArrayBuffer &&
    draft.ciphertext instanceof ArrayBuffer
  );
}

async function deleteDraftRecord(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(KEY_STORE, "readwrite");
  transaction.objectStore(KEY_STORE).delete(DRAFT_STORE_KEY);
  await transactionDone(transaction);
}

async function saveEncryptedDraft(
  database: IDBDatabase,
  key: CryptoKey,
  draft: JournalDraft,
): Promise<void> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(draft));
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: toArrayBuffer(DRAFT_AAD),
      },
      key,
      toArrayBuffer(plaintext),
    );
  } finally {
    plaintext.fill(0);
  }
  const record: StoredDraft = {
    iv: toArrayBuffer(iv),
    ciphertext,
    cryptoVersion: VAULT_FORMAT_CONTRACT.draftCryptoVersion,
  };
  const transaction = database.transaction(KEY_STORE, "readwrite");
  transaction.objectStore(KEY_STORE).put(record, DRAFT_STORE_KEY);
  await transactionDone(transaction);
}

export async function saveDraft(draft: JournalDraft): Promise<void> {
  await withVaultDatabase(async (database) => {
    const key = await getDeviceKey(database);
    await saveEncryptedDraft(database, key, draft);
  });
}

export async function getStoredDraft(): Promise<JournalDraft | null> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readonly");
    const stored = await requestToPromise(
      transaction.objectStore(KEY_STORE).get(DRAFT_STORE_KEY),
    );
    if (stored === undefined) return null;

    let key: CryptoKey;
    try {
      key = await getDeviceKey(database);
    } catch {
      // Never leave a legacy plaintext draft exposed while the vault is locked.
      if (isJournalDraft(stored)) await deleteDraftRecord(database);
      return null;
    }

    if (isJournalDraft(stored)) {
      try {
        await saveEncryptedDraft(database, key, stored);
        return stored;
      } catch {
        await deleteDraftRecord(database);
        return null;
      }
    }

    if (!isStoredDraft(stored)) {
      await deleteDraftRecord(database);
      return null;
    }

    try {
      expectBufferLength(stored.iv, 12, "초안 nonce");
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: stored.iv,
          additionalData: toArrayBuffer(DRAFT_AAD),
        },
        key,
        stored.ciphertext,
      );
      const parsed = JSON.parse(new TextDecoder().decode(plaintext));
      if (!isJournalDraft(parsed)) throw new Error("초안 형식이 올바르지 않습니다.");
      return parsed;
    } catch {
      await deleteDraftRecord(database);
      return null;
    }
  });
}

export async function clearStoredDraft(): Promise<void> {
  await withVaultDatabase(deleteDraftRecord);
}
