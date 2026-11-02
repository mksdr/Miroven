import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";

const source = readFileSync("public/sw.js", "utf8");
let server: Server;
let origin: string;
let version: "A" | "B";
let broken: boolean;

test.beforeEach(async () => {
  version = "A";
  broken = false;
  server = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (path === "/sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(source.replace('"miroven-shell-dev"', `"miroven-shell-${version}"`)
        .replace("const BUILD_ASSETS = [];", `const BUILD_ASSETS = ${JSON.stringify([
          `/_next/static/main-${version}.js`, `/_next/static/lazy-${version}.js`,
        ])};`));
    } else if (path === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<html><body><p id="version">${version}</p><textarea></textarea><script src="/_next/static/main-${version}.js"></script></body></html>`);
    } else if (path === `/_next/static/main-${version}.js`) {
      response.setHeader("Content-Type", "text/javascript");
      response.end('navigator.serviceWorker.register("/sw.js");');
    } else if (path === `/_next/static/lazy-${version}.js` && !broken) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(`export default "lazy ${version}";`);
    } else if (["/manifest.webmanifest", "/theme-init.js"].includes(path)) {
      response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "application/json");
      response.end(path.endsWith(".js") ? "" : "{}");
    } else {
      response.writeHead(404).end("not available");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

test("A to B: latest online navigation, atomic offline fallback, old-tab lazy chunks and cache cleanup", async ({ page, context }) => {
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.locator("textarea").fill("Synthetic unsaved A draft");

  // B's HTML is live, but an incomplete B install must leave A usable offline.
  version = "B";
  broken = true;
  const latest = await context.newPage();
  await latest.goto(origin);
  await expect(latest.locator("#version")).toHaveText("B");
  await latest.evaluate(async () => {
    const cache = await caches.open("miroven-shell-A");
    const html = await (await cache.match("/"))!.text();
    if (!html.includes('id="version">A')) throw new Error("A cache was overwritten");
  });
  await context.setOffline(true);
  await latest.reload();
  await expect(latest.locator("#version")).toHaveText("A");
  await context.setOffline(false);

  // Retry a complete B installation; controller takeover must not reload A.
  broken = false;
  await latest.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect.poll(() => latest.evaluate(async () => {
    const keys = await caches.keys();
    return keys.includes("miroven-shell-B") && (await (await caches.open("miroven-shell-B")).keys()).length;
  })).toBe(5);
  // Ask the controlling worker for a cached B asset: it is unavailable offline to A.
  await context.setOffline(true);
  await expect.poll(() => latest.evaluate(async () => {
    try { return (await fetch("/_next/static/lazy-B.js")).ok; } catch { return false; }
  })).toBe(true);
  await expect(page.locator("#version")).toHaveText("A");
  await expect(page.locator("textarea")).toHaveValue("Synthetic unsaved A draft");
  const oldChunk = await page.evaluate(async () => {
    const url = "/_next/static/lazy-A.js";
    return (await import(/* webpackIgnore: true */ url)).default;
  });
  expect(oldChunk).toBe("lazy A");
  await latest.reload();
  await expect(latest.locator("#version")).toHaveText("B");

  await context.setOffline(false);
  await page.close();
  await latest.reload();
  await expect.poll(() => latest.evaluate(() => caches.keys())).toEqual(["miroven-shell-B"]);
});
