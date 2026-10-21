import { expect, test, type Page } from "@playwright/test";

const origin = process.env.MIROVEN_INTEGRATION_URL;
const apiOrigin = process.env.MIROVEN_INTEGRATION_API_ORIGIN ?? origin;
const mailpit = process.env.MIROVEN_MAILPIT_URL ?? "http://localhost:8025";
test.skip(!origin, "Start the combined Docker stack and set MIROVEN_INTEGRATION_URL.");
test.setTimeout(180_000);

async function signIn(page: Page, email: string, previousMessage?: string) {
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByLabel("이메일로 시작하기", { exact: true }).fill(email);
  await page.getByRole("button", { name: "6자리 로그인 코드 받기", exact: true }).click();
  let code = "";
  let messageId = "";
  await expect.poll(async () => {
    const response = await page.request.get(`${mailpit}/api/v1/messages`);
    const result = await response.json();
    const message = result.messages.find((item: { ID: string; To: { Address: string }[] }) =>
      item.ID !== previousMessage && item.To.some(to => to.Address === email));
    if (!message) return false;
    const detail = await (await page.request.get(`${mailpit}/api/v1/message/${message.ID}`)).json();
    code = detail.Text.match(/\b[0-9]{6}\b/)?.[0] ?? "";
    messageId = message.ID;
    return Boolean(code);
  }, { timeout: 20_000 }).toBe(true);
  await page.getByLabel("보안 코드", { exact: true }).fill(code);
  await page.getByRole("button", { name: "보안 코드로 로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "이 기기에서 로그아웃", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  return messageId;
}

async function sync(page: Page, expected = "동기화 완료") {
  await page.getByRole("button", { name: "계정", exact: true }).click();
  await page.getByRole("button", { name: "지금 동기화", exact: true }).click();
  await expect(page.locator(".account-session")).toContainText(expected, { timeout: 15_000 });
  await page.keyboard.press("Escape");
}

async function editProfile(page: Page, name: string, avatar?: string) {
  await page.locator(".rail-profile").click();
  const dialog = page.getByRole("dialog", { name: "프로필 편집" });
  await dialog.getByLabel("표시 이름").fill(name);
  await dialog.getByRole("textbox", { name: "ID", exact: true }).fill("private_profile");
  await dialog.getByLabel("Bio").fill("암호화된 프로필 소개");
  if (avatar) {
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "profile.png", mimeType: "image/png", buffer: Buffer.from(avatar, "base64"),
    });
    await expect(dialog.locator(".persona-avatar img")).toBeVisible();
  }
  await dialog.getByRole("button", { name: "저장", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".rail-profile strong")).toHaveText(name);
}

test("signup domain policy and English, Korean, Japanese SMTP codes", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const policyResponse = await page.request.get(`${apiOrigin}/api/v1/auth/policy`);
    expect(policyResponse.status()).toBe(200);
    const policy = await policyResponse.json();
    expect(policy.default_email_locale).toBe("en");
    expect(policy.blocked_local_part_characters).toEqual(["+", "."]);
    for (const [group, subject] of [
      ["DEFAULT", "Your Miroven verification code"],
      ["KR", "Miroven 인증 코드"],
      ["JP", "Miroven 認証コード"],
    ]) {
      const domain = policy.domain_groups[group][0];
      expect(domain).toBeTruthy();
      const email = `locale-${crypto.randomUUID()}@${domain}`;
      const requested = await page.request.post(`${apiOrigin}/api/v1/auth/code/request`, {
        headers: { Origin: new URL(origin!).origin }, data: { email },
      });
      expect(requested.status()).toBe(202);
      let code = "";
      await expect.poll(async () => {
        const result = await (await page.request.get(`${mailpit}/api/v1/messages`)).json();
        const message = result.messages.find((item: { ID: string; To: { Address: string }[] }) =>
          item.To.some(to => to.Address === email));
        if (!message) return false;
        const detail = await (await page.request.get(`${mailpit}/api/v1/message/${message.ID}`)).json();
        expect(detail.Subject).toBe(subject);
        expect(detail.Text).toContain("UTC");
        code = detail.Text.match(/\b[0-9]{6}\b/)?.[0] ?? "";
        return Boolean(code);
      }, { timeout: 20_000 }).toBe(true);
      const verified = await page.request.post(`${apiOrigin}/api/v1/auth/code/verify`, {
        headers: { Origin: new URL(origin!).origin }, data: { email, code },
      });
      expect(verified.status()).toBe(200);
    }
    const email = `blocked-${crypto.randomUUID()}@${policy.domain_groups.DEFAULT[0]}.unlisted.com`;
    expect((await page.request.post(`${apiOrigin}/api/v1/auth/code/request`, {
      headers: { Origin: new URL(origin!).origin }, data: { email },
    })).status()).toBe(202);
    expect((await page.request.post(`${apiOrigin}/api/v1/auth/code/verify`, {
      headers: { Origin: new URL(origin!).origin }, data: { email, code: "012345" },
    })).status()).toBe(401);
    const inbox = await (await page.request.get(`${mailpit}/api/v1/messages`)).json();
    expect(inbox.messages.some((item: { To: { Address: string }[] }) =>
      item.To.some(to => to.Address === email))).toBe(false);
  } finally { await context.close(); }
});

