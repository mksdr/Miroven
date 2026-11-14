import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { DiagnosticReport } from "../../app/lib/diagnostics";

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#composer textarea")).toBeEnabled();
}
async function openAccount(page: Page) {
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByRole("button", { name: "진단 정보 리포트 내보내기", exact: true })).toBeEnabled();
}
async function exportReport(page: Page): Promise<DiagnosticReport> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "진단 정보 리포트 내보내기", exact: true }).click();
  const artifact = await download;
  expect(artifact.suggestedFilename()).toMatch(/^miroven-diagnostics-.*\.json$/);
  expect(await artifact.failure()).toBeNull();
  return JSON.parse(readFileSync((await artifact.path())!, "utf8"));
}
const completed = (report: DiagnosticReport, operation: string, outcome: string) =>
  report.activity.events.some((event) => event.operation === operation && event.outcome === outcome);

test("exports successful saves and runtime metadata offline without private content", async ({ page, context }) => {
  await ready(page);
  const secret = "Synthetic private journal email@example.com PIN 654321";
  await page.locator("#composer textarea").fill(secret);
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText(secret);
  await openAccount(page);
  await context.setOffline(true);
  const report = await exportReport(page);
  expect(report.schemaVersion).toBe(2);
  expect(completed(report, "entry.save", "succeeded")).toBe(true);
  expect(report.runtime.viewport?.width).toBeGreaterThan(0);
  expect(report.collectionStatus.entries).toBe("ok");
  expect(report.metrics.totalEntriesCount).toBe(1);
  expect(JSON.stringify(report)).not.toContain(secret);
});

test("captures failed writes and image conversion without filenames or error text", async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "entries") throw new DOMException("synthetic-private-storage-message", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await ready(page);
  await page.locator("#composer textarea").fill("synthetic unsaved private content");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.getByText("저장하지 못했습니다. 기기 공간을 확인해 주세요.", { exact: true })).toBeVisible();
  await page.locator('.photo-button input[type="file"]').setInputFiles({
    name: "synthetic-private-photo.png", mimeType: "image/png", buffer: Buffer.from("not a real image"),
  });
  await expect(page.locator(".toast")).toContainText("synthetic-private-photo.png");
  await openAccount(page);
  const report = await exportReport(page);
  expect(completed(report, "entry.save", "failed")).toBe(true);
  expect(completed(report, "image.process", "failed")).toBe(true);
  expect(report.activity.events.find((event) => event.operation === "entry.save" && event.outcome === "failed")?.errorType).toBe("QuotaExceededError");
  const serialized = JSON.stringify(report);
  for (const secret of ["synthetic unsaved private content", "synthetic-private-storage-message", "synthetic-private-photo.png"]) {
    expect(serialized).not.toContain(secret);
  }
});

test("reload and lock erase prior activity without deleting journal data", async ({ page }) => {
  await ready(page);
  await page.locator("#composer textarea").fill("Synthetic preserved journal");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("Synthetic preserved journal");
  await page.reload();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("Synthetic preserved journal");
  await openAccount(page);
  expect(completed(await exportReport(page), "entry.save", "succeeded")).toBe(false);
  await page.getByRole("button", { name: "PIN 잠금 설정", exact: true }).click();
  await page.locator("#new-pin-input").fill("654321");
  await page.locator("#confirm-pin-input").fill("654321");
  await page.getByRole("button", { name: "저장 및 잠금 설정", exact: true }).click();
  await page.getByPlaceholder("PIN 번호 입력").fill("654321");
  await page.getByRole("button", { name: "PIN으로 잠금 해제", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("Synthetic preserved journal");
  await openAccount(page);
  await page.getByRole("button", { name: "PIN 잠금 해제", exact: true }).click();
  await page.locator("#remove-pin-input").fill("654321");
  await page.locator("#remove-pin-input").press("Enter");
  await expect(page.getByRole("button", { name: "PIN 잠금 설정", exact: true })).toBeVisible();
  const report = await exportReport(page);
  expect(completed(report, "pin.setup", "succeeded")).toBe(false);
  expect(completed(report, "pin.unlock", "succeeded")).toBe(true);
  expect(completed(report, "pin.remove", "succeeded")).toBe(true);
  expect(report.runtime.syncStatus).toBe("local");
  expect(report.securityAndVault.hasPinLock).toBe(false);
  expect(report.metrics.totalEntriesCount).toBe(1);
});

test("a lock during storage collection cancels the download", async ({ page }) => {
  await ready(page);
  await openAccount(page);
  await page.evaluate(() => {
    const pending: ((estimate: StorageEstimate) => void)[] = [];
    const estimate = { usage: 0, quota: 0 };
    let released = false;
    const finishEstimate = () => {
      released = true;
      for (const resolve of pending.splice(0)) resolve(estimate);
    };
    // StorageManager is optional (including in WebKit's HTTP context).
    // Release every overlapping query, including startup storage-health reads.
    Object.defineProperty(navigator, "storage", { configurable: true, value: {
      estimate: () => {
        (window as unknown as { finishEstimate: () => void }).finishEstimate = finishEstimate;
        return released ? Promise.resolve(estimate) : new Promise<StorageEstimate>((resolve) => pending.push(resolve));
      },
      persisted: async () => false,
    } });
  });
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "진단 정보 리포트 내보내기", exact: true }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { finishEstimate?: unknown }).finishEstimate)).toBe("function");
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    (window as unknown as { finishEstimate: () => void }).finishEstimate();
  });
  await expect(page.locator(".lock-screen-overlay")).toBeVisible();
  // Toasts are hidden by the lock screen; reopen the local-only vault to observe completion.
  await page.locator(".lock-card button").click();
  await expect(page.getByText("진단 정보를 생성하지 못했습니다.", { exact: true })).toBeVisible();
  expect(downloads).toEqual([]);
});

test("exports diagnostics when the storage API is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", { configurable: true, value: undefined });
  });
  await ready(page);
  await openAccount(page);
  const report = await exportReport(page);
  expect(report.schemaVersion).toBe(2);
  expect(report.collectionStatus).toMatchObject({
    entries: "ok", storageEstimate: "unsupported", storagePersistence: "unsupported",
  });
  expect(report.storage).toEqual({ isPersistent: false, usageMB: null, quotaMB: null });
});


test.describe("configured API diagnostics", () => {
  test.skip(({ browserName }) => !process.env.MIROVEN_DIAGNOSTICS_API_UI_TEST || browserName !== "chromium",
    "Requires an API-configured diagnostics UI test build in Chromium");
  test("configured API failures export only safe request categories", async ({ page }) => {
    const secret = "synthetic-private-response-email@example.com-token";
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/code/request")) return route.fulfill({ status: 503, json: { code: secret, message: secret } });
      if (path.endsWith("/auth/policy")) return route.fulfill({ status: 200, json: {
        domain_groups: { DEFAULT: ["example.com"], KR: [], JP: [] },
        default_email_locale: "en", existing_accounts_allowed: true,
      } });
      return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
    });
    await page.goto("/");
    await openAccount(page);
    await page.getByLabel("이메일로 시작하기", { exact: true }).fill("synthetic@example.com");
    await page.getByRole("button", { name: "6자리 로그인 코드 받기", exact: true }).click();
    await expect(page.getByText("로그인 코드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.", { exact: true })).toBeVisible();
    const report = await exportReport(page);
    expect(report.activity.events.find((event) => event.operation === "api.auth.request-code" && event.outcome === "failed"))
      .toMatchObject({ httpStatus: 503, errorCode: "unknown" });
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(JSON.stringify(report)).not.toContain("synthetic@example.com");
  });
});
