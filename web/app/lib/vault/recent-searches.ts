import {
  KEY_STORE,
  RECENT_SEARCHES_KEY_ID,
  VAULT_FORMAT_CONTRACT,
  VAULT_RESET_TOKEN_ID,
} from "./contracts";
import { expectBufferLength, toArrayBuffer } from "./codec";
import { getDeviceKey, getStoredDeviceKey } from "./device-key";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import { withVaultLock } from "./mutation-lock";
import { getOrCreateVaultResetToken } from "./reset-token";
import type { StoredRecentSearches } from "./types";

const LEGACY_STORAGE_KEY = "miroven:recent_searches";
const MAX_RECENT_SEARCHES = 10;
const RECENT_SEARCHES_AAD = new TextEncoder().encode(
  VAULT_FORMAT_CONTRACT.recentSearchesAad,
);

function getLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function readLegacyLocalStorage(): string[] | null {
  const storage = getLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const filtered = parsed
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim())
      .slice(0, MAX_RECENT_SEARCHES);
    return filtered;
  } catch {
    return null;
  }
}

function cleanupLegacyLocalStorage(): boolean {
  const storage = getLocalStorage();
  if (!storage) return true;
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

async function encryptRecentSearches(
  key: CryptoKey,
  queries: string[],
): Promise<StoredRecentSearches> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(queries));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: toArrayBuffer(RECENT_SEARCHES_AAD),
    },
    key,
    toArrayBuffer(encoded),
  );
  return {
    iv: toArrayBuffer(iv),
    ciphertext,
    cryptoVersion: VAULT_FORMAT_CONTRACT.recentSearchesCryptoVersion,
    updatedAt: new Date().toISOString(),
  };
}

async function decryptRecentSearches(record: StoredRecentSearches, key: CryptoKey): Promise<string[]> {
  if (record.cryptoVersion !== VAULT_FORMAT_CONTRACT.recentSearchesCryptoVersion) {
    throw new Error("지원하지 않는 최근 검색어 형식입니다.");
  }
  expectBufferLength(record.iv, 12, "최근 검색어 nonce");
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: record.iv,
      additionalData: toArrayBuffer(RECENT_SEARCHES_AAD),
    },
    key,
    record.ciphertext,
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted));
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .slice(0, MAX_RECENT_SEARCHES);
}

function readKeyRecord(database: IDBDatabase, id: string): Promise<unknown> {
  const store = database.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE);
  return requestToPromise(store.get(id));
}

async function commitRecentSearches(
  database: IDBDatabase,
  resetToken: string,
  record: StoredRecentSearches | null,
): Promise<boolean> {
  const transaction = database.transaction(KEY_STORE, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(KEY_STORE);
  try {
    // Purge changes the token in this same store, even when tabs lack Web Locks.
    const isCurrent = await requestToPromise(store.get(VAULT_RESET_TOKEN_ID)) === resetToken;
    if (isCurrent) {
      if (record) store.put(record, RECENT_SEARCHES_KEY_ID);
      else store.delete(RECENT_SEARCHES_KEY_ID);
    }
    await done;
    return isCurrent;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

async function withRecentSearchOperation<T>(
  fallback: T,
  operation: (database: IDBDatabase, resetToken: string) => Promise<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined") return fallback;
  try {
    const resetToken = await getOrCreateVaultResetToken();
    return await withVaultLock("mutation", () => withVaultDatabase(async (database) => {
      if (await readKeyRecord(database, VAULT_RESET_TOKEN_ID) !== resetToken) return fallback;
      return operation(database, resetToken);
    }));
  } catch {
    return fallback;
  }
}

export async function getRecentSearches(): Promise<string[]> {
  if (typeof indexedDB === "undefined") return readLegacyLocalStorage() ?? [];

  return withRecentSearchOperation<string[]>([], async (database, resetToken) => {
    const record = await readKeyRecord(database, RECENT_SEARCHES_KEY_ID) as StoredRecentSearches | undefined;
    if (record) {
      const key = await getStoredDeviceKey(database);
      if (!key) return [];
      const queries = await decryptRecentSearches(record, key);
      if (await readKeyRecord(database, VAULT_RESET_TOKEN_ID) !== resetToken) return [];
      cleanupLegacyLocalStorage();
      return queries;
    }

    const legacy = readLegacyLocalStorage();
    if (!legacy?.length) return [];
    const key = await getDeviceKey(database, resetToken);
    const encrypted = await encryptRecentSearches(key, legacy);
    if (!await commitRecentSearches(database, resetToken, encrypted)) return [];
    cleanupLegacyLocalStorage();
    return legacy;
  });
}

function updateRecentSearches(update: (current: string[]) => string[]): Promise<string[] | null> {
  return withRecentSearchOperation<string[] | null>(null, async (database, resetToken) => {
    const key = await getDeviceKey(database, resetToken);
    const record = await readKeyRecord(database, RECENT_SEARCHES_KEY_ID) as StoredRecentSearches | undefined;
    const current = record
      ? await decryptRecentSearches(record, key).catch(() => [])
      : readLegacyLocalStorage() ?? [];
    const updated = update(current);
    const encrypted = updated.length ? await encryptRecentSearches(key, updated) : null;
    if (!await commitRecentSearches(database, resetToken, encrypted)) return null;
    cleanupLegacyLocalStorage();
    return updated;
  });
}

export async function addRecentSearch(query: string): Promise<string[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return getRecentSearches();
  return updateRecentSearches((current) => {
    const otherQueries = current.filter((item) => item !== trimmed);
    return [trimmed, ...otherQueries].slice(0, MAX_RECENT_SEARCHES);
  });
}

export function removeRecentSearch(query: string): Promise<string[] | null> {
  return updateRecentSearches((current) => current.filter((q) => q !== query));
}

export async function clearRecentSearches(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return cleanupLegacyLocalStorage();
  return withRecentSearchOperation(false, async (database, resetToken) => {
    const cleared = await commitRecentSearches(database, resetToken, null);
    return cleared && cleanupLegacyLocalStorage();
  });
}
