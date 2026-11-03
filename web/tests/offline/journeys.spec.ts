import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const worker = readFileSync("out/sw.js", "utf8");
const cacheName = worker.match(/const CACHE_NAME = "([^"]+)"/)![1];
const assets: string[] = JSON.parse(worker.match(/const BUILD_ASSETS = (\[[\s\S]*?\]);/)![1]);

async function prepareOffline(page: Page, context: BrowserContext) {
  expect(new URL(page.url()).origin).toBe("https://127.0.0.2:3101");
  await expect(page.locator("#composer textarea")).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
  const cached = await page.evaluate(async (name) => {
    const cache = await caches.open(name);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  }, cacheName);
  expect(cached.sort()).toEqual(["/", "/manifest.webmanifest", "/theme-init.js", ...assets].sort());
  // Ensure neither the HTTP cache nor a previously evaluated Account module masks missing precaches.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
}

async function saveEntry(page: Page, text: string) {
  await page.locator("#composer textarea").fill(text);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText(text);
  await expect(page.locator("#composer textarea")).toHaveValue("");
}

test("첫 방문 후 오프라인: 캐시 준비 후 새로고침해도 일기를 작성할 수 있다", async ({ page, context }) => {
  await page.goto("/");
  await prepareOffline(page, context);
  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator("#composer textarea")).toBeEnabled();
  await saveEntry(page, "Synthetic first-visit offline journal");
});

test("재방문 후 오프라인: 페이지를 종료하고 오프라인에서 다시 열면 기존 기록이 표시된다", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("#composer textarea")).toBeEnabled();
  const text = "Synthetic journal persisted before closing the page";
  await saveEntry(page, text);
  await prepareOffline(page, context);
  await page.close();
  await context.setOffline(true);
  // A new page in the same disposable profile has no evaluated modules from the original page.
  const reopened = await context.newPage();
  const response = await reopened.goto("/");
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(reopened.locator("#composer textarea")).toBeEnabled();
  await expect(reopened.locator(".entry-content > .entry-text")).toHaveText(text);
});

test("계정 설정 최초 실행: 온라인에서 열지 않은 계정 설정을 오프라인에서 표시한다", async ({ page, context }) => {
  await page.goto("/");
  await prepareOffline(page, context);
  await expect(page.getByRole("group", { name: "Encrypted backup", exact: true })).toHaveCount(0);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("group", { name: "Encrypted backup", exact: true })).toBeVisible();
});

test("백업 기능: 오프라인에서 계정 설정을 열어 암호화 백업을 다운로드한다", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("#composer textarea")).toBeEnabled();
  await saveEntry(page, "Synthetic journal for offline backup export");
  // Set up recovery through the home UI; Account is never opened online.
  await page.getByRole("button", { name: "Create recovery code", exact: true }).click();
  await expect(page.locator(".recovery-code-panel code")).toBeVisible();
  await prepareOffline(page, context);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const group = page.getByRole("group", { name: "Encrypted backup", exact: true });
  await expect(group).toBeVisible();
  const downloading = page.waitForEvent("download");
  await group.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.miroven-backup\.json$/);
  const payload = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(payload.format).toBe("miroven-encrypted-backup");
  expect(payload.entries).toHaveLength(1);
  expect(payload.entries[0].ciphertext).toEqual(expect.any(String));
  expect(payload.entries[0]).not.toHaveProperty("text");
});
