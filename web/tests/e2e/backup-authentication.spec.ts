import { expect, test } from "@playwright/test";
import { VAULT_DATABASE_CONTRACT } from "../../app/lib/vault/contracts";
import legacyBackup from "../fixtures/legacy-backup-v1.json" with { type: "json" };
import authenticatedBackup from "../fixtures/backup-v2.json" with { type: "json" };

const recoveryCode = "3P2ZZ-A4763-F7KD3-KPBSY-9HVBT-L5QK8-PTQ4C-PECJ6-23";
const unsignedDeletion = {
  operationId: "77777777-7777-4777-8777-777777777777",
  entryId: legacyBackup.entries[0].id,
  baseRevision: 1, revision: 2, changeType: "delete",
  createdAt: "2026-10-29T00:00:00Z", status: "pending",
};

for (const locale of ["ko-KR", "en-US"]) {
  test.describe(`backup authentication (${locale})`, () => {
    test.use({ locale });
    test("explains legacy deletion refusal and imports an authenticated backup afterward", async ({ page }) => {
      const ko = locale === "ko-KR";
      await page.goto("/");
      await page.getByRole("button", { name: ko ? "계정" : "Account", exact: true }).click();
      const group = page.getByRole("group", { name: ko ? "암호화 백업" : "Encrypted backup", exact: true });
      await group.locator('input[type="text"], input:not([type])').fill(recoveryCode);
      await group.locator('input[type="file"]').setInputFiles({
        name: "synthetic-legacy.miroven-backup.json", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ ...legacyBackup, outbox: [unsignedDeletion] })),
      });
      await expect(page.getByText(ko
        ? "이 백업의 삭제 내역은 안전하게 확인할 수 없습니다. 원래 기기에서 최신 앱으로 새 백업을 만들어 주세요. 기존 파일은 보관해 주세요."
        : "The deletions in this backup cannot be safely verified. Create a new backup with the latest app on the original device, and keep the existing file.", { exact: true })).toBeVisible();
      // A refusal must not create an envelope that hides the import controls.
      await expect(group.locator('input[type="file"]')).toBeEnabled();
      await group.locator('input[type="file"]').setInputFiles({
        name: "synthetic-v2.miroven-backup.json", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(authenticatedBackup)),
      });
      await expect(page.getByText(ko ? "1개 기록을 암호화 상태로 복구했습니다." : "Restored 1 encrypted entry.", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByText("Miroven backup v1 compatibility fixture", { exact: true })).toBeVisible();
    });
  });
}

test("keeps a committed backup available after locking and unlocking", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "계정", exact: true }).click();
  const group = page.getByRole("group", { name: "암호화 백업", exact: true });
  await group.locator('input[type="text"], input:not([type])').fill(recoveryCode);

  await page.evaluate(({ vaultEnvelopes, syncOutbox }) => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const result = transaction.apply(this, args);
      const [stores, mode] = args;
      if (mode === "readwrite" && Array.isArray(stores) &&
        stores.includes(vaultEnvelopes) && stores.includes(syncOutbox)) {
        result.addEventListener("complete", () => {
          IDBDatabase.prototype.transaction = transaction;
          // Revoke the session after commit, before the import handler reads vault state.
          window.dispatchEvent(new PageTransitionEvent("pagehide"));
        }, { once: true });
      }
      return result;
    };
  }, VAULT_DATABASE_CONTRACT.stores);

  await group.locator('input[type="file"]').setInputFiles({
    name: "synthetic-v2.miroven-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(authenticatedBackup)),
  });
  const marker = page.getByText("Miroven backup v1 compatibility fixture", { exact: true });
  await expect(page.getByRole("heading", { name: "금고가 잠겨 있습니다" })).toBeVisible();
  await expect(marker).toHaveCount(0);
  await page.getByRole("button", { name: "금고 잠금 해제", exact: true }).click();
  await expect(marker).toBeVisible();
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(group.getByRole("button", { name: "암호화 백업 내려받기", exact: true })).toBeEnabled();
});

test("cancels a pending backup import after another tab clears the vault", async ({ page, context }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "BroadcastChannel", { value: undefined });
    Object.defineProperty(navigator, "locks", { value: undefined });

    const originalText = File.prototype.text;
    let releaseRead!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const testState = { reading: false, releaseRead };
    Object.assign(window, { backupImportTest: testState });
    File.prototype.text = async function () {
      if (this.name === "pending-import.miroven-backup.json") {
        testState.reading = true;
        await readGate;
      }
      return originalText.call(this);
    };
  });

  const resetTab = await context.newPage();
  await resetTab.addInitScript(() => {
    Object.defineProperty(navigator, "locks", { value: undefined });
  });
  await page.goto("/");
  await resetTab.goto("/");
  const marker = "Miroven backup v1 compatibility fixture";
  await page.getByRole("button", { name: "계정", exact: true }).click();
  const group = page.getByRole("group", { name: "암호화 백업", exact: true });
  const codeInput = group.locator('input[type="text"], input:not([type])');
  const fileInput = group.locator('input[type="file"]');
  const backup = { mimeType: "application/json", buffer: Buffer.from(JSON.stringify(authenticatedBackup)) };
  await codeInput.fill(recoveryCode);
  await fileInput.setInputFiles({ ...backup, name: "pending-import.miroven-backup.json" });
  type BackupImportTestWindow = typeof window & {
    backupImportTest: { reading: boolean; releaseRead: () => void };
  };
  await page.waitForFunction(() => (window as BackupImportTestWindow).backupImportTest.reading);

  await resetTab.getByRole("button", { name: "계정", exact: true }).click();
  await resetTab.getByRole("button", { name: "이 기기의 로컬 금고 초기화", exact: true }).click();
  await resetTab.locator("#delete-confirm-input").fill("로컬 금고 삭제");
  await resetTab.getByRole("button", { name: "로컬 금고 삭제", exact: true }).click();
  await expect(resetTab.getByText("이 기기의 로컬 금고를 초기화했습니다.", { exact: true })).toBeVisible();

  await page.evaluate(() => (window as BackupImportTestWindow).backupImportTest.releaseRead());
  await expect(page.getByText("로컬 금고가 초기화되어 백업 가져오기를 취소했습니다. 복구 코드를 다시 입력해 주세요.", { exact: true })).toBeVisible();
  await expect(codeInput).toHaveValue("");

  // A fresh app load can generate a new key for the empty vault.
  // Inspect storage first so this assertion is specific to the cancelled import.
  const storedKeys = await resetTab.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stores = [...database.objectStoreNames];
      const transaction = database.transaction(stores);
      return await Promise.all(stores.map((store) => new Promise<[string, IDBValidKey[]]>((resolve, reject) => {
        const request = transaction.objectStore(store).getAllKeys();
        request.onsuccess = () => resolve([store, request.result]);
        request.onerror = () => reject(request.error);
      })));
    } finally {
      database.close();
    }
  }, VAULT_DATABASE_CONTRACT.name);
  for (const [store, keys] of storedKeys) {
    expect(keys).toEqual(store === VAULT_DATABASE_CONTRACT.stores.deviceKeys ? [VAULT_DATABASE_CONTRACT.keys.resetToken] : []);
  }
  await resetTab.reload();
  await expect(resetTab.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toBeEnabled();
  await expect(resetTab.getByText(marker, { exact: true })).toHaveCount(0);

  await codeInput.fill(recoveryCode);
  await fileInput.setInputFiles({ ...backup, name: "new-import.miroven-backup.json" });
  await expect(page.getByText("1개 기록을 암호화 상태로 복구했습니다.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
});
