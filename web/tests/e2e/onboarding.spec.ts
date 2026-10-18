import { expect, test } from "@playwright/test";

test("first visit guides writing and shows storage advice only after saving", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "나만의 기록을 남기는 공간", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "복구 코드 만들기", exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath("welcome.png") });
  await page.getByRole("button", { name: "첫 기록 쓰기", exact: true }).click();
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await expect(composer).toBeFocused();
  await expect(page.getByRole("button", { name: "기록", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "첫 기록을 저장했어요" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "짧은 글이나 사진 한 장이면 충분해요" })).toBeVisible();
  await composer.fill("오늘은 첫 기록을 남겼다.");
  await composer.press("Control+Enter");
  await expect(page.locator(".entry")).toContainText("오늘은 첫 기록을 남겼다.");
  await expect(page.getByRole("heading", { name: "첫 기록을 저장했어요" })).toBeVisible();
  await expect(page.getByRole("button", { name: "복구 코드 만들기", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "첫 기록을 저장했어요" })).toBeVisible();
  await page.getByRole("button", { name: "나중에", exact: true }).click();
  await page.reload();
  await expect(page.locator(".entry")).toBeVisible();
  await expect(page.getByRole("heading", { name: "첫 기록을 저장했어요" })).toHaveCount(0);
});

test("existing local records suppress first-user guidance", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill("이미 사용 중인 저널");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".entry")).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("miroven:onboarding:v1"));
  await page.reload();
  await expect(page.locator(".entry")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("miroven:onboarding:v1"))).toBe("done");
  await expect(page.getByRole("region", { name: "나만의 기록을 남기는 공간" })).toHaveCount(0);
});

test("returning users can open Account and skip first-user guidance", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "기존 기록 이어서 사용하기", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "계정", exact: true })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "기존 기록 이어서 사용하기", exact: true })).toHaveCount(0);
});

for (const width of [390, 1440]) {
  test(`guide is reachable at ${width}px without losing the draft`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
    await composer.fill("문서를 읽는 동안 유지할 초안");
    await expect(page.locator(".left-rail").getByRole("link", { name: "사용 안내 (새 탭)", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "계정", exact: true }).click();
    await page.locator(".settings-notice-link").screenshot({ path: test.info().outputPath(`account-links-${width}.png`) });
    const popup = context.waitForEvent("page");
    await page.getByRole("dialog").getByRole("link", { name: "사용 안내 (새 탭)", exact: true }).click();
    const guide = await popup;
    await guide.setViewportSize({ width, height: 900 });
    await expect(guide).toHaveURL(/\/guide$/);
    await expect(guide.getByRole("heading", { name: "Miroven 사용 안내", exact: true })).toBeVisible();
    await guide.screenshot({ path: test.info().outputPath(`guide-${width}.png`) });
    await guide.getByRole("navigation").getByRole("link", { name: "4. 기록은 어디에 보관되나요?", exact: true }).click();
    await expect(guide).toHaveURL(/#storage$/);
    await expect(guide.locator("#storage")).toBeInViewport();
    await guide.getByText("복구 코드만 있으면 기록을 복원할 수 있나요?", { exact: true }).click();
    await expect(guide.getByText("복구 코드와 함께 서버에 동기화된 암호문 또는 암호화 백업 파일이 필요합니다.", { exact: false })).toBeVisible();
    expect(await guide.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await guide.getByRole("link", { name: "맨 위로 ↑" }).click();
    await guide.getByRole("button", { name: "English", exact: true }).click();
    await expect(guide.getByRole("heading", { name: "Miroven user guide", exact: true })).toBeVisible();
    await guide.reload();
    await expect(guide.getByRole("heading", { name: "Miroven user guide", exact: true })).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
    await expect(composer).toHaveValue("문서를 읽는 동안 유지할 초안");
    await guide.close();
  });
}
