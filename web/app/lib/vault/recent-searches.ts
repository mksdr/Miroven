import {
  KEY_STORE,
  RECENT_SEARCHES_KEY_ID,
  VAULT_FORMAT_CONTRACT,
} from "./contracts";
import { expectBufferLength, toArrayBuffer } from "./codec";
import { getDeviceKey } from "./device-key";
import { openVaultDatabase, requestToPromise, transactionDone } from "./idb";
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

function cleanupLegacyLocalStorage(): void {
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Ignore localStorage failures
  }
}

async function saveEncryptedRecentSearches(
  database: IDBDatabase,
  key: CryptoKey,
  queries: string[],
): Promise<void> {
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
  const record: StoredRecentSearches = {
    iv: toArrayBuffer(iv),
    ciphertext,
    cryptoVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  const transaction = database.transaction(KEY_STORE, "readwrite");
  transaction.objectStore(KEY_STORE).put(record, RECENT_SEARCHES_KEY_ID);
  await transactionDone(transaction);
}

export async function getRecentSearches(): Promise<string[]> {
  if (typeof indexedDB === "undefined") {
    return readLegacyLocalStorage() ?? [];
  }

  let database: IDBDatabase;
  try {
    database = await openVaultDatabase();
  } catch {
    return [];
  }

  try {
    let key: CryptoKey;
    try {
      key = await getDeviceKey(database);
    } catch {
      // Vault is locked or device key cannot be accessed
      return [];
    }

    const transaction = database.transaction(KEY_STORE, "readonly");
    const rawRecord = (await requestToPromise(
      transaction.objectStore(KEY_STORE).get(RECENT_SEARCHES_KEY_ID),
    )) as StoredRecentSearches | undefined;

    if (rawRecord) {
      if (rawRecord.cryptoVersion !== 1) return [];
      expectBufferLength(rawRecord.iv, 12, "최근 검색어 nonce");
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: rawRecord.iv,
          additionalData: toArrayBuffer(RECENT_SEARCHES_AAD),
        },
        key,
        rawRecord.ciphertext,
      );
      const text = new TextDecoder().decode(decrypted);
      const parsed = JSON.parse(text);
      cleanupLegacyLocalStorage();
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .slice(0, MAX_RECENT_SEARCHES);
    }

    // Check if legacy plaintext exists to migrate
    const legacy = readLegacyLocalStorage();
    if (legacy && legacy.length > 0) {
      await saveEncryptedRecentSearches(database, key, legacy);
      cleanupLegacyLocalStorage();
      return legacy;
    }

    return [];
  } catch {
    return [];
  } finally {
    database.close();
  }
}

export async function addRecentSearch(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return await getRecentSearches();
  }

  const current = await getRecentSearches();
  const filtered = current.filter((q) => q !== trimmed);
  const updated = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);

  if (typeof indexedDB === "undefined") {
    return updated;
  }

  let database: IDBDatabase;
  try {
    database = await openVaultDatabase();
  } catch {
    return updated;
  }

  try {
    const key = await getDeviceKey(database);
    await saveEncryptedRecentSearches(database, key, updated);
    cleanupLegacyLocalStorage();
    return updated;
  } catch {
    return updated;
  } finally {
    database.close();
  }
}

export async function removeRecentSearch(query: string): Promise<string[]> {
  const current = await getRecentSearches();
  const updated = current.filter((q) => q !== query);

  if (typeof indexedDB === "undefined") {
    return updated;
  }

  let database: IDBDatabase;
  try {
    database = await openVaultDatabase();
  } catch {
    return updated;
  }

  try {
    const key = await getDeviceKey(database);
    if (updated.length === 0) {
      const transaction = database.transaction(KEY_STORE, "readwrite");
      transaction.objectStore(KEY_STORE).delete(RECENT_SEARCHES_KEY_ID);
      await transactionDone(transaction);
    } else {
      await saveEncryptedRecentSearches(database, key, updated);
    }
    cleanupLegacyLocalStorage();
    return updated;
  } catch {
    return updated;
  } finally {
    database.close();
  }
}

export async function clearRecentSearches(): Promise<void> {
  cleanupLegacyLocalStorage();
  if (typeof indexedDB === "undefined") return;

  let database: IDBDatabase;
  try {
    database = await openVaultDatabase();
  } catch {
    return;
  }

  try {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    transaction.objectStore(KEY_STORE).delete(RECENT_SEARCHES_KEY_ID);
    await transactionDone(transaction);
  } catch {
    // Ignore deletion failures
  } finally {
    database.close();
  }
}
