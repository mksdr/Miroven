import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  journalImageErrorMessage,
  MAX_SOURCE_PHOTO_BYTES,
  MAX_OUTPUT_WEBP_BYTES,
  processJournalImage,
} from "../app/lib/image";
import { decodeHeic } from "../app/lib/heic-decoder";
import { createWebpEncoder } from "../app/lib/webp-encoder";

vi.mock("../app/lib/heic-decoder", () => ({ decodeHeic: vi.fn() }));
vi.mock("../app/lib/webp-encoder", () => ({ createWebpEncoder: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.mocked(decodeHeic).mockReset(); vi.mocked(createWebpEncoder).mockReset(); });

const photo = (type = "image/jpeg", name = "photo.jpg", bytes = 4) =>
  new File([new Uint8Array(bytes)], name, { type });
const webp = (bytes = 100) => new Blob([new Uint8Array(bytes)], { type: "image/webp" });
const fixture = readFileSync(new URL("./fixtures/example.heic", import.meta.url));
const heif = (name = "photo.heic", type = "image/heic") => new File([fixture], name, { type });

function canvasHarness(width = 4000, height = 3000, output: Blob | null = webp()) {
  const close = vi.fn();
  const bitmap = { width, height, close };
  const decode = vi.fn().mockResolvedValue(bitmap);
  vi.stubGlobal("createImageBitmap", decode);
  const drawImage = vi.fn();
  const getImageData = vi.fn().mockReturnValue({ width: 1000, height: 750 });
  const attempts: { width: number; height: number; quality: number }[] = [];
  const encode = vi.fn<() => Blob | null>().mockReturnValue(output);
  const canvases: { width: number; height: number }[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage, getImageData, imageSmoothingEnabled: false, imageSmoothingQuality: "high" }),
        toBlob: (callback: (blob: Blob | null) => void, type: string, quality: number) => {
          expect(type).toBe("image/webp");
          attempts.push({ width: canvas.width, height: canvas.height, quality });
          callback(encode());
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  const preview = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  return { bitmap, close, decode, encode, drawImage, attempts, canvases, preview };
}

describe("photo conversion and output contract", () => {
  it("accepts an original above 2 MiB and emits only the canvas result", async () => {
    const h = canvasHarness();
    const result = await processJournalImage(photo("image/jpeg", "large.jpg", 3 * 1024 * 1024), false);
    expect(result.blob.size).toBe(100);
    expect(result).toMatchObject({ width: 1000, height: 750, mimeType: "image/webp" });
    expect(h.decode).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image" });
    expect(h.drawImage).toHaveBeenCalledWith(h.bitmap, 0, 0, 1000, 750);
    expect(h.close).toHaveBeenCalledOnce();
    expect(createWebpEncoder).not.toHaveBeenCalled();
    expect(h.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it("rejects source bytes above 50 MiB before decoding", async () => {
    const h = canvasHarness();
    const file = photo();
    Object.defineProperty(file, "size", { value: MAX_SOURCE_PHOTO_BYTES + 1 });
    const error = await processJournalImage(file).catch((e) => e);
    expect(error.code).toBe("source-too-large");
    expect(journalImageErrorMessage(error, "en")).toContain("50 MiB");
    expect(h.decode).not.toHaveBeenCalled();
  });

  it("accepts the exact output byte boundary", async () => {
    canvasHarness(1000, 750, webp(MAX_OUTPUT_WEBP_BYTES));
    expect((await processJournalImage(photo(), false)).blob.size).toBe(MAX_OUTPUT_WEBP_BYTES);
  });

  it("reduces quality before dimensions and stops on the first fitting result", async () => {
    const h = canvasHarness();
    // Four attempts at 1000px, then 800px with the initial quality.
    let calls = 0;
    h.encode.mockReset().mockImplementation(() => webp(++calls === 5 ? MAX_OUTPUT_WEBP_BYTES : MAX_OUTPUT_WEBP_BYTES + 1));
    const result = await processJournalImage(photo(), false);
    expect(h.attempts).toEqual([
      { width: 1000, height: 750, quality: 0.82 },
      { width: 1000, height: 750, quality: 0.70 },
      { width: 1000, height: 750, quality: 0.55 },
      { width: 1000, height: 750, quality: 0.40 },
      { width: 800, height: 600, quality: 0.82 },
    ]);
    expect(result.width).toBe(800);
    expect(h.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it("never returns an oversize result when all quality and size attempts fail", async () => {
    const h = canvasHarness(4000, 3000, webp(MAX_OUTPUT_WEBP_BYTES + 1));
    await expect(processJournalImage(photo(), false)).rejects.toMatchObject({ code: "too-large" });
    expect(h.attempts).toHaveLength(16);
    expect(h.attempts.at(-1)).toEqual({ width: 400, height: 300, quality: 0.40 });
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.canvases.every((c) => c.width === 0 && c.height === 0)).toBe(true);
  });

  it.each([
    [3000, 4000, false, 750, 1000],
    [4000, 3000, true, 800, 600],
    [40, 80, false, 40, 80],
    [1, 32000, false, 1, 1000],
  ])("bounds both axes without upscaling (%i x %i)", async (w, h, low, outW, outH) => {
    canvasHarness(w, h);
    expect(await processJournalImage(photo(), low)).toMatchObject({ width: outW, height: outH });
  });

  it("does not repeat identical sizes for a small original", async () => {
    const h = canvasHarness(50, 50, webp(MAX_OUTPUT_WEBP_BYTES + 1));
    await expect(processJournalImage(photo(), false)).rejects.toMatchObject({ code: "too-large" });
    expect(h.attempts).toHaveLength(4);
  });

  it.each([[10000, 6000], [32769, 1], [0, 10], [NaN, 10]])("rejects unusable decoded dimensions (%i x %i)", async (w, h) => {
    const c = canvasHarness(w, h);
    await expect(processJournalImage(photo())).rejects.toThrow();
    expect(c.canvases).toHaveLength(0);
    expect(c.close).toHaveBeenCalledOnce();
  });

  it.each([null, new Blob([])])("rejects empty canvas output and frees resources", async (blob) => {
    const h = canvasHarness(1000, 750, blob);
    await expect(processJournalImage(photo())).rejects.toMatchObject({ code: "processing" });
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it("uses the local encoder when canvas returns PNG and releases its worker", async () => {
    const h = canvasHarness(1000, 750, new Blob(["png"], { type: "image/png" }));
    const encode = vi.fn().mockResolvedValueOnce(webp(MAX_OUTPUT_WEBP_BYTES + 1)).mockResolvedValue(webp(MAX_OUTPUT_WEBP_BYTES));
    const dispose = vi.fn();
    vi.mocked(createWebpEncoder).mockReturnValue({ encode, dispose });
    expect((await processJournalImage(photo(), false)).blob.size).toBe(MAX_OUTPUT_WEBP_BYTES);
    expect(h.encode).toHaveBeenCalledOnce();
    expect(encode.mock.calls.map((call) => call[1])).toEqual([0.82, 0.70]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
  });

  it("reports a local encoder failure without returning PNG and frees resources", async () => {
    const h = canvasHarness(1000, 750, new Blob(["png"], { type: "image/png" }));
    const dispose = vi.fn();
    vi.mocked(createWebpEncoder).mockReturnValue({ encode: vi.fn().mockRejectedValue(new Error("load failed")), dispose });
    const error = await processJournalImage(photo()).catch((e) => e);
    expect(error.code).toBe("encoding");
    expect(journalImageErrorMessage(error, "en")).toContain("try again");
    expect(h.preview).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it("rejects oversized fallback output after the same quality and dimension steps", async () => {
    const h = canvasHarness(4000, 3000, new Blob(["png"], { type: "image/png" }));
    const encode = vi.fn().mockResolvedValue(webp(MAX_OUTPUT_WEBP_BYTES + 1));
    const dispose = vi.fn();
    vi.mocked(createWebpEncoder).mockReturnValue({ encode, dispose });
    await expect(processJournalImage(photo(), false)).rejects.toMatchObject({ code: "too-large" });
    expect(encode).toHaveBeenCalledTimes(16);
    expect(h.encode).toHaveBeenCalledOnce();
    expect(h.drawImage.mock.calls.map((call) => call.slice(3))).toEqual([[1000, 750], [800, 600], [600, 450], [400, 300]]);
    expect(h.preview).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("frees resources when drawing or encoding throws", async () => {
    const h = canvasHarness();
    h.drawImage.mockImplementation(() => { throw new Error("allocation failed"); });
    await expect(processJournalImage(photo())).rejects.toMatchObject({ code: "processing" });
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.canvases[0]).toMatchObject({ width: 0, height: 0 });
  });

  it("classifies damaged JPEG input without loading the HEIF decoder", async () => {
    const h = canvasHarness();
    h.decode.mockRejectedValue(new Error("decode failed"));
    await expect(processJournalImage(photo())).rejects.toMatchObject({ code: "decode" });
    expect(decodeHeic).not.toHaveBeenCalled();
  });

  it("rejects unsupported GIF input", async () => {
    canvasHarness();
    await expect(processJournalImage(photo("image/gif", "anim.gif"))).rejects.toMatchObject({ code: "unsupported" });
  });
});

describe("HEIC and HEIF routing and metadata preflight", () => {
  it.each([["photo.heic", "image/heic"], ["photo.HEIF", ""], ["photo", "application/octet-stream"]])(
    "uses local fallback for %s (%s)", async (name, type) => {
      const h = canvasHarness(1280, 854);
      h.decode.mockRejectedValue(new Error("native HEVC unavailable"));
      vi.mocked(decodeHeic).mockResolvedValue(h.bitmap as ImageBitmap);
      const file = heif(name, type);
      expect((await processJournalImage(file, false)).mimeType).toBe("image/webp");
      expect(decodeHeic).toHaveBeenCalledWith(file);
      expect(h.close).toHaveBeenCalledOnce();
    },
  );

  it("uses native HEIF decoding when available", async () => {
    canvasHarness(1280, 854);
    await processJournalImage(heif());
    expect(decodeHeic).not.toHaveBeenCalled();
  });

  it("fails safely when the fallback cannot decode the codec", async () => {
    const h = canvasHarness();
    h.decode.mockRejectedValue(new Error("native"));
    vi.mocked(decodeHeic).mockRejectedValue(new Error("unsupported codec"));
    await expect(processJournalImage(heif())).rejects.toMatchObject({ code: "decode" });
    expect(h.preview).not.toHaveBeenCalled();
  });

  it("rejects excessive HEIF dimensions before either decoder allocates pixels", async () => {
    const h = canvasHarness();
    const bytes = Buffer.from(fixture);
    const ispe = bytes.indexOf("ispe");
    expect(ispe).toBeGreaterThan(0);
    bytes.writeUInt32BE(60000, ispe + 8);
    bytes.writeUInt32BE(60000, ispe + 12);
    await expect(processJournalImage(new File([bytes], "huge.heic"))).rejects.toMatchObject({ code: "dimensions" });
    expect(h.decode).not.toHaveBeenCalled();
    expect(decodeHeic).not.toHaveBeenCalled();
  });

  it.each(["empty", "truncated", "invalid-size"])("rejects malformed HEIF metadata (%s)", async (kind) => {
    const h = canvasHarness();
    const bytes = kind === "empty" ? Buffer.alloc(0) : Buffer.from(fixture.subarray(0, 128));
    if (kind === "invalid-size") bytes.writeUInt32BE(4, 0);
    await expect(processJournalImage(new File([bytes], "bad.heif"))).rejects.toMatchObject({ code: "decode" });
    expect(h.decode).not.toHaveBeenCalled();
  });
});
