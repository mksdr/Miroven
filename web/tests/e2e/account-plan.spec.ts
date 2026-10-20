import { expect, test, type Page } from "@playwright/test";
import type { AccountUsage } from "../../app/lib/remote/account";

// Build with NEXT_PUBLIC_MIROVEN_API_URL=/api/v1, then set MIROVEN_PLAN_UI_TEST=1.
// These synthetic responses exercise the UI, independently of real API integration.
test.skip(!process.env.MIROVEN_PLAN_UI_TEST, "Requires the API-configured plan UI test build.");

const userId = "00000000-0000-4000-8000-000000000002";
const free: AccountUsage = {
  plan: "free", subscription_status: "active", current_period_end: null, cancel_at_period_end: false,
  storage_bytes: 2 * 1024 ** 2, storage_limit_bytes: 100 * 1024 ** 2,
  entries: 7, entry_limit: 10000, blob_max_bytes: 4 * 1024 ** 2,
};

async function mockAccount(page: Page, response: () => { usage: AccountUsage; status?: number }) {
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session")) {
      return route.fulfill({ json: { user_id: userId, email: "plan-test@example.com", csrf_token: "synthetic-csrf" } });
    }
    if (path.endsWith("/account/usage")) {
      expect(route.request().headers()["x-miroven-user-id"]).toBe(userId);
      const { usage, status = 200 } = response();
      return route.fulfill({ status, json: status === 200 ? usage : { code: "unavailable" } });
    }
    if (path.endsWith("/auth/logout")) return route.fulfill({ status: 204 });
    if (path.endsWith("/vault")) return route.fulfill({ status: 404, json: { code: "vault_not_found" } });
    return route.fulfill({ status: 404, json: { code: "not_found" } });
  });
}

test("refreshes Free to Pro and reflects expiry, server quotas, retry and logout", async ({ page }) => {
  let usage = free;
  let status = 200;
  await mockAccount(page, () => ({ usage, status }));
  await page.goto("/");
  await page.getByRole("button", { name: "계정", exact: true }).click();
  const card = page.getByLabel("서버 사용량", { exact: true });
  const plan = card.getByLabel("현재 플랜", { exact: true });
  await expect(plan).toContainText("Free");
  await expect(card).toContainText("2 / 100 MiB");

  usage = { ...free, plan: "pro", subscription_status: "trialing", cancel_at_period_end: true,
    current_period_end: "2099-11-01T00:00:00Z", storage_limit_bytes: 512 * 1024 ** 2,
    entry_limit: 25000, blob_max_bytes: 8 * 1024 ** 2 };
  await card.getByRole("button", { name: "플랜·사용량 새로고침" }).click();
  await expect(plan).toContainText("Pro");
  await expect(plan).toContainText("체험 중");
  await expect(plan).toContainText("Free 플랜으로 전환됩니다.");
  await expect(card).toContainText("2 / 512 MiB");
  await expect(card).toContainText("기록 7 / 25,000개 · 파일당 8 MiB");

  status = 503;
  await card.getByRole("button", { name: "플랜·사용량 새로고침" }).click();
  await expect(page.getByText("플랜과 서버 사용량을 불러오지 못했습니다.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("현재 플랜", { exact: true })).toHaveCount(0);
  status = 200;
  usage = { ...free, subscription_status: "expired", current_period_end: "2026-10-01T00:00:00Z" };
  await page.getByRole("button", { name: "플랜·사용량 다시 확인" }).click();
  await expect(plan).toContainText("Free");
  await expect(plan).toContainText("만료일:");
  await expect(plan).not.toContainText("Pro");
  await page.getByRole("button", { name: "이 기기에서 로그아웃", exact: true }).click();
  await expect(page.getByLabel("현재 플랜", { exact: true })).toHaveCount(0);
});

test("shows English canceled Pro on mobile until the server ends access", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("miroven-language", "en"));
  await mockAccount(page, () => ({ usage: { ...free, plan: "pro", subscription_status: "canceled", current_period_end: "2099-11-01T00:00:00Z" } }));
  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const plan = page.getByLabel("Current plan", { exact: true });
  await expect(plan).toContainText("Pro");
  await expect(plan).toContainText("Canceled");
  await expect(plan).toContainText("Access ends:");
  await expect(plan.locator("time")).toHaveAttribute("datetime", "2099-11-01T00:00:00Z");
  const bounds = await plan.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/account-plan-mobile.png", fullPage: true });
});

test("supports a legacy usage response and reloads on reopening Account", async ({ page }) => {
  const legacy = { storage_bytes: free.storage_bytes, storage_limit_bytes: free.storage_limit_bytes,
    entries: free.entries, entry_limit: free.entry_limit, blob_max_bytes: free.blob_max_bytes };
  let usage = legacy as AccountUsage;
  await mockAccount(page, () => ({ usage }));
  await page.goto("/");
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByLabel("현재 플랜", { exact: true })).toContainText("Free");
  await page.keyboard.press("Escape");
  usage = { ...free, plan: "pro", subscription_status: "past_due" };
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.getByLabel("현재 플랜", { exact: true })).toContainText("Pro");
  await expect(page.getByLabel("현재 플랜", { exact: true })).toContainText("결제 지연");
});
