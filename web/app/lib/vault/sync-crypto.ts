import { validatePersonaDocument } from "../persona";
import { validateEntryQuote } from "../entry-quotes";
import { entryImages, validateEntryImages } from "../journal-images";
import type {
  CloudEntryPayload,
  EncryptedBlobEnvelope,
  EncryptedSyncEnvelope,
  JournalEntry,
  JournalImage,
  RemoteSyncChange,
  StoredEntry,
  SyncOperation,
} from "./types";
import { toArrayBuffer } from "./codec";
import {
  bytesToDataUrl,
  dataUrlToBytes,
  encryptEntry,
} from "./entry-crypto";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function syncAdditionalData(kind: "entry" | "blob", id: string, revision: number) {
  return toArrayBuffer(
    textEncoder.encode(`private-journal:sync:${kind}:${id}:r${revision}:v1`),
  );
}

export function syncDataKeyAdditionalData(kind: "entry" | "blob", id: string) {
  return toArrayBuffer(
    textEncoder.encode(`private-journal:sync:${kind}:data-key:${id}:v1`),
  );
}

export async function encryptSyncBytes(
  vaultKey: CryptoKey,
  kind: "entry" | "blob",
  id: string,
  revision: number,
  plaintext: ArrayBuffer,
): Promise<EncryptedSyncEnvelope> {
  const rawDataKey = crypto.getRandomValues(new Uint8Array(32));
  const dataKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawDataKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const contentNonce = crypto.getRandomValues(new Uint8Array(12));
  const keyNonce = crypto.getRandomValues(new Uint8Array(12));
  try {
    const [ciphertext, wrappedDataKey] = await Promise.all([
      crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: contentNonce,
          additionalData: syncAdditionalData(kind, id, revision),
        },
        dataKey,
        plaintext,
      ),
      crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: keyNonce,
          additionalData: syncDataKeyAdditionalData(kind, id),
        },
        vaultKey,
        toArrayBuffer(rawDataKey),
      ),
    ]);
    return {
      ciphertext,
      contentNonce: toArrayBuffer(contentNonce),
      wrappedDataKey,
      keyNonce: toArrayBuffer(keyNonce),
      cryptoVersion: 1,
    };
  } finally {
    rawDataKey.fill(0);
  }
}

export async function decryptSyncBytes(
  vaultKey: CryptoKey,
  kind: "entry" | "blob",
  id: string,
  revision: number,
  envelope: EncryptedSyncEnvelope,
): Promise<ArrayBuffer> {
  if (envelope.cryptoVersion !== 1) {
    throw new Error("지원하지 않는 동기화 암호문 버전입니다.");
  }
  const rawDataKey = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: envelope.keyNonce,
      additionalData: syncDataKeyAdditionalData(kind, id),
    },
    vaultKey,
    envelope.wrappedDataKey,
  );
  try {
    const dataKey = await crypto.subtle.importKey(
      "raw",
      rawDataKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    return crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: envelope.contentNonce,
        additionalData: syncAdditionalData(kind, id, revision),
      },
      dataKey,
      envelope.ciphertext,
    );
  } finally {
    new Uint8Array(rawDataKey).fill(0);
  }
}

