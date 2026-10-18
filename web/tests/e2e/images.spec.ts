import { expect, test, type Page } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../out/", import.meta.url));
const fixture = readFileSync(new URL("../fixtures/example.heic", import.meta.url));
const appUrl = "/";

test.beforeEach(async ({ page }) => {
  // Inspect the original output Blob without a fetch(blob:) request, which the
  // production connect-src policy intentionally does not allow.
  await page.addInitScript(() => {
    const blobs = new Map<string, Blob>();
    (window as Window & { photoTestBlobs?: Map<string, Blob> }).photoTestBlobs = blobs;
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = create(value);
      if (value instanceof Blob) blobs.set(url, value);
      return url;
    };
  });
});

async function inspectPreview(page: Page) {
  const preview = page.locator(".image-preview img");
  await expect(preview).toBeVisible({ timeout: 30000 });
  return preview.evaluate(async (element) => {
    const image = element as HTMLImageElement;
    await image.decode();
    const blob = (window as Window & { photoTestBlobs?: Map<string, Blob> }).photoTestBlobs!.get(image.src)!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = (offset: number, size: number) => String.fromCharCode(...bytes.subarray(offset, offset + size));
    const chunks: string[] = [];
    const view = new DataView(bytes.buffer);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      chunks.push(text(offset, 4));
      const size = view.getUint32(offset + 4, true);
      offset += 8 + size + (size % 2);
    }
    return { size: blob.size, type: blob.type, riff: text(0, 4), format: text(8, 4), width: image.naturalWidth, height: image.naturalHeight, chunks };
  });
}

function assertOutput(output: Awaited<ReturnType<typeof inspectPreview>>) {
  expect(output.size).toBeGreaterThan(0);
  expect(output.size).toBeLessThanOrEqual(2_000_000);
  expect(output.type).toBe("image/webp");
  expect(output.riff).toBe("RIFF");
  expect(output.format).toBe("WEBP");
  expect(Math.max(output.width, output.height)).toBeLessThanOrEqual(1000);
  expect(output.chunks).not.toContain("EXIF");
  expect(output.chunks).not.toContain("XMP ");
}

for (const forceFallback of [false, true]) {
  test(`converts a real PNG above 2 MiB and persists the WebP after reload (fallback=${forceFallback})`, async ({ page }) => {
    // Exercise a short mobile viewport where the Safari notice and recovery
    // panel can push the saved photo below the fold.
    await page.setViewportSize({ width: 393, height: 641 });
    const violations: string[] = [];
    const uploads: string[] = [];
    page.on("console", (message) => { if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()); });
    page.on("request", (request) => { if (request.method() !== "GET") uploads.push(request.url()); });
    if (forceFallback) await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return original.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
      };
    });
    await page.goto(appUrl);
    await expect(page.getByText("내 저널", { exact: true })).toBeVisible();
    const data = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1200; canvas.height = 900;
      const context = canvas.getContext("2d")!;
      const pixels = context.createImageData(canvas.width, canvas.height);
      let seed = 123456789;
      for (let i = 0; i < pixels.data.length; i += 4) {
        for (let c = 0; c < 3; c++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels.data[i + c] = seed >>> 24; }
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const buffer = Buffer.from(data, "base64");
    expect(buffer.length).toBeGreaterThan(2 * 1024 * 1024);
    await page.locator('.photo-button input[type="file"]').setInputFiles({ name: "large.png", mimeType: "image/png", buffer });
    assertOutput(await inspectPreview(page));
    await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill("큰 원본 사진 저장 검증");
    await page.getByRole("button", { name: "기록", exact: true }).click();
    await expect(page.locator(".entry-image-shell")).toBeAttached();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    // Offscreen photos intentionally have no <img> until their shell enters
    // the viewport. Scroll the always-mounted shell, not the deferred image.
    await page.locator(".entry-image-shell").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(page.locator(".entry-image-shell")).toBeInViewport();
    await expect(page.locator(".entry-image")).toBeVisible();
    await page.locator(".entry-image").evaluate((image: HTMLImageElement) => image.decode());
    await page.reload();
    await page.locator(".entry-image-shell").evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(page.locator(".entry-image-shell")).toBeInViewport();
    await expect(page.locator(".entry-image")).toBeVisible();
    await page.locator(".entry-image").evaluate((image: HTMLImageElement) => image.decode());
    expect(await page.locator(".entry-image").getAttribute("src")).toMatch(/^data:image\/webp;base64,/);
    expect(violations).toEqual([]);
    expect(uploads).toEqual([]);
  });
}

for (const [name, mimeType, padded] of [["example.heic", "image/heic", false], ["example.HEIF", "", true]] as const) {
  test(`converts real ${name} under the production CSP without uploading photos`, async ({ page }) => {
    const violations: string[] = [];
    const uploads: string[] = [];
    page.on("console", (message) => { if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()); });
    page.on("request", (request) => { if (request.method() !== "GET") uploads.push(request.url()); });
    await page.goto(appUrl);
    let buffer = fixture;
    if (padded) {
      // A legal ISO BMFF free box makes a real HEIF source exceed the old limit.
      const free = Buffer.alloc(3 * 1024 * 1024);
      free.writeUInt32BE(free.length, 0); free.write("free", 4);
      buffer = Buffer.concat([fixture, free]);
      expect(buffer.length).toBeGreaterThan(2 * 1024 * 1024);
    }
    const input = page.locator('.photo-button input[type="file"]');
    await input.setInputFiles({ name, mimeType, buffer });
    assertOutput(await inspectPreview(page));
    await expect(input).toBeEnabled();
    expect(violations).toEqual([]);
    expect(uploads).toEqual([]);
  });
}

