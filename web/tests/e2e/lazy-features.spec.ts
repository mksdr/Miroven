import { test, expect, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import authenticatedBackup from "../fixtures/backup-v2.json" with { type: "json" };

function featureChunk(marker: string) {
  const directory = path.resolve("out/_next/static/chunks");
  const files = readdirSync(directory).filter((file) => file.endsWith(".js") && readFileSync(path.join(directory, file), "utf8").includes(marker));
  expect(files).toHaveLength(1);
  return `/_next/static/chunks/${files[0]}`;
}

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("#composer textarea")).toBeEnabled();
}

const BACKUP_MARKER = "지원하지 않는 백업 금고 형식입니다.";

test("startup and writing do not download backup or diagnostics implementations", async ({ page }) => {
  const optional = [featureChunk(BACKUP_MARKER), featureChunk("entriesWithImageCount")];
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));
  await ready(page);
  await page.locator("#composer textarea").fill("Synthetic writing without Account modules");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("Synthetic writing without Account modules");
  expect(requested.filter((file) => optional.includes(file))).toEqual([]);
});

test("failed Account dependency download preserves the draft and can retry", async ({ page }) => {
  const chunk = featureChunk(BACKUP_MARKER);
  await page.route(`**${chunk}`, (route) => route.abort());
  await ready(page);
  const composer = page.locator("#composer textarea");
  await composer.fill("Synthetic draft preserved on Account load failure");
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByText("계정 설정을 불러오지 못했습니다. 다시 시도해 주세요.", { exact: true })).toBeVisible();
  await expect(composer).toHaveValue("Synthetic draft preserved on Account load failure");
  await page.unroute(`**${chunk}`);
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByRole("group", { name: "암호화 백업", exact: true })).toBeVisible();
});

test("locking cancels a pending Account open", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByRole("button", { name: "PIN 잠금 설정", exact: true }).click();
  await page.locator("#new-pin-input").fill("654321");
  await page.locator("#confirm-pin-input").fill("654321");
  await page.getByRole("button", { name: "저장 및 잠금 설정", exact: true }).click();
  // A new document removes the evaluated-module cache from the setup phase.
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await page.reload();
  await page.getByPlaceholder("PIN 번호 입력").fill("654321");
  await page.getByRole("button", { name: "PIN으로 잠금 해제", exact: true }).click();
  await expect(page.locator("#composer textarea")).toBeEnabled();
  const chunk = featureChunk(BACKUP_MARKER);
  let release!: () => void;
  let requested!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { requested = resolve; });
  await page.route(`**${chunk}`, async (route) => { requested(); await gate; await route.continue(); });
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === chunk);
  try {
    await page.getByRole("button", { name: "계정", exact: true }).click();
    await started;
    await page.getByRole("button", { name: "금고 잠그기", exact: true }).click();
    await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  } finally { release(); }
  await loaded;
  await page.getByPlaceholder("PIN 번호 입력").fill("654321");
  await page.getByRole("button", { name: "PIN으로 잠금 해제", exact: true }).click();
  await expect(page.locator("#composer textarea")).toBeEnabled();
  await expect(page.getByRole("group", { name: "암호화 백업", exact: true })).toHaveCount(0);
});

test("home profile editing and recovery creation retain first-use offline availability", async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await page.locator(".persona-composer-button").click();
  const dialog = page.getByRole("dialog", { name: "프로필 편집" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await page.locator("#composer textarea").fill("Synthetic offline entry before recovery setup");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await page.getByRole("button", { name: "복구 코드 만들기", exact: true }).click();
  await expect(page.locator(".recovery-code-panel code")).toBeVisible();
});

test.describe("Account capabilities", () => {
  test.use({ locale: "en-US" });
  test("first backup import/export and diagnostics download work offline after Account opens", async ({ page, context, browserName }) => {
    await ready(page);
    await page.getByRole("button", { name: "Account", exact: true }).click();
    const group = page.getByRole("group", { name: "Encrypted backup", exact: true });
    await expect(group).toBeVisible();
    await context.setOffline(true);
    await group.locator('input[type="text"], input:not([type])').fill("3P2ZZ-A4763-F7KD3-KPBSY-9HVBT-L5QK8-PTQ4C-PECJ6-23");
    // Playwright WebKit blocks even in-memory File.text() in offline mode.
    // Buffer only this fixture's text there; module loading and all cryptography stay real.
    await group.locator('input[type="file"]').evaluate((node, { payload, buffered }) => {
      const input = node as HTMLInputElement;
      const transfer = new DataTransfer();
      const file = new File([payload], "synthetic-v2.miroven-backup.json", { type: "application/json" });
      if (buffered) Object.defineProperty(file, "text", { value: async () => payload });
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { payload: JSON.stringify(authenticatedBackup), buffered: browserName === "webkit" });
    await expect(page.getByText("Restored 1 encrypted entry.", { exact: true })).toBeVisible();
    const backupDownload = page.waitForEvent("download");
    await group.getByRole("button", { name: "Download encrypted backup", exact: true }).click();
    expect((await backupDownload).suggestedFilename()).toMatch(/\.miroven-backup\.json$/);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export Diagnostic Report", exact: true }).click();
    expect((await download).suggestedFilename()).toContain("diagnostic");
  });
});
