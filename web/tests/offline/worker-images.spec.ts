import { expect, test } from "@playwright/test";

test("encodes WebP with a cached Worker after Service Worker activation and reload", async ({ page }) => {
  const errors: string[] = [];
  const workerResponses: boolean[] = [];
  const uploads: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (request.method() !== "GET") uploads.push(request.url()); });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.includes("/turbopack-worker-")) {
      workerResponses.push(response.fromServiceWorker());
    }
  });
  await page.addInitScript(() => {
    // Safari can display WebP while Canvas returns PNG. Force its real WASM path
    // on every platform; retain the output Blob without a CSP-blocked blob fetch.
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      return original.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
    };
    const blobs = new Map<string, Blob>();
    (window as Window & { photoTestBlobs?: Map<string, Blob> }).photoTestBlobs = blobs;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (blob instanceof Blob) blobs.set(url, blob);
      return url;
    };
  });
  await page.goto("/");
  await expect(page.locator("#composer textarea")).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.reload();
  await expect(page.locator("#composer textarea")).toBeEnabled();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 24;
    canvas.getContext("2d")!.fillRect(0, 0, 32, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('.photo-button input[type="file"]').setInputFiles({
    name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from(png, "base64"),
  });
  const preview = page.locator(".image-preview img");
  await expect(preview).toBeVisible({ timeout: 30_000 });
  const output = await preview.evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const blob = (window as Window & { photoTestBlobs?: Map<string, Blob> }).photoTestBlobs!.get(image.src)!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { type: blob.type, size: blob.size, riff: String.fromCharCode(...bytes.subarray(0, 4)),
      format: String.fromCharCode(...bytes.subarray(8, 12)), width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(output).toMatchObject({ type: "image/webp", riff: "RIFF", format: "WEBP", width: 32, height: 24 });
  expect(output.size).toBeGreaterThan(0);
  expect(output.size).toBeLessThanOrEqual(2_000_000);
  expect(workerResponses.length).toBeGreaterThan(0);
  expect(workerResponses.every(Boolean)).toBe(true);
  expect(errors).toEqual([]);
  expect(uploads).toEqual([]);
});
