import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addRecentSearch,
  clearRecentSearches,
  createEncryptedBackup,
  createRecoveryKit,
  getRecentSearches,
  isVaultLocked,
  lockDeviceKey,
  purgeLocalVaultData,
  removeRecentSearch,
  saveEntry,
  setupPinLock,
  unlockVaultWithPin,
} from "../app/lib/local-vault";
import {
  KEY_STORE,
  RECENT_SEARCHES_KEY_ID,
  VAULT_DATABASE_CONTRACT,
} from "../app/lib/vault/contracts";
import type { StoredRecentSearches } from "../app/lib/vault/types";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(VAULT_DATABASE_CONTRACT.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("테스트 금고 초기화 실패"));
    request.onblocked = () => reject(new Error("테스트 금고 연결이 닫히지 않았습니다."));
  });
}

describe("encrypted recent searches unit tests", () => {
  let memoryStorage: MemoryStorage;

  beforeEach(async () => {
    memoryStorage = new MemoryStorage();
    vi.stubGlobal("localStorage", memoryStorage);
    vi.stubGlobal("window", {
      localStorage: memoryStorage,
    });
    await deleteTestDatabase();
  });

  afterEach(async () => {
    memoryStorage.clear();
    vi.unstubAllGlobals();
    await deleteTestDatabase();
  });

  it("stores recent searches encrypted with AES-256-GCM in IndexedDB KEY_STORE", async () => {
    await addRecentSearch("제주도");
    await addRecentSearch("비밀일기");

    // Verify in IndexedDB raw store
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(VAULT_DATABASE_CONTRACT.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      const transaction = database.transaction(KEY_STORE, "readonly");
      const store = transaction.objectStore(KEY_STORE);
      const raw = await new Promise<StoredRecentSearches>((resolve, reject) => {
        const req = store.get(RECENT_SEARCHES_KEY_ID);
        req.onsuccess = () => resolve(req.result as StoredRecentSearches);
        req.onerror = () => reject(req.error);
      });

      expect(raw).toBeDefined();
      expect(raw.cryptoVersion).toBe(1);
      expect(raw.iv.byteLength).toBe(12);
      expect(raw.ciphertext.byteLength).toBeGreaterThan(0);

      // Verify that ciphertext does NOT contain plaintext strings
      const cipherBytes = new Uint8Array(raw.ciphertext);
      const textDecoder = new TextDecoder();
      const rawString = textDecoder.decode(cipherBytes);
      expect(rawString).not.toContain("제주도");
      expect(rawString).not.toContain("비밀일기");

      // Verify localStorage does not contain plaintext
      expect(localStorage.getItem("miroven:recent_searches")).toBeNull();
    } finally {
      database.close();
    }

    // Verify decryption returns the queries in reverse chronological order
    const list = await getRecentSearches();
    expect(list).toEqual(["비밀일기", "제주도"]);
  });

  it("handles deduplication and max limit of 10 items", async () => {
    for (let i = 1; i <= 12; i++) {
      await addRecentSearch(`검색어${i}`);
    }

    const list = await getRecentSearches();
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("검색어12");
    expect(list[9]).toBe("검색어3");
    expect(list).not.toContain("검색어1");
    expect(list).not.toContain("검색어2");

    // Re-adding an existing query moves it to the top
    const updated = await addRecentSearch("검색어5");
    expect(updated[0]).toBe("검색어5");
    expect(updated.filter((q) => q === "검색어5")).toHaveLength(1);
    expect(updated).toHaveLength(10);
  });

  it("removes a specific recent search", async () => {
    await addRecentSearch("첫번째");
    await addRecentSearch("두번째");
    await addRecentSearch("세번째");

    const updated = await removeRecentSearch("두번째");
    expect(updated).toEqual(["세번째", "첫번째"]);

    const reloaded = await getRecentSearches();
    expect(reloaded).toEqual(["세번째", "첫번째"]);
  });

  it("clears all recent searches and removes storage records", async () => {
    await addRecentSearch("검색어A");
    await addRecentSearch("검색어B");

    await clearRecentSearches();

    const list = await getRecentSearches();
    expect(list).toEqual([]);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(VAULT_DATABASE_CONTRACT.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(KEY_STORE, "readonly");
      const record = await new Promise((resolve, reject) => {
        const req = transaction.objectStore(KEY_STORE).get(RECENT_SEARCHES_KEY_ID);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      expect(record).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("automatically migrates legacy localStorage searches and purges plaintext from localStorage", async () => {
    localStorage.setItem(
      "miroven:recent_searches",
      JSON.stringify(["레거시_검색1", "레거시_검색2"]),
    );

    const migrated = await getRecentSearches();
    expect(migrated).toEqual(["레거시_검색1", "레거시_검색2"]);

    // Plaintext in localStorage must be removed
    expect(localStorage.getItem("miroven:recent_searches")).toBeNull();

    // Re-read should come from encrypted IndexedDB
    const reloaded = await getRecentSearches();
    expect(reloaded).toEqual(["레거시_검색1", "레거시_검색2"]);
  });

  it("returns empty array gracefully when vault is locked with PIN and restores on unlock", async () => {
    await addRecentSearch("비공개_검색");
    await setupPinLock("1234");
    await lockDeviceKey();

    expect(await isVaultLocked()).toBe(true);

    // When locked, cannot decrypt -> returns empty list without error
    const lockedList = await getRecentSearches();
    expect(lockedList).toEqual([]);

    // Unlock with PIN
    const unlockSuccess = await unlockVaultWithPin("1234");
    expect(unlockSuccess).toBe(true);
    expect(await isVaultLocked()).toBe(false);

    // Decryption works again
    const unlockedList = await getRecentSearches();
    expect(unlockedList).toEqual(["비공개_검색"]);
  });

  it("ensures recent searches are excluded from encrypted backup export", async () => {
    await saveEntry({
      id: "018f91f0-776b-7c8a-80d8-82455b090099",
      text: "백업 테스트 일기",
      createdAt: "2026-08-11T00:00:00.000Z",
    });
    await createRecoveryKit();
    await addRecentSearch("절대_백업에_들어가면_안되는_검색어");

    const backupExport = await createEncryptedBackup();
    expect(backupExport.json).not.toContain("절대_백업에_들어가면_안되는_검색어");
    expect(backupExport.json).not.toContain("recent-searches");
  });

  it("purges recent searches completely when purgeLocalVaultData is called", async () => {
    await addRecentSearch("삭제될_검색어");
    expect(await getRecentSearches()).toEqual(["삭제될_검색어"]);

    await purgeLocalVaultData();

    expect(await getRecentSearches()).toEqual([]);
    expect(localStorage.getItem("miroven:recent_searches")).toBeNull();
  });
});