test("rejects a damaged HEIF and allows another selection", async ({ page }) => {
  await page.goto(appUrl);
  const input = page.locator('.photo-button input[type="file"]');
  await input.setInputFiles({ name: "damaged.heif", mimeType: "image/heif", buffer: Buffer.from("damaged") });
  await expect(page.getByText(/사진 파일을 읽을 수 없습니다/)).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(page.locator(".image-preview")).toHaveCount(0);
});

test("four-photo grid supports limits, viewing, editing, replacement and cancellation", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 800 });
  await page.goto(appUrl);
  const files = (await page.evaluate(() => ["red", "green", "blue", "yellow", "purple"].map((color) => {
    const canvas = document.createElement("canvas");
    canvas.width = 32; canvas.height = 24;
    const context = canvas.getContext("2d")!;
    context.fillStyle = color; context.fillRect(0, 0, 32, 24);
    return canvas.toDataURL("image/png").split(",")[1];
  }))).map((data, index) => ({ name: `photo-${index}.png`, mimeType: "image/png", buffer: Buffer.from(data, "base64") }));
  const input = page.locator('.photo-button input[type="file"]');
  await input.setInputFiles(files);
  await expect(page.locator(".toast")).toContainText("최대 4장");
  await expect(page.locator(".image-preview")).toHaveCount(0);
  await input.setInputFiles(files.slice(0, 4));
  await expect(page.locator(".image-preview")).toHaveCount(4);
  await expect(input).toBeDisabled();
  await page.getByRole("button", { name: "기록", exact: true }).click();
  const shell = page.locator(".entry-image-shell");
  await shell.scrollIntoViewIfNeeded();
  await expect(shell.locator("img")).toHaveCount(4);
  await expect(shell).toHaveClass(/photo-grid-4/);
  await page.screenshot({ path: test.info().outputPath("four-images.png") });
  const before = await shell.locator("img").evaluateAll((items) => items.map((item) => (item as HTMLImageElement).src));
  await shell.locator("img").nth(2).click();
  await expect(page.locator(".lightbox-navigation")).toContainText("3 / 4");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".lightbox-navigation")).toContainText("4 / 4");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "기록 수정" }).click();
  await expect(page.locator(".image-preview")).toHaveCount(4);
  await page.getByRole("button", { name: "첨부 사진 제거 2", exact: true }).click();
  await expect(page.locator(".image-preview")).toHaveCount(3);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "사진 1 교체", exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files[4]);
  await expect(input).toBeEnabled();
  await input.setInputFiles(files[1]);
  await expect(page.locator(".image-preview")).toHaveCount(4);
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.locator(".editing-badge")).toHaveCount(0);
  await page.reload();
  await shell.scrollIntoViewIfNeeded();
  await expect(shell.locator("img")).toHaveCount(4);
  const after = await shell.locator("img").evaluateAll((items) => items.map((item) => (item as HTMLImageElement).src));
  expect(after[0]).not.toBe(before[0]);
  expect(after.slice(1)).toEqual([before[2], before[3], before[1]]);
  await page.getByRole("button", { name: "기록 수정" }).click();
  await expect(page.locator(".image-preview")).toHaveCount(4);
  await page.getByRole("button", { name: "첨부 사진 제거 1", exact: true }).click();
  await page.getByRole("button", { name: "수정 취소", exact: true }).click();
  await shell.scrollIntoViewIfNeeded();
  await expect(shell.locator("img")).toHaveCount(4);
  await page.getByRole("button", { name: "기록 수정" }).click();
  await expect(page.locator(".image-preview")).toHaveCount(4);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "첨부 사진 제거 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "수정 저장", exact: true })).toBeDisabled();
  await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill("사진을 모두 삭제했습니다");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.locator(".editing-badge")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".entry-text")).toContainText("사진을 모두 삭제했습니다");
  await expect(shell).toHaveCount(0);
});

test("blocks overlapping actions and discards a conversion after editing is cancelled", async ({ page }) => {
  const chunkDirectory = path.join(root, "_next/static/chunks");
  const decoderChunk = readdirSync(chunkDirectory).find((name) => name.endsWith(".js") && statSync(path.join(chunkDirectory, name)).size > 2_000_000);
  expect(decoderChunk, "the HEIF decoder must remain in a lazy chunk").toBeTruthy();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/_next/static/chunks/${decoderChunk}`, async (route) => { await gate; await route.continue(); });
  try {
    await page.goto(appUrl);
    await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill("수정 취소 검증");
    await page.getByRole("button", { name: "기록", exact: true }).click();
    await page.getByRole("button", { name: "기록 수정" }).click();
    const input = page.locator('.photo-button input[type="file"]');
    await input.setInputFiles({ name: "example.heic", mimeType: "image/heic", buffer: fixture });
    await expect(input).toBeDisabled();
    await expect(page.getByRole("button", { name: "수정 저장", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "수정 취소" }).click();
    release();
    await expect(input).toBeEnabled({ timeout: 30000 });
    await expect(page.locator(".image-preview")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toHaveValue("");
  } finally { release(); }
});
