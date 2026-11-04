import type { Page } from "@playwright/test";
import { encryptEntry } from "../../app/lib/vault/entry-crypto";
import { VAULT_DATABASE_CONTRACT as DB, VAULT_FORMAT_CONTRACT as FORMAT } from "../../app/lib/vault/contracts";

export const DRAFT_TEXT = "Synthetic restored draft";

/** Only call in a new disposable browser context. Nothing is written to an existing user profile. */
export async function seedVault(page: Page, count: number, photos: boolean) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
  // A reproducible 1x1 PNG; every twentieth record has a photo. Text length is fixed.
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
  const records = [];
  for (let index = 0; index < count; index++) {
    const record = await encryptEntry(key, {
      id: `benchmark-${index.toString().padStart(5, "0")}`,
      text: `Synthetic journal ${index} ` + "A repeatable journal sentence. ".repeat(30),
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      images: photos && index % 20 === 0 ? [{ id: `photo-${index}`, dataUrl, width: 1, height: 1, mimeType: "image/png" }] : [],
      attachmentVersion: 2,
    });
    records.push({ ...record, iv: Array.from(new Uint8Array(record.iv)),
      ciphertext: Array.from(new Uint8Array(record.ciphertext)),
      wrappedDataKey: Array.from(new Uint8Array(record.wrappedDataKey!)),
      keyNonce: Array.from(new Uint8Array(record.keyNonce!)) });
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
    additionalData: new TextEncoder().encode(FORMAT.draftAad) }, key,
  new TextEncoder().encode(JSON.stringify({ text: DRAFT_TEXT, updatedAt: "2026-01-01T00:00:00.000Z" })));
  await page.evaluate(async ({ records, rawKey, draft, DB }) => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(rawKey), { name: "AES-GCM" }, true,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB.name, DB.version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction([DB.stores.entries, DB.stores.deviceKeys], "readwrite");
        const entries = tx.objectStore(DB.stores.entries);
        entries.clear();
        for (const record of records) entries.put({ ...record,
          iv: new Uint8Array(record.iv).buffer, ciphertext: new Uint8Array(record.ciphertext).buffer,
          wrappedDataKey: new Uint8Array(record.wrappedDataKey).buffer,
          keyNonce: new Uint8Array(record.keyNonce).buffer });
        const keys = tx.objectStore(DB.stores.deviceKeys);
        keys.put(key, DB.keys.device);
        keys.put({ cryptoVersion: 1, iv: new Uint8Array(draft.iv).buffer,
          ciphertext: new Uint8Array(draft.ciphertext).buffer }, DB.keys.draft);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally { database.close(); }
    localStorage.setItem("miroven:onboarding:v1", "done");
  }, { records, rawKey: Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", key))),
    draft: { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ciphertext)) }, DB });
}
