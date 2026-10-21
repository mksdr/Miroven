import { expect, test } from "@playwright/test";

test.describe("Keyboard Accessibility (A11y) Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("내 저널", { exact: true })).toBeVisible();
    // The static save button is disabled too; an enabled editor signals that
    // hydration and the initial local journal read have finished.
    await expect(page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "기록", exact: true })).toBeDisabled();
  });

  test("Skip to main content link becomes visible on Tab", async ({ page }) => {
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: /본문 콘텐츠로 바로가기|Skip to main content/i });
    await expect(skipLink).toBeFocused();
  });

  test("Pressing ? opens Keyboard Shortcuts Modal and Esc closes it", async ({ page }) => {
    await page.keyboard.press("?");
    const modalTitle = page.getByRole("heading", { name: /키보드 단축키 안내|Keyboard Shortcuts/i });
    await expect(modalTitle).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(modalTitle).not.toBeVisible();
  });

  test("Shortcut 'n' focuses composer and Ctrl+Enter submits post", async ({ page }) => {
    await page.keyboard.press("n");
    const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
    await expect(composer).toBeFocused();

    const postText = "키보드 단축키로 작성된 글 " + Date.now();
    await composer.fill(postText);

    await page.keyboard.press("Control+Enter");
    await expect(page.getByText(postText)).toBeVisible();
  });

  test("Shortcut 'Ctrl+K' or '/' focuses search input", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.locator("#search-section")).toBeVisible();
    await expect(page.getByRole("button", { name: "이번 주", exact: true })).toBeVisible();
    const searchInput = page.getByRole("textbox", { name: "검색" });
    await expect(searchInput).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(searchInput).not.toBeFocused();
  });
});
