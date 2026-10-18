import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJournalReader, deleteEntry, listEntries, saveEntry } from "../app/lib/local-vault";
import { JournalReadCache } from "../app/lib/vault/read-cache";
import type { JournalEntry, StoredEntry } from "../app/lib/vault/types";

const entry = (id: string): JournalEntry => ({ id, text: `본문 ${id}`, createdAt: "2026-09-12T00:00:00Z" });

async function reset() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("private-journal");
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Database still open"));
  });
}

async function mutate(store: string, id: string, change: (value: unknown) => unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("private-journal"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const objectStore = tx.objectStore(store); const req = objectStore.get(id);
      req.onsuccess = () => {
        const value = change(req.result);
        if (objectStore.keyPath) objectStore.put(value); else objectStore.put(value, id);
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

beforeEach(reset);
afterEach(async () => { vi.restoreAllMocks(); await reset(); });

describe("journal read sessions", () => {
  it("reuses unchanged summaries, decrypts only changed records, and removes deleted ones", async () => {
    await saveEntry(entry("a")); await saveEntry(entry("b"));
    const reader = createJournalReader(true);
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    const first = await reader.list();
    expect(decrypt).toHaveBeenCalledTimes(4);
    decrypt.mockClear();
    const unchanged = await reader.list();
    expect(decrypt).not.toHaveBeenCalled();
    expect(unchanged[0]).toBe(first[0]);
    await saveEntry({ ...entry("a"), text: "수정" });
    decrypt.mockClear();
    const changed = await reader.list();
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(changed.find((value) => value.id === "a")?.text).toBe("수정");
    expect(changed.find((value) => value.id === "b")).toBe(first.find((value) => value.id === "b"));
    await deleteEntry("b"); decrypt.mockClear();
    expect(await reader.list()).toHaveLength(1);
    expect(decrypt).not.toHaveBeenCalled();
    expect(reader.cacheStats().summaries.entries).toBe(1);
  });

  it("does not retain photo data in summaries, loads it on demand, and rejects a stale image", async () => {
    const image = { dataUrl: "data:image/webp;base64,AAAA", width: 1, height: 1, mimeType: "image/webp" };
    await saveEntry({ ...entry("photo"), image });
    const reader = createJournalReader(true);
    const [summary] = await reader.list();
    expect(summary.image).toEqual({ width: 1, height: 1, mimeType: "image/webp" });
    expect(JSON.stringify(summary)).not.toContain("data:image");
    expect(reader.cacheStats().images.entries).toBe(0);
    const decrypt = vi.spyOn(crypto.subtle, "decrypt");
    expect(await reader.image(summary)).toEqual(image);
    expect(decrypt).toHaveBeenCalledTimes(2);
    decrypt.mockClear();
    expect(await reader.image(summary)).toEqual(image);
    expect(decrypt).not.toHaveBeenCalled();
    await saveEntry({ ...entry("photo"), image: { ...image, dataUrl: "data:image/webp;base64,BBBB" } });
    await expect(reader.image(summary)).rejects.toThrow("변경");
    reader.clear();
    expect(reader.cacheStats().images.entries).toBe(0);
    expect(reader.cacheStats().summaries.entries).toBe(0);
  });

  it("does not hide ciphertext tampering behind an unchanged IV or revision", async () => {
    await saveEntry(entry("a"));
    const reader = createJournalReader(true); await reader.list();
    await mutate("entries", "a", (value) => {
      const record = value as StoredEntry;
      new Uint8Array(record.ciphertext)[0] ^= 1;
      return record;
    });
    await expect(reader.list()).rejects.toMatchObject({ name: "OperationError" });
  });

  it("does not reuse plaintext after the stored device key changes", async () => {
    await saveEntry(entry("a"));
    const reader = createJournalReader(true); await reader.list();
    const replacement = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    await mutate("device-keys", "primary", () => replacement);
    await expect(reader.list()).rejects.toMatchObject({ name: "OperationError" });
  });

  it("clearing while decryption is pending prevents cache repopulation", async () => {
    await saveEntry(entry("a"));
    const reader = createJournalReader(true);
    const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...args) => { await gate; return decrypt(...args); });
    const pending = reader.list();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    reader.clear(); release(); await rejected;
    expect(reader.cacheStats().summaries.entries).toBe(0);
    expect(await listEntries()).toHaveLength(1);
  });
});

describe("cache budgets", () => {
  it("evicts images by count and byte budget and applies stricter limits immediately", async () => {
    const cache = new JournalReadCache(false);
    const record = (id: string): StoredEntry => ({ id, iv: new ArrayBuffer(12), ciphertext: new ArrayBuffer(16), cryptoVersion: 1, syncState: "local" });
    const context = {
      keyIdentity: "test", check: () => {},
      decrypt: async (value: StoredEntry) => ({ ...entry(value.id), image: { dataUrl: "x".repeat(600_000), width: 1, height: 1, mimeType: "image/webp" } }),
    };
    for (let i = 0; i < 20; i++) {
      const r = record(String(i));
      await cache.image(r, await cache.summary(r, context), context);
    }
    expect(cache.stats().images.entries).toBe(20);
    cache.configure(true);
    expect(cache.stats().images.entries).toBeLessThanOrEqual(8);
    expect(cache.stats().images.estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    const large = { ...context, decrypt: async (value: StoredEntry) => ({ ...entry(value.id), text: "x".repeat(3_000_000) }) };
    await cache.summary(record("large-1"), large);
    await cache.summary(record("large-2"), large);
    expect(cache.stats().summaries.estimatedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(cache.stats().summaries.entries).toBe(1);
  });
});
