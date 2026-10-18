import { validatePersonaDocument } from "../persona";
import { bufferToBase64, toArrayBuffer } from "./codec";
import type { JournalEntry, StoredEntry } from "./types";
import { validateEntryImages } from "../journal-images";
import { validateEntryQuote } from "../entry-quotes";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeEntry(entry: JournalEntry): ArrayBuffer {
  validatePersonaDocument(entry);
  validateEntryImages(entry);
  validateEntryQuote(entry);
  return toArrayBuffer(textEncoder.encode(JSON.stringify(entry)));
}

export function decodeEntry(buffer: ArrayBuffer): JournalEntry {
  const entry = JSON.parse(textDecoder.decode(buffer)) as JournalEntry;
  validatePersonaDocument(entry);
  validateEntryImages(entry);
  validateEntryQuote(entry);
  return entry;
}

export function entryAdditionalData(
  id: string,
  cryptoVersion: 1 | 2 | 3,
): ArrayBuffer | undefined {
  if (cryptoVersion === 1) return undefined;
  return toArrayBuffer(
    textEncoder.encode(`private-journal:entry:${id}:v${cryptoVersion}`),
  );
}

export function dataKeyAdditionalData(id: string): ArrayBuffer {
  return toArrayBuffer(
    textEncoder.encode(`private-journal:data-key:${id}:v3`),
  );
}

export async function encryptEntry(
  vaultKey: CryptoKey,
  entry: JournalEntry,
  cryptoVersion: 1 | 2 | 3 = 3,
): Promise<StoredEntry> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = entryAdditionalData(entry.id, cryptoVersion);
  if (cryptoVersion === 3) {
    const rawDataKey = crypto.getRandomValues(new Uint8Array(32));
    const dataKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(rawDataKey),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const keyNonce = crypto.getRandomValues(new Uint8Array(12));
    const [ciphertext, wrappedDataKey] = await Promise.all([
      crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData },
        dataKey,
        encodeEntry(entry),
      ),
      crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: keyNonce,
          additionalData: dataKeyAdditionalData(entry.id),
        },
        vaultKey,
        toArrayBuffer(rawDataKey),
      ),
    ]);
    rawDataKey.fill(0);
    return {
      id: entry.id,
      iv: toArrayBuffer(iv),
      ciphertext,
      wrappedDataKey,
      keyNonce: toArrayBuffer(keyNonce),
      cryptoVersion,
      syncState: "local",
    };
  }
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      ...(additionalData ? { additionalData } : {}),
    },
    vaultKey,
    encodeEntry(entry),
  );
  return {
    id: entry.id,
    iv: toArrayBuffer(iv),
    ciphertext,
    cryptoVersion,
    syncState: "local",
  };
}

export async function decryptEntry(key: CryptoKey, record: StoredEntry): Promise<JournalEntry> {
  const additionalData = entryAdditionalData(record.id, record.cryptoVersion);
  let contentKey = key;
  if (record.cryptoVersion === 3) {
    if (!record.wrappedDataKey || !record.keyNonce) {
      throw new Error("암호화된 기록의 데이터 키가 없습니다.");
    }
    const rawDataKey = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: record.keyNonce,
        additionalData: dataKeyAdditionalData(record.id),
      },
      key,
      record.wrappedDataKey,
    );
    contentKey = await crypto.subtle.importKey(
      "raw",
      rawDataKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    new Uint8Array(rawDataKey).fill(0);
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: record.iv,
      ...(additionalData ? { additionalData } : {}),
    },
    contentKey,
    record.ciphertext,
  );
  return decodeEntry(plaintext);
}

export function dataUrlToBytes(dataUrl: string): ArrayBuffer {
  const separator = dataUrl.indexOf(",");
  if (separator < 0 || !dataUrl.slice(0, separator).includes(";base64")) {
    throw new Error("사진 데이터 형식을 읽을 수 없습니다.");
  }
  const binary = atob(dataUrl.slice(separator + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export const ALLOWED_IMAGE_MIME = new Set(["image/webp", "image/jpeg", "image/png"]);

export function bytesToDataUrl(bytes: ArrayBuffer, mimeType: string): string {
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new Error("허용되지 않은 이미지 형식입니다.");
  }
  return `data:${mimeType};base64,${bufferToBase64(bytes)}`;
}
