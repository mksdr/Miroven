import { expect, test, type Page } from "@playwright/test";

// Build with NEXT_PUBLIC_MIROVEN_API_URL=/api/v1 and set MIROVEN_AUTH_POLICY_UI_TEST=1.
test.skip(!process.env.MIROVEN_AUTH_POLICY_UI_TEST, "Requires an API-configured auth policy UI test build.");

async function mockAuth(page: Page, policyStatus = 200) {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/policy")) return route.fulfill({ status: policyStatus, json: {
      domain_groups: { DEFAULT: ["gmail.com"], KR: ["naver.com"], JP: ["yahoo.co.jp"] },
      default_email_locale: "en", existing_accounts_allowed: true,
      blocked_local_part_characters: ["+", "."],
    } });
    if (path.endsWith("/auth/code/request")) return route.fulfill({ status: 202, json: {} });
    return route.fulfill({ status: 401, json: { code: "unauthenticated" } });
  });
}

test("shows Korean domain guidance and permits existing accounts to request a code", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAuth(page);
  await page.goto("/");
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByText("가입 가능한 이메일 도메인", { exact: true }).click();
  await expect(page.getByText("gmail.com, naver.com, yahoo.co.jp", { exact: true })).toBeVisible();
  await page.getByLabel("이메일로 시작하기", { exact: true }).fill("existing@unlisted.com");
  await expect(page.locator(".auth-form").getByRole("status")).toContainText("이 도메인으로는 신규 가입할 수 없습니다.");
  const send = page.getByRole("button", { name: "6자리 로그인 코드 받기", exact: true });
  await expect(send).toBeEnabled();
  await page.screenshot({ path: "test-results/auth-policy-mobile.png", fullPage: true });
  const request = page.waitForRequest("**/auth/code/request");
  await send.click();
  expect((await request).postDataJSON()).toEqual({ email: "existing@unlisted.com" });
  await expect(page.getByLabel("보안 코드", { exact: true })).toBeVisible();
});

test("shows English guidance and accepts uppercase supported domains", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("miroven-language", "en"));
  await mockAuth(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByText("Supported signup email domains", { exact: true })).toBeVisible();
  await page.getByLabel("Continue with email", { exact: true }).fill("synthetic@NAVER.COM");
  await expect(page.locator(".auth-form").getByRole("status")).toContainText("New accounts require a supported email domain.");
  await page.getByLabel("Continue with email", { exact: true }).fill("existing@unlisted.com");
  await expect(page.locator(".auth-form").getByRole("status")).toContainText("Existing accounts can still sign in.");
});

test("policy lookup failure preserves sign-in and generic guidance", async ({ page }) => {
  await mockAuth(page, 404);
  await page.goto("/");
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await expect(page.locator(".auth-form").getByRole("status")).toContainText("기존 계정은 계속 로그인할 수 있습니다.");
  await page.getByLabel("이메일로 시작하기", { exact: true }).fill("synthetic@gmail.com");
  await page.getByRole("button", { name: "6자리 로그인 코드 받기", exact: true }).click();
  await expect(page.getByLabel("보안 코드", { exact: true })).toBeVisible();
});

for (const language of ["ko", "en"] as const) {
  test(`warns about plus/dot in ${language} without locking existing accounts out`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("miroven-language", value), language);
    await mockAuth(page);
    await page.goto("/");
    await page.getByRole("button", { name: language === "ko" ? "계정" : "Account", exact: true }).click();
    const emailInput = page.getByLabel(language === "ko" ? "이메일로 시작하기" : "Continue with email", { exact: true });
    const send = page.getByRole("button", { name: language === "ko" ? "6자리 로그인 코드 받기" : "Send six-digit sign-in code", exact: true });
    for (const email of ["existing+tag@gmail.com", "existing.name@gmail.com"]) {
      await emailInput.fill(email);
      await expect(page.locator(".auth-form").getByRole("status")).toContainText(language === "ko"
        ? "이메일의 @ 앞부분에 + 또는 .이 있으면 신규 가입할 수 없습니다."
        : "New accounts cannot use + or . before @.");
      await expect(send).toBeEnabled();
    }
    const request = page.waitForRequest("**/auth/code/request");
    await send.click();
    expect((await request).postDataJSON()).toEqual({ email: "existing.name@gmail.com" });
  });
}
