import { expect, test } from "@playwright/test";

test("initial notices are committed before the composer accepts its first entry", async ({ page }) => {
  // Model a busy task queue after the local journal opens. Optional zero-delay
  // UI tasks must not insert a notice above an already interactive composer.
  await page.addInitScript(() => {
    const schedule = window.setTimeout.bind(window);
    window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 0 && document.querySelector(".empty-state h2")?.textContent === "첫 기록을 남겨보세요") {
        return 0;
      }
      return schedule(callback, delay, ...args);
    }) as typeof window.setTimeout;
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await composer.fill("초기 안내와 함께 저장한 첫 기록");
  await expect(page.getByRole("heading", { name: "나만의 기록을 남기는 공간", exact: true })).toBeVisible();
  if (await page.evaluate(() => /iPhone|iPad|iPod/i.test(navigator.userAgent))) {
    await expect(page.getByRole("region", { name: "iOS Safari 안내", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("초기 안내와 함께 저장한 첫 기록");
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue("");
  await expect(page.getByRole("heading", { name: "첫 기록을 저장했어요", exact: true })).toBeVisible();
});

for (const preference of ["dismissed", "unavailable"] as const) {
  test(`local writing starts when notice preferences are ${preference}`, async ({ page }) => {
    await page.addInitScript((preference) => {
      if (preference === "dismissed") {
        localStorage.setItem("miroven:onboarding:v1", "done");
        localStorage.setItem("miroven:ios_pwa_prompt_dismissed", "true");
      } else {
        const read = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (key === "miroven:onboarding:v1" || key === "miroven:ios_pwa_prompt_dismissed") {
            throw new DOMException("Synthetic preference read failure", "SecurityError");
          }
          return read.call(this, key);
        };
      }
    }, preference);
    await page.goto("/");
    const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
    await composer.fill("환경 설정과 무관한 로컬 기록");
    await page.getByRole("button", { name: "기록", exact: true }).click();
    await expect(page.locator(".entry-content > .entry-text")).toHaveText("환경 설정과 무관한 로컬 기록");
    await expect(composer).toBeEnabled();
  });
}

test("editing moves directly to the composer even with normal motion enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("miroven:onboarding:v1", "done");
    localStorage.setItem("miroven:low_spec_mode", "false");
    const scroll = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      if (this.id === "composer") Object.assign(window, { composerScroll: options });
      return scroll.call(this, options);
    };
  });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
  await composer.fill(Array.from({ length: 30 }, (_, i) => `수정할 긴 원문 ${i}`).join("\n"));
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(page.locator(".entry")).toBeVisible();
  await page.getByRole("button", { name: "기록 수정", exact: true }).click();
  // An animated edit jump can keep moving controls during the next click.
  expect(await page.evaluate(() => (window as unknown as { composerScroll: unknown }).composerScroll)).toEqual({ behavior: "instant" });
  await composer.fill("이동 직후 수정한 기록");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.locator(".entry-content > .entry-text")).toHaveText("이동 직후 수정한 기록");
});