test("plus and dot signup restrictions are shown and enforced through the real API", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ko-KR" });
  try {
    const page = await context.newPage();
    await page.goto(origin!);
    await page.getByRole("button", { name: "계정", exact: true }).click();
    const prefix = `restricted-${crypto.randomUUID()}`;
    for (const email of [`${prefix}+tag@example.com`, `${prefix}.name@example.com`]) {
      await page.getByLabel("이메일로 시작하기", { exact: true }).fill(email);
      await expect(page.locator(".auth-form").getByRole("status")).toContainText("이메일의 @ 앞부분에 + 또는 .이 있으면 신규 가입할 수 없습니다.");
      // Existing addresses can request codes; the server decides eligibility.
      await page.getByRole("button", { name: "6자리 로그인 코드 받기", exact: true }).click();
      await expect(page.getByLabel("보안 코드", { exact: true })).toBeVisible();
      const response = await page.request.post(`${apiOrigin}/api/v1/auth/code/verify`, {
        headers: { Origin: new URL(origin!).origin }, data: { email, code: "012345" },
      });
      expect(response.status()).toBe(401);
      expect((await response.json()).code).toBe("invalid_code");
      const inbox = await (await page.request.get(`${mailpit}/api/v1/messages`)).json();
      expect(inbox.messages.some((item: { To: { Address: string }[] }) =>
        item.To.some(to => to.Address === email))).toBe(false);
      await page.getByRole("button", { name: "이메일 변경 / 보안 코드 다시 받기", exact: true }).click();
    }
  } finally { await context.close(); }
});

