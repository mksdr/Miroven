import { isLowSpecDevice } from "./performance-policy";
export { isLowSpecDevice } from "./performance-policy";
export type ProcessedImage = {
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  mimeType: "image/webp";
};

export type JournalImageErrorCode =
  | "source-too-large"
  | "too-large"
  | "dimensions"
  | "unsupported"
  | "decode"
  | "encoding"
  | "processing";

export class JournalImageError extends Error {
  constructor(readonly code: JournalImageErrorCode) {
    super(IMAGE_ERROR_MESSAGES.ko[code]);
    this.name = "JournalImageError";
  }
}

const IMAGE_ERROR_MESSAGES = {
  ko: {
    "source-too-large": "원본 사진은 50 MiB 이하로 선택해 주세요.",
    "too-large": "사진을 2,000,000 bytes 이하로 줄이지 못했습니다. 더 작은 사진을 선택해 주세요.",
    dimensions: "사진 해상도가 너무 큽니다. 5천만 화소 이하의 더 작은 사진을 선택해 주세요.",
    unsupported: "JPEG, PNG, WebP, HEIC, HEIF 사진만 첨부할 수 있습니다.",
    decode: "사진 파일을 읽을 수 없습니다. 손상된 파일이거나 지원되지 않는 인코딩일 수 있습니다.",
    encoding: "사진 변환 기능을 불러오거나 실행하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    processing: "사진을 변환하지 못했습니다. 기기 메모리를 확보하거나 더 작은 사진을 선택해 주세요.",
  },
  en: {
    "source-too-large": "Choose an original photo of 50 MiB or smaller.",
    "too-large": "The photo could not be reduced to 2,000,000 bytes. Choose a smaller photo.",
    dimensions: "The photo resolution is too large. Choose a smaller photo of at most 50 megapixels.",
    unsupported: "Only JPEG, PNG, WebP, HEIC, and HEIF photos can be attached.",
    decode: "The photo could not be read. It may be damaged or use an unsupported encoding.",
    encoding: "Could not load or run photo conversion. Check your internet connection and try again.",
    processing: "The photo could not be converted. Free some device memory or choose a smaller photo.",
  },
} as const;

export function journalImageErrorMessage(error: unknown, language: "ko" | "en"): string {
  if (error instanceof JournalImageError) return IMAGE_ERROR_MESSAGES[language][error.code];
  return language === "ko"
    ? "사진을 처리하지 못했습니다. 다른 사진을 선택해 주세요."
    : "The photo could not be processed. Choose a different photo.";
}

export const MAX_SOURCE_PHOTO_BYTES = 50 * 1024 * 1024;
export const MAX_SOURCE_PIXELS = 50_000_000;
export const MAX_OUTPUT_WEBP_BYTES = 2_000_000;
export const JOURNAL_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
const QUALITY_STEPS = [0.82, 0.70, 0.55, 0.40];
const EDGE_STEPS = [1000, 800, 600, 400];
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIF_TYPES = new Set(["image/heic", "image/heif"]);
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

export function assertImageDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new JournalImageError("decode");
  }
  if (width * height > MAX_SOURCE_PIXELS || Math.max(width, height) > 32_768) {
    throw new JournalImageError("dimensions");
  }
}

async function isHeif(file: File): Promise<boolean> {
  if (HEIF_TYPES.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name)) return true;
  // File pickers can leave MIME and extension empty. Inspect the ftyp brands.
  const header = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const fourcc = (offset: number) => String.fromCharCode(...header.subarray(offset, offset + 4));
  if (fourcc(4) !== "ftyp" || header.length < 16) return false;
  const end = Math.min(new DataView(header.buffer).getUint32(0), header.length);
  const brands = [fourcc(8)];
  for (let offset = 16; offset + 4 <= end; offset += 4) brands.push(fourcc(offset));
  return !brands.some((brand) => brand === "avif" || brand === "avis") && brands.some((brand) => HEIF_BRANDS.has(brand));
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || !blob.size) return reject(new JournalImageError("processing"));
      // Unsupported canvas encoders silently return PNG. Never label that as WebP.
      if (blob.type !== "image/webp") return reject(new JournalImageError("encoding"));
      resolve(blob);
    }, "image/webp", quality);
  });
}


export async function processJournalImage(file: File, forceLowSpec?: boolean): Promise<ProcessedImage> {
  if (file.size > MAX_SOURCE_PHOTO_BYTES) throw new JournalImageError("source-too-large");
  const heif = await isHeif(file);
  if (!heif && !ALLOWED_TYPES.has(file.type.toLowerCase())) throw new JournalImageError("unsupported");
  if (heif) {
    const { checkHeifDimensions } = await import("./heif-dimensions");
    await checkHeifDimensions(file);
  }

  const low = forceLowSpec ?? isLowSpecDevice();
  const edges = low ? EDGE_STEPS.slice(1) : EDGE_STEPS;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (!heif) throw new JournalImageError("decode");
    try {
      const { decodeHeic } = await import("./heic-decoder");
      bitmap = await decodeHeic(file);
    } catch {
      throw new JournalImageError("decode");
    }
  }

  let fallback: import("./webp-encoder").WebpEncoder | undefined;
  try {
    assertImageDimensions(bitmap.width, bitmap.height);
    let lastEdge = -1;
    for (const maxEdge of edges) {
      const edge = Math.min(Math.max(bitmap.width, bitmap.height), maxEdge);
      if (edge === lastEdge) continue;
      lastEdge = edge;
      const scale = edge / Math.max(bitmap.width, bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      try {
        const context = canvas.getContext("2d");
        if (!context) throw new JournalImageError("processing");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = low ? "medium" : "high";
        context.drawImage(bitmap, 0, 0, width, height);
        for (const quality of QUALITY_STEPS) {
          let blob: Blob | undefined;
          try {
            if (!fallback) {
              try {
                blob = await canvasToBlob(canvas, quality);
              } catch (error) {
                if (!(error instanceof JournalImageError) || error.code !== "encoding") throw error;
                const { createWebpEncoder } = await import("./webp-encoder");
                fallback = createWebpEncoder();
              }
            }
            if (fallback) blob = await fallback.encode(context.getImageData(0, 0, width, height), quality);
          } catch (error) {
            if (error instanceof JournalImageError) throw error;
            throw new JournalImageError("encoding");
          }
          if (!blob?.size || blob.type !== "image/webp") throw new JournalImageError("encoding");
          if (blob.size <= MAX_OUTPUT_WEBP_BYTES) {
            return { blob, previewUrl: URL.createObjectURL(blob), width, height, mimeType: "image/webp" };
          }
        }
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    throw new JournalImageError("too-large");
  } catch (error) {
    if (error instanceof JournalImageError) throw error;
    throw new JournalImageError("processing");
  } finally {
    fallback?.dispose();
    bitmap.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("사진 읽기 실패"));
    reader.readAsDataURL(blob);
  });
}
