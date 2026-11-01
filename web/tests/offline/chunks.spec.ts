import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import backup from "../fixtures/backup-v2.json" with { type: "json" };

const worker = readFileSync("out/sw.js", "utf8");
const cacheName = worker.match(/const CACHE_NAME = "([^"]+)"/)![1];
const assets: string[] = JSON.parse(worker.match(/const BUILD_ASSETS = (\[[\s\S]*?\]);/)![1]);

for (const reload of [false, true]) {
  test(`unopened Account works offline${reload ? " after reload" : ""}`, async ({ page, context }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    const composer = page.locator("#composer textarea");
    await expect(composer).toBeEnabled();
    await composer.fill("Synthetic offline draft");
    await page.waitForTimeout(700);
    // An active worker means its atomic install precache has completed.
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.clearBrowserCache");
    await cdp.detach();
    await context.setOffline(true);
    if (reload) {
      await page.reload();
      await expect(composer).toBeEnabled();
      await expect(composer).toHaveValue("Synthetic offline draft");
    }
    await page.getByRole("button", { name: "Account", exact: true }).click();
    const group = page.getByRole("group", { name: "Encrypted backup", exact: true });
    await expect(group).toBeVisible();
    await group.locator('input[type="text"], input:not([type])').fill("3P2ZZ-A4763-F7KD3-KPBSY-9HVBT-L5QK8-PTQ4C-PECJ6-23");
    await group.locator('input[type="file"]').setInputFiles({ name: "synthetic.miroven-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    await expect(page.getByText("Restored 1 encrypted entry.", { exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await group.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
    const artifact = await download;
    const exported = JSON.parse(readFileSync((await artifact.path())!, "utf8"));
    expect(exported).toMatchObject({ format: "miroven-encrypted-backup", entries: expect.any(Array) });
    expect(exported.entries).toHaveLength(1);
    const diagnostics = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Diagnostic Report", exact: true }).click();
    expect((await diagnostics).suggestedFilename()).toContain("diagnostic");
    expect(errors).toEqual([]);
    const cached = await page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname), cacheName);
    expect(cached.sort()).toEqual(["/", "/manifest.webmanifest", "/theme-init.js", ...assets].sort());
  });
}

test("online reload reuses installed assets after clearing HTTP cache", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.locator("#composer textarea")).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
  const sources: boolean[] = [];
  page.on("response", (response) => {
    if (assets.includes(new URL(response.url()).pathname)) sources.push(response.fromServiceWorker());
  });
  await page.reload();
  await expect(page.locator("#composer textarea")).toBeEnabled();
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.every(Boolean)).toBe(true);
});
