import { expect, test, type Page } from "@playwright/test";

const composer = (page: Page) => page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" });
const entries = (page: Page) => page.locator(".entry-list > .entry");
const entry = (page: Page, text: string) => entries(page).filter({ has: page.locator(".entry-content > .entry-text", { hasText: text }) });
async function save(page: Page, text: string) {
  await composer(page).fill(text);
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(entry(page, text)).toBeVisible();
}

test("quotes preserve drafts, restore quote-only drafts, and can save without new text", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await save(page, "과거의 기록");
  await composer(page).fill("지금의 생각");
  await entry(page, "과거의 기록").getByRole("button", { name: "인용", exact: true }).click();
  await expect(composer(page)).toHaveValue("지금의 생각");
  await expect(page.locator(".composer-quote")).toContainText("과거의 기록");
  await page.getByRole("button", { name: "기록", exact: true }).click();
  const quoted = entry(page, "지금의 생각");
  await expect(quoted.locator(".quote-card")).toContainText("과거의 기록");
  await page.reload();
  await expect(quoted.locator(".quote-card")).toBeVisible();
  await expect(page.locator(".composer-quote")).toHaveCount(0);
  await quoted.getByRole("button", { name: "원문 보기", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "원문 보기", exact: true });
  await expect(detail.locator(".entry-text")).toHaveText("과거의 기록");
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  await expect(quoted.getByRole("button", { name: "원문 보기", exact: true })).toBeFocused();
  await entry(page, "과거의 기록").getByRole("button", { name: "인용", exact: true }).click();
  await expect(composer(page)).toHaveValue("");
  // Wait for the encrypted quote-only draft rather than a fixed autosave delay.
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open("private-journal"); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<boolean>((resolve) => { const request = db.transaction("device-keys").objectStore("device-keys").get("miroven-composer-draft"); request.onsuccess = () => resolve(!!request.result?.ciphertext); }); }
    finally { db.close(); }
  })).toBe(true);
  await page.reload();
  await expect(page.locator(".composer-quote")).toContainText("과거의 기록");
  await expect(composer(page)).toHaveValue("");
  await expect(page.getByRole("button", { name: "기록", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await expect(entries(page)).toHaveCount(3);
  await expect(page.locator(".composer-quote")).toHaveCount(0);
  await entries(page).first().getByRole("button", { name: "기록 수정", exact: true }).click();
  await page.getByRole("button", { name: "인용 해제", exact: true }).click();
  await expect(page.getByRole("button", { name: "수정 저장", exact: true })).toBeDisabled();
  await composer(page).fill("인용을 해제한 기록");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(entry(page, "인용을 해제한 기록").locator(".quote-card")).toHaveCount(0);
});

test("live originals update, delete safely, and nested quotes open one at a time from search", async ({ page }) => {
  await page.goto("/");
  await save(page, "처음의 기록");
  await entry(page, "처음의 기록").getByRole("button", { name: "인용", exact: true }).click();
  await save(page, "두 번째 생각");
  await entry(page, "두 번째 생각").getByRole("button", { name: "인용", exact: true }).click();
  await save(page, "세 번째 생각");
  await expect(entry(page, "세 번째 생각").locator(".quote-card-note")).toHaveText("이 기록에도 인용이 있습니다.");
  await expect(entry(page, "세 번째 생각").locator(".quote-card")).toHaveCount(1);
  await entry(page, "처음의 기록").getByRole("button", { name: "기록 수정", exact: true }).click();
  await composer(page).fill("수정한 원문");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(entry(page, "두 번째 생각").locator(".quote-card-text")).toHaveText("수정한 원문");
  await composer(page).press("Control+k");
  await page.getByRole("textbox", { name: "검색", exact: true }).fill("세 번째 생각");
  await expect(entries(page)).toHaveCount(1);
  await entries(page).first().getByRole("button", { name: "원문 보기", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "원문 보기", exact: true });
  await expect(detail.locator(".entry-detail-body > .entry-text")).toHaveText("두 번째 생각");
  await detail.getByRole("button", { name: "원문 보기", exact: true }).click();
  await expect(detail.locator(".entry-detail-body > .entry-text")).toHaveText("수정한 원문");
  await detail.getByRole("button", { name: "이전 기록으로" }).click();
  await expect(detail.locator(".entry-detail-body > .entry-text")).toHaveText("두 번째 생각");
  await page.keyboard.press("Escape");
  await entries(page).first().getByRole("button", { name: "인용", exact: true }).click();
  await expect(page.locator(".composer-quote")).toContainText("세 번째 생각");
  await page.getByRole("button", { name: "인용 해제", exact: true }).click();
  await entry(page, "수정한 원문").getByRole("button", { name: "기록 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await expect(entry(page, "두 번째 생각").locator(".quote-card")).toContainText("삭제된 기록입니다.");
  await page.reload();
  await expect(entry(page, "두 번째 생각").locator(".quote-card")).toContainText("삭제된 기록입니다.");
});

test("long text and photos have compact accessible previews on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 741 });
  await page.goto("/");
  const longText = Array.from({ length: 10 }, (_, index) => `긴 기록 ${index} — 한 줄씩 이어지는 과거의 생각입니다.`).join("\n");
  await save(page, longText);
  await entries(page).first().getByRole("button", { name: "인용", exact: true }).click();
  const preview = page.locator(".composer-quote .quote-card-text");
  expect(await preview.evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("4");
  expect(await preview.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await page.locator(".composer-quote").getByRole("button", { name: "원문 보기", exact: true }).click();
  const longDetail = page.getByRole("dialog", { name: "원문 보기", exact: true });
  await expect(longDetail).toBeVisible();
  const checkDialogBounds = async () => {
    const bounds = await longDetail.evaluate((el) => {
      const rect = el.getBoundingClientRect(), css = getComputedStyle(el);
      return { left: rect.left, right: window.innerWidth - rect.right,
        top: rect.top, bottom: window.innerHeight - rect.bottom,
        bottomLeft: parseFloat(css.borderBottomLeftRadius), bottomRight: parseFloat(css.borderBottomRightRadius) };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(11);
    expect(bounds.right).toBeGreaterThanOrEqual(11);
    expect(bounds.top).toBeGreaterThanOrEqual(11);
    expect(bounds.bottom).toBeGreaterThanOrEqual(11);
    expect(bounds.bottomLeft).toBe(20);
    expect(bounds.bottomRight).toBe(20);
  };
  await checkDialogBounds();
  await page.setViewportSize({ width: 393, height: 500 });
  await checkDialogBounds();
  await longDetail.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await longDetail.evaluate((el) => {
    const text = el.querySelector(".entry-text")!.getBoundingClientRect();
    return text.bottom <= el.getBoundingClientRect().bottom;
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("original-mobile-dialog.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 393, height: 741 });
  await page.getByRole("button", { name: "인용 해제", exact: true }).click();
  await composer(page).fill("사진이 있는 기록");
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 200;
    const context = canvas.getContext("2d")!; context.fillStyle = "#79ad94"; context.fillRect(0, 0, 320, 200);
    return canvas.toDataURL("image/png").split(",")[1];
  }), "base64");
  await page.getByLabel("사진", { exact: true }).setInputFiles([
    { name: "first.png", mimeType: "image/png", buffer: png }, { name: "second.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.locator(".image-preview img")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "기록", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "기록", exact: true }).click();
  await entry(page, "사진이 있는 기록").getByRole("button", { name: "인용", exact: true }).click();
  await expect(page.locator(".composer-quote .quote-photo img")).toHaveCount(1);
  await expect(page.locator(".composer-quote .quote-photo-count")).toHaveText("+1");
  expect(await page.locator(".composer-quote .quote-photo").evaluate((el) => el.getBoundingClientRect().height)).toBe(120);
  expect(await page.locator(".composer-quote .quote-card-text").evaluate((el) => getComputedStyle(el).webkitLineClamp)).toBe("2");
  await page.screenshot({ path: test.info().outputPath("quote-mobile.png"), fullPage: true });
  await page.locator(".composer-quote").getByRole("button", { name: "원문 보기", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "원문 보기", exact: true });
  await expect(detail.locator(".entry-image")).toHaveCount(2);
  await detail.getByRole("button", { name: "사진 원본 확대해 보기 1", exact: true }).click();
  await expect(detail.getByRole("dialog", { name: "사진 확대보기", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(detail).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
