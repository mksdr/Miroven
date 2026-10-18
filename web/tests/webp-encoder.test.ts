import { afterEach, expect, it, vi } from "vitest";
import { createWebpEncoder } from "../app/lib/webp-encoder";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function harness() {
  const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as null | ((event: { data: unknown }) => void), onerror: null as null | (() => void), onmessageerror: null };
  vi.stubGlobal("Worker", class { constructor() { return worker; } });
  const encoder = createWebpEncoder();
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;
  return { worker, encoder, pixels };
}

it("rejects PNG bytes and detaches handlers instead of labeling them WebP", async () => {
  const { worker, encoder, pixels } = harness();
  const result = encoder.encode(pixels, 0.82);
  worker.onmessage!({ data: new TextEncoder().encode("not a WebP container").buffer });
  await expect(result).rejects.toThrow("Invalid WebP output");
  expect(worker.onmessage).toBeNull();
  encoder.dispose();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("settles a worker load failure so the caller can retry with a new worker", async () => {
  const { worker, encoder, pixels } = harness();
  const result = encoder.encode(pixels, 0.82);
  worker.onerror!();
  await expect(result).rejects.toThrow("WebP worker failed");
  encoder.dispose();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it("times out an unresponsive worker and supports disposal while waiting", async () => {
  vi.useFakeTimers();
  const { worker, encoder, pixels } = harness();
  const timeout = expect(encoder.encode(pixels, 0.82)).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(60_000);
  await timeout;
  const cancelled = expect(encoder.encode(pixels, 0.7)).rejects.toThrow("disposed");
  encoder.dispose();
  await cancelled;
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