test("email sign-in, profile/photo sync, recovery, offline retry and tombstone across two browsers", async ({ browser }) => {
  const a = await browser.newContext({ locale: "ko-KR" });
  const b = await browser.newContext({ locale: "ko-KR" });
  try {
    const first = await a.newPage();
    const second = await b.newPage();
    const email = `browser-${crypto.randomUUID()}@example.com`;
    const bodies: string[] = [];
    const violations: string[] = [];
    for (const page of [first, second]) {
      page.on("request", request => { if (request.url().includes("/api/") && request.postData()) bodies.push(request.postData()!); });
      page.on("console", message => { if (/Content Security Policy|Refused to/.test(message.text())) violations.push(message.text()); });
    }
    await first.goto(origin!);
    const avatar = await first.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 128;
      canvas.getContext("2d")!.fillRect(0, 0, 256, 128);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    // A profile written before sign-in must join the recovery-enabled Outbox.
    await editProfile(first, "첫 기기 프로필", avatar);
    const requestedAt = Date.now();
    const messageId = await signIn(first, email);
    await first.getByRole("button", { name: "복구 코드 만들기", exact: true }).click();
    const code = await first.locator(".recovery-code-panel code").innerText();
    await first.getByRole("button", { name: "안전하게 보관했습니다", exact: true }).click();
    const text = `비공개 사진 일기 ${crypto.randomUUID()}`;
    const png = await first.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16; canvas.height = 16;
      canvas.getContext("2d")!.fillRect(0, 0, 16, 16);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await first.locator('.photo-button input[type="file"]').setInputFiles({
      name: "pixel.png", mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await expect(first.locator(".image-preview img")).toBeVisible();
    await first.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(text);
    await first.getByRole("button", { name: "기록", exact: true }).click();
    await sync(first);
    // Respect the production resend cooldown; the second browser signs in separately.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, requestedAt + 61_000 - Date.now())));
    await second.goto(origin!);
    await signIn(second, email, messageId);
    await expect(second.getByText(text, { exact: true })).toHaveCount(0);
    await second.getByRole("textbox", { name: "복구 코드", exact: true }).fill(code);
    await second.getByRole("button", { name: "이 기기에서 복구", exact: true }).click();
    await expect(second.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(second.locator(".rail-profile strong")).toHaveText("첫 기기 프로필");
    await expect(second.locator(".profile-copy")).toContainText("@private_profile");
    await second.locator(".rail-profile img").evaluate((img: HTMLImageElement) => img.decode());
    expect(await second.locator(".rail-profile img").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight])).toEqual([100, 50]);
    await second.locator(".rail-profile").click();
    await expect(second.getByRole("dialog", { name: "프로필 편집" }).getByLabel("Bio")).toHaveValue("암호화된 프로필 소개");
    await second.keyboard.press("Escape");
    await second.locator(".entry-image-shell").scrollIntoViewIfNeeded();
    await expect(second.locator(".entry-image")).toBeVisible();
    await second.locator(".entry-image").evaluate((img: HTMLImageElement) => img.decode());
    expect(await second.locator(".entry-image").getAttribute("src")).toMatch(/^data:image\/webp;base64,/);
    await b.setOffline(true);
    await editProfile(second, "오프라인 프로필");
    const offline = `오프라인 기록 ${crypto.randomUUID()}`;
    await second.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(offline);
    await second.getByRole("button", { name: "기록", exact: true }).click();
    await expect(second.getByText(offline, { exact: true })).toBeVisible();
    await b.setOffline(false);
    await sync(second);
    await sync(first);
    await expect(first.getByText(offline, { exact: true })).toBeVisible();
    await expect(first.locator(".rail-profile strong")).toHaveText("오프라인 프로필");
    await a.setOffline(true);
    await b.setOffline(true);
    await editProfile(first, "먼저 저장한 프로필");
    await editProfile(second, "다른 기기 프로필");
    const winning = "먼저 저장된 수정";
    const preserved = "보존할 다른 기기의 수정";
    for (const [page, value] of [[first, winning], [second, preserved]] as const) {
      await page.locator("article").filter({ has: page.getByText(offline, { exact: true }) })
        .getByRole("button", { name: "기록 수정", exact: true }).click();
      await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(value);
      await page.getByRole("button", { name: "수정 저장", exact: true }).click();
    }
    await a.setOffline(false);
    await sync(first);
    await b.setOffline(false);
    await sync(second, "충돌 기록 보존됨");
    await expect(second.getByText(preserved, { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "복사본으로 둘 다 보존", exact: true }).click();
    await second.locator(".rail-profile").click();
    await second.getByRole("button", { name: "다른 기기 버전 사용", exact: true }).click();
    await sync(second);
    await sync(first);
    for (const page of [first, second]) {
      await expect(page.locator(".rail-profile strong")).toHaveText("먼저 저장한 프로필");
      await expect(page.getByText(winning, { exact: true })).toBeVisible();
      await expect(page.getByText(`${preserved} (사본)`, { exact: true })).toBeVisible();
    }
    const photoEntry = first.locator("article").filter({ has: first.getByText(text, { exact: true }) });
    await photoEntry.getByRole("button", { name: "기록 삭제", exact: true }).click();
    await first.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
    await sync(first);
    await sync(second);
    await expect(second.getByText(text, { exact: true })).toHaveCount(0);
    await second.reload();
    await expect(second.getByText(`${preserved} (사본)`, { exact: true })).toBeVisible();
    await expect(second.locator(".entry")).toHaveCount(2);
    const usage = await (await second.request.get(`${apiOrigin}/api/v1/account/usage`)).json();
    expect(usage.entries).toBe(3); // Two current entries plus a tombstone, without the profile.
    const cached = await second.evaluate(async () => {
      const requests = await Promise.all((await caches.keys()).map(async key => (await caches.open(key)).keys()));
      return requests.flat().map(request => new URL(request.url).pathname);
    });
    expect(cached.some(path => path.startsWith("/api/"))).toBe(false);
    await second.getByRole("button", { name: "계정", exact: true }).click();
    await expect(second.getByLabel("서버 사용량", { exact: true })).toBeVisible();
    await second.getByRole("button", { name: "모든 기기에서 로그아웃", exact: true }).click();
    await expect(second.getByLabel("이메일로 시작하기", { exact: true })).toBeVisible();
    expect((await second.request.get(`${apiOrigin}/api/v1/auth/session`)).status()).toBe(401);
    expect((await first.request.get(`${apiOrigin}/api/v1/auth/session`)).status()).toBe(401);
    expect(bodies.every(body => !body.includes(text) && !body.includes(offline) && !body.includes(code))).toBe(true);
    for (const value of ["첫 기기 프로필", "오프라인 프로필", "먼저 저장한 프로필", "다른 기기 프로필", "암호화된 프로필 소개", "private_profile"]) {
      expect(bodies.every(body => !body.includes(value))).toBe(true);
    }
    expect(violations).toEqual([]);
  } finally { await a.close(); await b.close(); }
});

test("fresh-code account deletion preserves failed attempts and resumes its receipt after reload", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ko-KR" });
  try {
    const page = await context.newPage();
    const email = `delete-browser-${crypto.randomUUID()}@example.com`;
    await page.goto(origin!);
    const requestedAt = Date.now();
    const previousMessage = await signIn(page, email);
    await page.getByRole("button", { name: "복구 코드 만들기", exact: true }).click();
    await page.getByRole("button", { name: "안전하게 보관했습니다", exact: true }).click();
    const text = `삭제할 비공개 기록 ${crypto.randomUUID()}`;
    await page.getByRole("textbox", { name: "무슨 생각을 하고 있나요?" }).fill(text);
    await page.getByRole("button", { name: "기록", exact: true }).click();
    await sync(page);
    await page.getByRole("button", { name: "계정", exact: true }).click();
    await expect(page.getByLabel("서버 사용량", { exact: true })).toContainText("기록 1");
    await page.getByRole("button", { name: "계정 및 모든 데이터 삭제", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "계정 및 서버 데이터 삭제", exact: true });
    await expect(dialog).toContainText(email);
    await expect(dialog.getByRole("button", { name: "계정 및 서버 데이터 삭제", exact: true })).toBeDisabled();
    await new Promise(resolve => setTimeout(resolve, Math.max(0, requestedAt + 61_000 - Date.now())));
    await dialog.getByRole("button", { name: "삭제 확인 코드 받기", exact: true }).click();
    let code = "";
    await expect.poll(async () => {
      const result = await (await page.request.get(`${mailpit}/api/v1/messages`)).json();
      const message = result.messages.find((item: { ID: string; To: { Address: string }[] }) =>
        item.ID !== previousMessage && item.To.some(to => to.Address === email));
      if (!message) return false;
      const detail = await (await page.request.get(`${mailpit}/api/v1/message/${message.ID}`)).json();
      code = detail.Text.match(/\b[0-9]{6}\b/)?.[0] ?? "";
      return Boolean(code);
    }, { timeout: 20_000 }).toBe(true);
    await dialog.locator("#delete-confirm-input").fill("계정 삭제");
    await dialog.getByLabel("삭제 확인 코드", { exact: true }).fill(code === "000000" ? "000001" : "000000");
    const rejected = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/account"));
    await dialog.getByRole("button", { name: "계정 및 서버 데이터 삭제", exact: true }).click();
    expect((await rejected).status()).toBe(401);
    await expect(dialog.getByRole("alert")).toContainText("올바르지 않거나 만료");
    expect((await page.request.get(`${apiOrigin}/api/v1/auth/session`)).status()).toBe(200);
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    let deletionId = "";
    await page.route("**/api/v1/account/deletion", route => route.fulfill({ json: { deletion_id: deletionId, status: "pending" } }));
    await dialog.getByLabel("삭제 확인 코드", { exact: true }).fill(code);
    const accepted = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().endsWith("/account") && response.status() === 202);
    await dialog.getByRole("button", { name: "계정 및 서버 데이터 삭제", exact: true }).click();
    deletionId = (await (await accepted).json()).deletion_id;
    await expect(dialog).toContainText("서버 데이터를 정리하고 있습니다");
    expect((await page.request.get(`${apiOrigin}/api/v1/auth/session`)).status()).toBe(401);
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "계정 삭제 상태 확인", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "계정 및 서버 데이터 삭제", exact: true })).toContainText("서버 데이터를 정리하고 있습니다");
    await page.unroute("**/api/v1/account/deletion");
    await page.getByRole("button", { name: "삭제 상태 다시 확인", exact: true }).click();
    await expect(page.getByText("서버 계정과 데이터 삭제가 완료되었습니다.", { exact: true })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "확인", exact: true }).click();
    await expect(page.getByRole("button", { name: "계정 삭제 상태 확인", exact: true })).toHaveCount(0);
    await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  } finally { await context.close(); }
});

