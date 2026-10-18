import type { JournalEntry, JournalImage } from "./vault/types";

export const MAX_JOURNAL_IMAGES = 4;
export type JournalImageMetadata = Omit<JournalImage, "dataUrl">;

/** Legacy records are read without rewriting the encrypted vault. */
export function entryImages<T extends JournalImageMetadata>(entry: { images?: T[]; image?: T }): T[] {
  return entry.images ?? (entry.image ? [entry.image] : []);
}

export function validateEntryImages(entry: Pick<JournalEntry, "images" | "image" | "attachmentVersion">) {
  const images = entryImages(entry);
  if (entry.attachmentVersion !== undefined && entry.attachmentVersion !== 2) {
    throw new Error("지원하지 않는 사진 형식입니다. 앱을 업데이트해 주세요.");
  }
  if (!Array.isArray(images) || images.length > MAX_JOURNAL_IMAGES ||
      (entry.images !== undefined && (!Array.isArray(entry.images) || entry.attachmentVersion !== 2)) ||
      (entry.attachmentVersion === 2 && !Array.isArray(entry.images)) ||
      (entry.images && entry.image)) {
    throw new Error("사진 목록이 올바르지 않습니다.");
  }
  const ids = new Set<string>();
  for (const image of images) {
    if (!image || !Number.isSafeInteger(image.width) || image.width < 1 ||
        !Number.isSafeInteger(image.height) || image.height < 1 ||
        !["image/webp", "image/jpeg", "image/png"].includes(image.mimeType) ||
        typeof image.dataUrl !== "string" || !image.dataUrl.startsWith(`data:${image.mimeType};base64,`)) {
      throw new Error("사진 데이터가 올바르지 않습니다.");
    }
    if (entry.images) {
      if (!image.id || ids.has(image.id)) throw new Error("사진 ID가 올바르지 않습니다.");
      ids.add(image.id);
    }
  }
}
