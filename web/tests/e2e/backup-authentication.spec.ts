import { expect, test } from "@playwright/test";
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
