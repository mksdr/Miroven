// Loaded only when the browser cannot decode a HEIC/HEIF image itself.
export async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  const { heicTo } = await import("heic-to/csp");
  return heicTo({ blob: file, type: "bitmap" });
}
