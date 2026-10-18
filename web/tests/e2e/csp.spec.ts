import { expect, test } from "@playwright/test";

test("page CSPs allow hydration, extracted license scripts, and 404 responses", async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /CSP violation:|Content Security Policy|hydration/i.test(message.text())) errors.push(message.text());
  });
  for (const route of ["/", "/guide", "/notice", "/missing-csp-page"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(route === "/missing-csp-page" ? 404 : 200);
    await expect(page.locator("h1").first()).toBeAttached();
    await page.waitForFunction(() => Boolean((window as Window & { next?: unknown }).next));
    if (route === "/notice") {
      expect(await page.locator('script[src^="/_next/static/csp/"]').count()).toBeGreaterThan(0);
      // A working Next Link returns to an interactive journal after hydration.
      await page.getByRole("link", { name: "Miroven 메인 페이지로" }).click();
      await expect(page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" })).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
