import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { closeSync, fstatSync, openSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { headersForPath, parseHeaderRules } from "../../scripts/header-rules.mjs";

type Build = { cacheName: string; assets: string[]; accountChunk: string };
const root = path.resolve(".local/update-builds");
let builds: Record<"A" | "B", Build>;
let version: "A" | "B";
let origin: string;
let server: Server;
let tls: string;

test.beforeAll(async () => {
  builds = JSON.parse(readFileSync(path.join(root, "builds.json"), "utf8"));
  version = "A";
  tls = mkdtempSync(path.join(root, "tls-"));
  const key = path.join(tls, "key.pem");
  const cert = path.join(tls, "cert.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.2", "-keyout", key, "-out", cert], { stdio: "ignore" });
  const rules = Object.fromEntries((["A", "B"] as const).map((build) => [build,
    parseHeaderRules(readFileSync(path.join(root, build, "_headers"), "utf8"))]));
  server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    const pathname = new URL(request.url!, "https://127.0.0.2").pathname;
    const directory = path.join(root, version);
    const file = path.resolve(directory, `.${pathname === "/" ? "/index.html" : pathname}`);
    // The server exposes B only after deployment; it cannot rescue A's removed chunks.
    if (!file.startsWith(`${directory}${path.sep}`)) {
      response.writeHead(404).end();
      return;
    }
    let contents: Buffer;
    let descriptor: number | undefined;
    try {
      // Inspect and read the same open file, even if the path changes meanwhile.
      descriptor = openSync(file, "r");
      if (!fstatSync(descriptor).isFile()) {
        response.writeHead(404).end();
        return;
      }
      contents = readFileSync(descriptor);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      response.writeHead(404).end();
      return;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
    const types: Record<string, string> = { ".html": "text/html", ".js": "application/javascript",
      ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
      ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
    response.writeHead(200, { ...headersForPath(rules[version], pathname), "Cache-Control": "no-store",
      "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    response.end(contents);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.2", resolve));
  origin = `https://127.0.0.2:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (tls) rmSync(tls, { recursive: true, force: true });
});

test("B takeover preserves unopened A Account and backup offline with real production chunks", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await page.goto(origin);
  const composer = page.locator("#composer textarea");
  await expect(composer).toBeEnabled();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
  const entry = "Synthetic encrypted entry before updating";
  await composer.fill(entry);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText(entry);
  await page.getByRole("button", { name: "Create recovery code", exact: true }).click();
  await expect(page.locator(".recovery-code-panel code")).toBeVisible();
  await composer.fill("Synthetic A draft retained during takeover");
  // A DOM token detects a reload even if the app restores its draft from IndexedDB.
  await page.evaluate(() => {
    document.documentElement.dataset.originalTab = "A";
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      document.documentElement.dataset.workerChanged = "yes";
    });
  });
  expect(builds.A.cacheName).not.toBe(builds.B.cacheName);
  expect(builds.B.assets).not.toContain(builds.A.accountChunk);
  expect(requested).not.toContain(builds.A.accountChunk);
  await expect(page.locator("[data-update-build]")).toHaveCount(0);

  version = "B";
  const latest = await context.newPage();
  await latest.goto(origin);
  await expect(latest.locator("#composer textarea")).toBeEnabled();
  await latest.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await page.waitForFunction(() => document.documentElement.dataset.workerChanged === "yes"
    && navigator.serviceWorker.controller?.state === "activated");
  expect(await page.evaluate(() => caches.keys())).toContain(builds.A.cacheName);
  const cached = await page.evaluate(async (name) => (await (await caches.open(name)).keys())
    .map((request) => new URL(request.url).pathname), builds.B.cacheName);
  expect(cached.sort()).toEqual(["/", "/manifest.webmanifest", "/theme-init.js", ...builds.B.assets].sort());
  expect((await context.request.get(`${origin}${builds.A.accountChunk}`)).status()).toBe(404);
  expect(requested).not.toContain(builds.A.accountChunk);
  await expect(page.locator("html")).toHaveAttribute("data-original-tab", "A");
  await expect(composer).toHaveValue("Synthetic A draft retained during takeover");

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.detach();
  await context.setOffline(true);
  const oldChunk = page.waitForResponse((response) => new URL(response.url()).pathname === builds.A.accountChunk);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.locator('[data-update-build="A"]')).toBeVisible();
  expect((await oldChunk).fromServiceWorker()).toBe(true);
  expect((await oldChunk).status()).toBe(200);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  const backup = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(backup.format).toBe("miroven-encrypted-backup");
  expect(backup.entries).toHaveLength(1);
  expect(backup.entries[0].ciphertext).toEqual(expect.any(String));
  expect(backup.entries[0]).not.toHaveProperty("text");
  expect(errors).toEqual([]);

  await latest.reload();
  await expect(latest.locator("#composer textarea")).toBeEnabled();
  await latest.getByRole("button", { name: "Account", exact: true }).click();
  await expect(latest.locator('[data-update-build="B"]')).toBeVisible();
});
