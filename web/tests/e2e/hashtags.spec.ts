import { expect, test } from "@playwright/test";

test("hashtags search immediately from entries, quote cards, and original dialogs", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  const entries = page.locator(".entry-list > .entry");
  const search = page.getByRole("textbox", { name: "검색", exact: true });
  const original = entries.filter({ has: page.locator(".entry-content > .entry-text", { hasText: "첫 기록 #일상" }) });
  const quoted = entries.filter({ has: page.locator(".entry-content > .entry-text", { hasText: "인용 기록" }) });
  for (const text of ["첫 기록 #일상", "다른 기록 #여행"]) {
    await composer.fill(text);
    await page.getByRole("button", { name: "기록", exact: true }).click();
    await expect(entries.filter({ hasText: text })).toHaveCount(1);
  }

  await original.getByRole("button", { name: "#일상", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("#일상");
  await expect(search).toBeFocused();
  await expect(entries).toHaveCount(1);
  await expect(entries.first().locator(".entry-hashtag mark")).toHaveText("#일상");

  // A new tag search must replace the previous query.
  await search.fill("다른 기록");
  await expect(entries).toHaveCount(1);
  await page.getByRole("button", { name: "#여행", exact: true }).last().click();
  await expect(search).toHaveValue("#여행");
  await expect(entries).toHaveCount(1);

  await page.reload();
  await original.getByRole("button", { name: "인용", exact: true }).click();
  await composer.fill("인용 기록");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(quoted).toHaveCount(1);
  await quoted.locator(".quote-card").getByRole("button", { name: "#일상", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(search).toHaveValue("#일상");
  await expect(entries).toHaveCount(1);

  await page.reload();
  await quoted.getByRole("button", { name: "원문 보기", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "원문 보기", exact: true });
  await detail.getByRole("button", { name: "#일상", exact: true }).click();
  await expect(detail).toHaveCount(0);
  await expect(search).toHaveValue("#일상");
  await expect(search).toBeFocused();
  await expect(entries).toHaveCount(1);
});
