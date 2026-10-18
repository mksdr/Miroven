import { expect, test } from "@playwright/test";

for (const width of [390, 900, 1440]) {
  test(`persona editing, image bounds and cancel at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    const trigger = width <= 680 ? page.locator(".persona-composer-button") : page.locator(".rail-profile");
    await expect(page.locator(".composer textarea")).toBeEnabled();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "프로필 편집" });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await dialog.getByLabel("표시 이름").fill("기록하는 나");
    await dialog.getByLabel("Bio").fill("오늘도 기록합니다.");
    await dialog.getByRole("textbox", { name: "ID", exact: true }).fill("my_diary");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 400;
      canvas.getContext("2d")!.fillRect(0, 0, 800, 400);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await dialog.locator('input[type="file"]').setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await expect(dialog.locator(".persona-avatar img")).toBeVisible();
    const size = await dialog.locator(".persona-avatar img").evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight]);
    expect(size).toEqual([100, 50]);
    await page.screenshot({ path: testInfo.outputPath("persona-editor.png"), animations: "disabled" });
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.locator(".composer textarea").fill("프로필 확인용 기록");
    await page.getByRole("button", { name: "기록", exact: true }).click();
    await expect(page.locator(".entry-author")).toContainText("기록하는 나");
    await expect(page.locator(".entry-author")).toContainText("@my_diary");
    await expect(page.locator(".entry")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(".entry-author")).toContainText("기록하는 나");
    await expect(page.locator(".entry .avatar img")).toBeVisible();
    await trigger.click();
    await expect(dialog.getByLabel("Bio")).toHaveValue("오늘도 기록합니다.");
    await dialog.getByLabel("표시 이름").fill("취소할 이름");
    await page.keyboard.press("Escape");
    await expect(dialog.getByText("저장하지 않은 변경사항을 버릴까요?")).toBeVisible();
    await dialog.getByRole("button", { name: "버리기", exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.locator(".entry-author")).toContainText("기록하는 나");
    await trigger.click();
    await dialog.getByRole("button", { name: "이미지 초기화" }).click();
    await dialog.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.locator(".entry .avatar img")).toHaveCount(0);
  });
}
