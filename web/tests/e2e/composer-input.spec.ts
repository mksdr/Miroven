import { test, expect } from "@playwright/test";

test("IME composition commits the latest Korean text before shortcut save", async ({ page, context }) => {
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await expect(composer).toBeEnabled();
  await composer.focus();
  const cdp = await context.newCDPSession(page);
  // Exercise Chromium's composition path, rather than filling a completed string.
  for (const text of ["ㅎ", "하", "한"]) {
    await cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    await expect(composer).toHaveValue(text);
  }
  await cdp.send("Input.insertText", { text: "한" });
  await composer.pressSequentially(" journal");
  await expect(composer).toHaveValue("한 journal");
  await composer.press("Control+Enter");
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("한 journal");
  await expect(composer).toHaveValue("");
  await cdp.detach();
});
