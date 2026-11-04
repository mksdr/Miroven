import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DRAFT_TEXT, seedVault } from "./fixture";

type Metrics = {
  readyMs: number | null;
  draftRestoredMs: number | null;
  longTasks: { startMs: number; durationMs: number }[];
  input: { phase: string; latencyMs: number }[];
  phase: string;
};
declare global { interface Window { benchmark: Metrics } }
const runs = Number(process.env.MIROVEN_PERF_RUNS ?? 10);
if (!Number.isInteger(runs) || runs < 1) throw new Error("MIROVEN_PERF_RUNS must be a positive integer");

async function instrument(page: Page, expectDraft: boolean) {
  await page.addInitScript(({ draftText, expectDraft }) => {
    window.benchmark = { readyMs: null, draftRestoredMs: null, longTasks: [], input: [], phase: "initial" };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.benchmark.longTasks.push({ startMs: entry.startTime, durationMs: entry.duration });
    }).observe({ type: "longtask", buffered: true });
    function frame() {
      const textarea = document.querySelector<HTMLTextAreaElement>("#composer textarea");
      if (textarea && !textarea.disabled && window.benchmark.readyMs === null) window.benchmark.readyMs = performance.now();
      if (textarea?.value === draftText && window.benchmark.draftRestoredMs === null) window.benchmark.draftRestoredMs = performance.now();
      if (window.benchmark.readyMs === null || (expectDraft && window.benchmark.draftRestoredMs === null)) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    let keyTime: number | undefined;
    document.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLTextAreaElement && event.key.length === 1) keyTime = event.timeStamp;
    }, true);
    document.addEventListener("input", (event) => {
      if (!(event.target instanceof HTMLTextAreaElement) || keyTime === undefined) return;
      const started = keyTime;
      const phase = window.benchmark.phase;
      keyTime = undefined;
      // Double rAF includes a paint opportunity; this is a lab proxy, not field INP.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.benchmark.input.push({ phase, latencyMs: performance.now() - started });
      }));
    }, true);
  }, { draftText: DRAFT_TEXT, expectDraft });
}

for (const scenario of [
  { name: "first-visit", count: 0, photos: false },
  { name: "return-100", count: 100, photos: false },
  { name: "return-1000-photos", count: 1000, photos: true },
]) {
  test(scenario.name, async ({ browser }, info) => {
    const samples = [];
    let offlineCheck: { status: string; reason?: string } = { status: "not-applicable" };
    // The final run is a separate diagnostic profile, excluded from baseline statistics.
    for (let iteration = 0; iteration <= runs; iteration++) {
      const diagnostic = iteration === runs;
      const context = await browser.newContext({ ...info.project.use });
      try {
        const setup = await context.newPage();
        setup.on("dialog", (dialog) => dialog.accept());
        if (scenario.count) {
          await setup.goto("/");
          await expect(setup.locator("#composer textarea")).toBeEnabled();
          await setup.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
          // Stop all application effects before replacing the disposable fixture.
          await setup.goto("/robots.txt");
          await seedVault(setup, scenario.count, scenario.photos);
        }
        await setup.close();
        const page = await context.newPage();
        page.on("dialog", (dialog) => dialog.accept());
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.name));
        await instrument(page, Boolean(scenario.count));
        const cdp = await context.newCDPSession(page);
        await cdp.send("Network.enable");
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150,
          downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        if (diagnostic) {
          await cdp.send("Profiler.enable");
          await cdp.send("Profiler.start");
        }
        await page.goto("/", { waitUntil: "commit" });
        await page.waitForFunction(() => window.benchmark.readyMs !== null);
        const composer = page.locator("#composer textarea");
        if (scenario.count) {
          await expect(composer).toHaveValue(DRAFT_TEXT);
          await expect(page.locator(".entry")).toHaveCount(20);
        }
        await composer.pressSequentially(" typing a repeatable initial input sample", { delay: 35 });
        await expect(page.locator("#composer .post-button")).toBeEnabled();
        // Cross the 500 ms autosave debounce, then measure a second typing burst.
        await page.waitForTimeout(510);
        await page.evaluate(() => { window.benchmark.phase = "autosave-boundary"; });
        await composer.pressSequentially(" typing around the autosave boundary", { delay: 35 });
        await page.waitForTimeout(650);
        const metrics = await page.evaluate(() => ({ ...window.benchmark,
          assets: performance.getEntriesByType("resource")
            .filter((entry) => /\.(js|css)(\?|$)/.test(entry.name))
            .map((entry) => { const resource = entry as PerformanceResourceTiming;
              return { path: new URL(resource.name).pathname, transferBytes: resource.transferSize,
                decodedBytes: resource.decodedBodySize, durationMs: resource.duration }; }),
        }));
        expect(metrics.input).toHaveLength(77);
        expect(errors).toEqual([]);
        if (scenario.count) expect(metrics.draftRestoredMs).not.toBeNull();
        if (diagnostic) {
          const { profile } = await cdp.send("Profiler.stop");
          await writeFile(info.outputPath("cpu-profile.json"), JSON.stringify(profile));
          // Offline is a functional check on the warm return context, never part of timings.
          if (scenario.count) {
            await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
            await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
            await cdp.detach();
            await context.setOffline(true);
            try {
              await page.reload();
              await expect(composer).toBeEnabled({ timeout: 10_000 });
              await expect(page.locator(".entry")).toHaveCount(20);
              await expect(composer).toHaveValue(DRAFT_TEXT + " typing a repeatable initial input sample" + " typing around the autosave boundary");
              offlineCheck = { status: "passed" };
            } catch {
              offlineCheck = { status: "failed", reason: "Offline reload did not restore an interactive composer, feed and draft" };
              console.warn(`${scenario.name}: offline functional check FAILED (reported separately from timing samples)`);
            }
          }
        } else samples.push(metrics);
      } finally { await context.close(); }
    }
    await writeFile(info.outputPath("measurements.json"), JSON.stringify({ scenario, samples, offlineCheck,
      environment: { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        workingTree: execFileSync("git", ["status", "--short"], { encoding: "utf8" }).trim(),
        node: process.version, browser: browser.version(),
        buildCacheName: readFileSync("out/sw.js", "utf8").match(/const CACHE_NAME = "([^"]+)"/)?.[1],
        lockfileSha256: createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"),
        cpuSlowdown: 4, downloadMbps: 1.6, uploadMbps: 0.75, latencyMs: 150,
        origin: "https://127.0.0.2:3101", device: "Pixel 5", runs,
      } }, null, 2));
  });
}
