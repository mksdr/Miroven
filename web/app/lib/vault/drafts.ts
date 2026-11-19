import type { JournalDraft, StoredDraft } from "./types";
import { DRAFT_STORE_KEY, KEY_STORE, VAULT_FORMAT_CONTRACT } from "./contracts";
import { expectBufferLength, toArrayBuffer } from "./codec";
import { getDeviceKey } from "./device-key";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import { VaultResetError } from "./operation-errors";
import { assertVaultResetToken, getOrCreateVaultResetToken } from "./reset-token";

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

async function commitDraftRecord(database: IDBDatabase, resetToken: string, record?: StoredDraft): Promise<void> {
  const transaction = database.transaction(KEY_STORE, "readwrite");
  const done = transactionDone(transaction);
  const keys = transaction.objectStore(KEY_STORE);
  try {
    await assertVaultResetToken(keys, resetToken);
    if (record) keys.put(record, DRAFT_STORE_KEY);
    else keys.delete(DRAFT_STORE_KEY);
    await done;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

async function encryptDraft(
  key: CryptoKey,
  draft: JournalDraft,
): Promise<StoredDraft> {
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
  return {
    iv: toArrayBuffer(iv),
    ciphertext,
    cryptoVersion: VAULT_FORMAT_CONTRACT.draftCryptoVersion,
  };
}

export async function saveDraft(draft: JournalDraft, expectedResetToken?: string): Promise<void> {
  const resetToken = expectedResetToken ?? await getOrCreateVaultResetToken();
  await withVaultDatabase(async (database) => {
    await assertVaultResetToken(database.transaction(KEY_STORE).objectStore(KEY_STORE), resetToken);
    const key = await getDeviceKey(database, resetToken);
    const record = await encryptDraft(key, draft);
    await commitDraftRecord(database, resetToken, record);
  });
}

export async function getStoredDraft(expectedResetToken?: string): Promise<JournalDraft | null> {
  const resetToken = expectedResetToken ?? await getOrCreateVaultResetToken();
  return withVaultDatabase(async (database) => {
    const keys = database.transaction(KEY_STORE).objectStore(KEY_STORE);
    const [stored] = await Promise.all([
      requestToPromise(keys.get(DRAFT_STORE_KEY)),
      assertVaultResetToken(keys, resetToken),
    ]);
    if (stored === undefined) return null;

    let key: CryptoKey;
    try {
      key = await getDeviceKey(database, resetToken);
    } catch (error) {
      if (error instanceof VaultResetError) throw error;
      // Never leave a legacy plaintext draft exposed while the vault is locked.
      if (isJournalDraft(stored)) await commitDraftRecord(database, resetToken);
      return null;
    }

    if (isJournalDraft(stored)) {
      try {
        const record = await encryptDraft(key, stored);
        await commitDraftRecord(database, resetToken, record);
        return stored;
      } catch (error) {
        if (error instanceof VaultResetError) throw error;
        await commitDraftRecord(database, resetToken);
        return null;
      }
    }

    if (!isStoredDraft(stored)) {
      await commitDraftRecord(database, resetToken);
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
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (!isJournalDraft(parsed)) throw new Error("초안 형식이 올바르지 않습니다.");
      await assertVaultResetToken(database.transaction(KEY_STORE).objectStore(KEY_STORE), resetToken);
      return parsed;
    } catch (error) {
      if (error instanceof VaultResetError) throw error;
      await commitDraftRecord(database, resetToken);
      return null;
    }
  });
}

export async function clearStoredDraft(expectedResetToken?: string): Promise<void> {
  const resetToken = expectedResetToken ?? await getOrCreateVaultResetToken();
  await withVaultDatabase((database) => commitDraftRecord(database, resetToken));
}