export function createDeleteOperation(
  entryId: string,
  revision: number,
  baseRevision: number,
): SyncOperation {
  return {
    operationId: crypto.randomUUID(),
    entryId,
    baseRevision,
    revision,
    changeType: "delete",
    attachmentVersion: 2,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
}

export async function createUpsertOperation(
  vaultKey: CryptoKey,
  entry: JournalEntry,
  revision = 1,
  baseRevision = 0,
): Promise<SyncOperation> {
  validatePersonaDocument(entry);
  validateEntryImages(entry);
  validateEntryQuote(entry);
  if (entry.images !== undefined) {
    const images = entryImages(entry);
    const cloudImages: NonNullable<CloudEntryPayload["images"]> = [];
    const blobs: EncryptedBlobEnvelope[] = [];
    for (const image of images) {
      const blobId = crypto.randomUUID();
      cloudImages.push({
        id: image.id,
        blobId,
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
      });
      blobs.push({
        id: blobId,
        ...(await encryptSyncBytes(
          vaultKey,
          "blob",
          blobId,
          revision,
          dataUrlToBytes(image.dataUrl),
        )),
      });
    }
    const cloudEntry: CloudEntryPayload = {
      id: entry.id,
      text: entry.text,
      createdAt: entry.createdAt,
      ...(entry.pinnedAt ? { pinnedAt: entry.pinnedAt } : {}),
      ...(entry.quotedEntryId ? { quotedEntryId: entry.quotedEntryId } : {}),
      attachmentVersion: 2,
      images: cloudImages,
    };
    const payload = await encryptSyncBytes(
      vaultKey,
      "entry",
      entry.id,
      revision,
      toArrayBuffer(textEncoder.encode(JSON.stringify(cloudEntry))),
    );
    return {
      operationId: crypto.randomUUID(),
      entryId: entry.id,
      baseRevision,
      revision,
      changeType: "upsert",
      payload,
      blobs,
      attachmentVersion: 2,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
  }
  const blobId = entry.image ? crypto.randomUUID() : undefined;
  const cloudEntry: CloudEntryPayload = {
    id: entry.id,
    text: entry.text,
    createdAt: entry.createdAt,
    ...(entry.pinnedAt ? { pinnedAt: entry.pinnedAt } : {}),
    ...(entry.quotedEntryId ? { quotedEntryId: entry.quotedEntryId } : {}),
    ...(entry.image && blobId
      ? {
          image: {
            blobId,
            width: entry.image.width,
            height: entry.image.height,
            mimeType: entry.image.mimeType,
          },
        }
      : {}),
  };
  const payload = await encryptSyncBytes(
    vaultKey,
    "entry",
    entry.id,
    revision,
    toArrayBuffer(textEncoder.encode(JSON.stringify(cloudEntry))),
  );
  const blob =
    entry.image && blobId
      ? {
          id: blobId,
          ...(await encryptSyncBytes(
            vaultKey,
            "blob",
            blobId,
            revision,
            dataUrlToBytes(entry.image.dataUrl),
          )),
        }
      : undefined;
  return {
    operationId: crypto.randomUUID(),
    entryId: entry.id,
    baseRevision,
    revision,
    changeType: "upsert",
    payload,
    blob,
    attachmentVersion: 2,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
}

export async function prepareRemoteRecord(
  vaultKey: CryptoKey,
  change: RemoteSyncChange,
  encryptedBlob?: EncryptedBlobEnvelope | EncryptedBlobEnvelope[],
): Promise<StoredEntry | null> {
  let nextEntry: JournalEntry | null = null;
  if (change.changeType === "upsert") {
    if (!change.payload) throw new Error("원격 기록의 암호문이 없습니다.");
    const plaintext = await decryptSyncBytes(
      vaultKey,
      "entry",
      change.entryId,
      change.revision,
      change.payload,
    );
    const cloudEntry = JSON.parse(
      textDecoder.decode(plaintext),
    ) as CloudEntryPayload;
    if (cloudEntry.id !== change.entryId) {
      throw new Error("원격 기록 ID가 암호문과 일치하지 않습니다.");
    }
    validatePersonaDocument(cloudEntry);
    validateEntryQuote(cloudEntry);
    const encryptedBlobs = Array.isArray(encryptedBlob)
      ? encryptedBlob
      : encryptedBlob
        ? [encryptedBlob]
        : [];
    const cloudImages =
      cloudEntry.images ?? (cloudEntry.image ? [cloudEntry.image] : []);
    if (
      !Array.isArray(cloudImages) ||
      cloudImages.length > 4 ||
      (cloudEntry.images && cloudEntry.image) ||
      (cloudEntry.images !== undefined &&
        (!Array.isArray(cloudEntry.images) ||
          cloudEntry.attachmentVersion !== 2)) ||
      (cloudEntry.attachmentVersion === 2 &&
        !Array.isArray(cloudEntry.images)) ||
      (cloudEntry.attachmentVersion !== undefined &&
        cloudEntry.attachmentVersion !== 2) ||
      new Set(cloudImages.map((image) => image.blobId)).size !==
        cloudImages.length
    ) {
      throw new Error("원격 사진 목록이 올바르지 않습니다.");
    }
    if (encryptedBlobs.length < cloudImages.length) {
      throw new Error("원격 사진 암호문이 없습니다.");
    }
    if (encryptedBlobs.length > cloudImages.length) {
      throw new Error("불필요한 원격 사진입니다.");
    }
    const images: JournalImage[] = [];
    for (const metadata of cloudImages) {
      const blob = encryptedBlobs.find((item) => item.id === metadata.blobId);
      if (!blob) throw new Error("원격 사진 암호문이 없습니다.");
      const bytes = await decryptSyncBytes(
        vaultKey,
        "blob",
        blob.id,
        change.revision,
        blob,
      );
      images.push({
        id: metadata.id,
        dataUrl: bytesToDataUrl(bytes, metadata.mimeType),
        width: metadata.width,
        height: metadata.height,
        mimeType: metadata.mimeType,
      });
    }
    /* Legacy envelopes remain readable without changing their crypto/AAD. */
    let image: JournalImage | undefined;
    if (cloudEntry.image) {
      image = images[0];
    }
    nextEntry = {
      id: cloudEntry.id,
      text: cloudEntry.text,
      createdAt: cloudEntry.createdAt,
      ...(cloudEntry.pinnedAt ? { pinnedAt: cloudEntry.pinnedAt } : {}),
      ...(cloudEntry.quotedEntryId
        ? { quotedEntryId: cloudEntry.quotedEntryId }
        : {}),
      ...(image ? { image } : {}),
      ...(cloudEntry.images ? { images, attachmentVersion: 2 as const } : {}),
    };
  }

  const storedRemoteEntry = nextEntry
    ? await encryptEntry(vaultKey, nextEntry, 3)
    : null;
  if (storedRemoteEntry) {
    storedRemoteEntry.revision = change.revision;
    storedRemoteEntry.syncState = "synced";
  }
  return storedRemoteEntry;
}
