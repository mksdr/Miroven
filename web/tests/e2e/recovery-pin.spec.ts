import { expect, test } from "@playwright/test";

for (const locale of ["ko-KR", "en-US"]) {
  test.describe(`PIN and recovery (${locale})`, () => {
    test.use({ locale });

    test("explains PIN removal, then preserves entries through recovery setup and PIN reconfiguration", async ({ page }) => {
      const ko = locale === "ko-KR";
      const account = () => page.getByRole("button", { name: ko ? "계정" : "Account", exact: true });
      const unlock = async () => {
        await page.getByPlaceholder(ko ? "PIN 번호 입력" : "Enter PIN").fill("123456");
        await page.getByRole("button", { name: ko ? "PIN으로 잠금 해제" : "Unlock with PIN", exact: true }).click();
        await expect(page.getByText("Synthetic PIN recovery entry", { exact: true })).toBeVisible();
      };
      const setupPin = async () => {
        await account().click();
        await page.getByRole("button", { name: ko ? "PIN 잠금 설정" : "Setup PIN Lock", exact: true }).click();
        await page.locator("#new-pin-input").fill("123456");
        await page.locator("#confirm-pin-input").fill("123456");
        await page.getByRole("button", { name: ko ? "저장 및 잠금 설정" : "Save PIN", exact: true }).click();
        await expect(page.locator("#pin-setup-title")).toHaveCount(0);
        await page.reload();
        await unlock();
      };
      await page.addInitScript(() => localStorage.setItem("miroven:onboarding:v1", "done"));
      await page.goto("/");
      await page.locator(".composer textarea").fill("Synthetic PIN recovery entry");
      await page.getByRole("button", { name: ko ? "기록" : "Save", exact: true }).click();
      await expect(page.getByText("Synthetic PIN recovery entry", { exact: true })).toBeVisible();
      await setupPin();

      const create = () => page.getByRole("button", { name: ko ? "복구 코드 만들기" : "Create recovery code", exact: true });
      await create().click();
      await expect(page.getByText(ko
        ? "복구 코드를 생성하려면 계정 설정에서 PIN 잠금을 먼저 해제해 주세요. 생성 후 PIN 잠금을 다시 설정할 수 있습니다."
        : "Remove the PIN lock in Account settings before creating a recovery code. You can set it up again afterwards.",
      { exact: true })).toBeVisible();
      await expect(page.locator(".recovery-code-panel")).toHaveCount(0);
      await page.reload();
      await unlock();
      await expect(page.getByText("Synthetic PIN recovery entry", { exact: true })).toBeVisible();

      await account().click();
      await page.getByRole("button", { name: ko ? "PIN 잠금 해제" : "Remove PIN Lock", exact: true }).click();
      await page.locator("#remove-pin-input").fill("123456");
      await page.getByRole("dialog", { name: ko ? "🔓 PIN 잠금 해제" : "🔓 Remove PIN Lock", exact: true })
        .getByRole("button", { name: ko ? "PIN 잠금 해제" : "Remove PIN Lock", exact: true }).click();
      await expect(page.locator("#pin-remove-title")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await create().click();
      await expect(page.locator(".recovery-code-panel")).toBeVisible();
      await setupPin();
    });
  });
}
