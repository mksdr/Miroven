export type WebpEncoder = {
  encode(pixels: ImageData, quality: number): Promise<Blob>;
  dispose(): void;
};

// One worker per conversion: keeps encoding off the UI thread and releases the
// WASM heap on both success and failure. Only resized pixels reach the worker.
export function createWebpEncoder(): WebpEncoder {
  const worker = new Worker(new URL("./webp-encoder.worker.ts", import.meta.url), { type: "module" });
  let pending: ((reason: Error) => void) | undefined;
  return {
    encode(pixels, quality) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(new Error("WebP encoding timed out")), 60_000);
        const cleanup = () => {
          clearTimeout(timer);
          pending = undefined;
          worker.onmessage = null;
          worker.onerror = null;
          worker.onmessageerror = null;
        };
        const fail = (error: Error) => { cleanup(); reject(error); };
        pending = fail;
        worker.onerror = () => fail(new Error("WebP worker failed"));
        worker.onmessageerror = () => fail(new Error("Invalid WebP worker response"));
        worker.onmessage = (event: MessageEvent<ArrayBuffer | null>) => {
          const bytes = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null;
          // Check the container before assigning a MIME type; never relabel PNG.
          if (!bytes || bytes.length < 20 ||
              String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" ||
              String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") {
            fail(new Error("Invalid WebP output"));
            return;
          }
          cleanup();
          resolve(new Blob([event.data!], { type: "image/webp" }));
        };
        try {
          worker.postMessage({ pixels, quality }, [pixels.data.buffer]);
        } catch {
          fail(new Error("Could not send pixels to WebP worker"));
        }
      });
    },
    dispose() {
      pending?.(new Error("WebP encoder disposed"));
      worker.terminate();
    },
  };
}