test("server subscription changes refresh Free and Pro plans with effective quotas", async ({ browser }) => {
  const adminEmail = process.env.MIROVEN_INTEGRATION_ADMIN_EMAIL;
  test.skip(!adminEmail, "Configure a synthetic admin in the dedicated development stack.");
  const memberContext = await browser.newContext({ locale: "ko-KR" });
  const adminContext = await browser.newContext({ locale: "ko-KR" });
  try {
    const member = await memberContext.newPage();
    const admin = await adminContext.newPage();
    await member.goto(origin!);
    await signIn(member, `plan-${crypto.randomUUID()}@example.com`);
    const memberSession = await (await member.request.get(`${apiOrigin}/api/v1/auth/session`)).json();
    const free = await (await member.request.get(`${apiOrigin}/api/v1/account/usage`)).json();
    expect(free.plan).toBe("free");
    await member.getByRole("button", { name: "계정", exact: true }).click();
    const card = member.getByLabel("서버 사용량", { exact: true });
    const plan = card.getByLabel("현재 플랜", { exact: true });
    await expect(plan).toContainText("Free");
    await admin.goto(origin!);
    await signIn(admin, adminEmail!);
    const adminSession = await (await admin.request.get(`${apiOrigin}/api/v1/auth/session`)).json();
    const changePlan = async (status: "trialing" | "canceled" | "expired", periodEnd: string, cancel = false) => {
      const response = await admin.request.put(`${apiOrigin}/api/v1/admin/users/${memberSession.user_id}/subscription`, {
        headers: { Origin: new URL(origin!).origin, "X-CSRF-Token": adminSession.csrf_token, "X-Miroven-User-ID": adminSession.user_id },
        data: { plan: "pro", status, current_period_end: periodEnd, cancel_at_period_end: cancel },
      });
      expect(response.status()).toBe(200);
      await card.getByRole("button", { name: "플랜·사용량 새로고침" }).click();
    };
    const future = new Date(Date.now() + 86400000).toISOString();
    await changePlan("trialing", future, true);
    await expect(plan).toContainText("Pro");
    await expect(plan).toContainText("체험 중");
    await expect(plan).toContainText("Free 플랜으로 전환됩니다.");
    const pro = await (await member.request.get(`${apiOrigin}/api/v1/account/usage`)).json();
    expect(pro.storage_limit_bytes).toBeGreaterThan(free.storage_limit_bytes);
    expect(pro.entry_limit).toBeGreaterThan(free.entry_limit);
    expect(pro.blob_max_bytes).toBeGreaterThan(free.blob_max_bytes);
    await expect(card.locator("progress")).toHaveAttribute("max", String(pro.storage_limit_bytes));
    await changePlan("canceled", future);
    await expect(plan).toContainText("Pro");
    await expect(plan).toContainText("해지됨");
    await changePlan("expired", new Date(Date.now() - 86400000).toISOString());
    await expect(plan).toContainText("Free");
    await expect(plan).toContainText("만료됨");
    await expect(plan).not.toContainText("Pro");
    await expect(card.locator("progress")).toHaveAttribute("max", String(free.storage_limit_bytes));
  } finally { await memberContext.close(); await adminContext.close(); }
});
