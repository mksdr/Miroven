import { expect, test, type Page } from "@playwright/test";

const PIN = "654321";
const TEXT = "Synthetic PIN lifetime entry";
async function saveEntry(page: Page) {
  await page.goto("/");
  await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(TEXT);
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.getByText(TEXT, { exact: true })).toBeVisible();
}
async function setupPin(page: Page) {
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByRole("button", { name: "PIN 잠금 설정", exact: true }).click();
  await page.locator("#new-pin-input").fill(PIN);
  await page.locator("#confirm-pin-input").fill(PIN);
  await page.getByRole("button", { name: "저장 및 잠금 설정", exact: true }).click();
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
}
async function unlock(page: Page) {
  await page.getByPlaceholder("PIN 번호 입력").fill(PIN);
  await page.getByRole("button", { name: "PIN으로 잠금 해제", exact: true }).click();
  await expect(page.getByText(TEXT, { exact: true })).toBeVisible();
}
async function hasPersistedKey(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("private-journal"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<boolean>((resolve, reject) => {
        const r = db.transaction("device-keys").objectStore("device-keys").get("primary");
        r.onsuccess = () => resolve(r.result !== undefined); r.onerror = () => reject(r.error);
      });
    } finally { db.close(); }
  });
}

test("new tabs and reload require PIN; a manual lock revokes every open tab", async ({ page, context }) => {
  await saveEntry(page); await setupPin(page); await unlock(page);
  expect(await hasPersistedKey(page)).toBe(false);
  const peer = await context.newPage();
  await peer.goto("/");
  await expect(peer.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await expect(peer.getByText(TEXT, { exact: true })).toHaveCount(0);
  await unlock(peer);
  await page.getByRole("button", { name: "금고 잠그기", exact: true }).click();
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await expect(peer.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await expect(peer.getByText(TEXT, { exact: true })).toHaveCount(0);
  await unlock(page);
  await expect(peer.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await unlock(page);
  await peer.close();
});

test("navigation and pagehide revoke the local session", async ({ page }) => {
  await saveEntry(page); await setupPin(page); await unlock(page);
  await page.goto("/guide");
  await page.goBack();
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await expect(page.getByText(TEXT, { exact: true })).toHaveCount(0);
  await unlock(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  expect(await hasPersistedKey(page)).toBe(false);
});

test("storage notifications propagate locks when BroadcastChannel is unavailable", async ({ context, page }) => {
  await context.addInitScript(() => Object.defineProperty(window, "BroadcastChannel", { value: undefined, configurable: true }));
  await saveEntry(page); await setupPin(page); await unlock(page);
  const peer = await context.newPage(); await peer.goto("/"); await unlock(peer);
  await page.getByRole("button", { name: "금고 잠그기", exact: true }).click();
  await expect(peer.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  await expect(peer.getByText(TEXT, { exact: true })).toHaveCount(0);
  await peer.close();
});

test("migrates a legacy persisted PIN key without exposing entries on reload", async ({ page }) => {
  await saveEntry(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("private-journal"); r.onsuccess = () => resolve(r.result); });
    try {
      const key = await new Promise<CryptoKey>((resolve) => { const r = db.transaction("device-keys").objectStore("device-keys").get("primary"); r.onsuccess = () => resolve(r.result); });
      (window as unknown as { legacyTestKey: CryptoKey }).legacyTestKey = key;
    } finally { db.close(); }
  });
  await setupPin(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("private-journal"); r.onsuccess = () => resolve(r.result); });
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction("device-keys", "readwrite");
        tx.objectStore("device-keys").put((window as unknown as { legacyTestKey: CryptoKey }).legacyTestKey, "primary");
        tx.oncomplete = () => resolve();
      });
    } finally { db.close(); }
  });
  await page.reload();
  await expect(page.getByPlaceholder("PIN 번호 입력")).toBeVisible();
  expect(await hasPersistedKey(page)).toBe(true);
  await expect(page.getByText(TEXT, { exact: true })).toHaveCount(0);
  await unlock(page);
  expect(await hasPersistedKey(page)).toBe(false);
});

test("browser process restart with the same profile requires the PIN", async ({ playwright, browserName, baseURL }, testInfo) => {
  const profile = testInfo.outputPath("synthetic-pin-profile");
  const options = { headless: true, locale: "ko-KR", baseURL };
  let context = await playwright[browserName].launchPersistentContext(profile, options);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await saveEntry(page); await setupPin(page); await unlock(page);
    expect(await hasPersistedKey(page)).toBe(false);
    await context.close();
    context = await playwright[browserName].launchPersistentContext(profile, options);
    const restarted = context.pages()[0] ?? await context.newPage();
    await restarted.goto("/");
    await expect(restarted.getByPlaceholder("PIN 번호 입력")).toBeVisible();
    expect(await hasPersistedKey(restarted)).toBe(false);
    await expect(restarted.getByText(TEXT, { exact: true })).toHaveCount(0);
    await unlock(restarted);
  } finally { await context.close(); }
});
