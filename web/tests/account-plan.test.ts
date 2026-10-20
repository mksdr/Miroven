import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccountPlan } from "../app/components/account/AccountPlan";
import type { AccountUsage } from "../app/lib/remote/account";

const usage: AccountUsage = {
  storage_bytes: 42, storage_limit_bytes: 100, entries: 2, entry_limit: 10, blob_max_bytes: 50,
  plan: "free", subscription_status: "active", cancel_at_period_end: false,
};
const render = (fields: Partial<AccountUsage>, language: "ko" | "en" = "en") =>
  renderToStaticMarkup(createElement(AccountPlan, { usage: { ...usage, ...fields }, language }));

describe("account plan presentation", () => {
  it("supports legacy usage responses without subscription fields", () => {
    const legacy = { storage_bytes: 42, storage_limit_bytes: 100, entries: 2, entry_limit: 10, blob_max_bytes: 50 };
    const html = renderToStaticMarkup(createElement(AccountPlan, { usage: legacy as AccountUsage, language: "en" }));
    expect(html).toContain("Free");
    expect(html).not.toContain("Pro");
    expect(html).not.toContain("<time");
  });

  it.each([
    ["active", "Active", "이용 중"],
    ["trialing", "Trial", "체험 중"],
    ["past_due", "Past due", "결제 지연"],
    ["canceled", "Canceled", "해지됨"],
    ["expired", "Expired", "만료됨"],
  ] as const)("localizes %s without overriding the server's effective plan", (status, en, ko) => {
    const fields = { plan: "pro", subscription_status: status } as const;
    expect(render(fields)).toContain(en);
    expect(render(fields, "ko")).toContain(ko);
    expect(render(fields)).toContain(">Pro</span>");
  });

  it("shows Free after expiry and keeps the historical period end", () => {
    const html = render({ plan: "free", subscription_status: "expired", current_period_end: "2026-10-01T00:00:00Z" });
    expect(html).toContain(">Free</span>");
    expect(html).toContain("Expired on:");
    expect(html).toContain('dateTime="2026-10-01T00:00:00Z"');
    expect(html).not.toContain("Current period ends");
  });

  it("explains scheduled cancellation and retains Pro until the server downgrades it", () => {
    const fields = { plan: "pro", subscription_status: "active", cancel_at_period_end: true, current_period_end: "2099-11-01T00:00:00Z" } as const;
    expect(render(fields)).toContain("Access ends:");
    expect(render(fields)).toContain("Your plan changes to Free");
    expect(render(fields, "ko")).toContain("현재 이용 기간이 끝나면 Free 플랜으로 전환됩니다.");
    expect(render({ ...fields, subscription_status: "canceled" })).toContain(">Pro</span>");
  });

  it("uses a neutral period label for renewals and omits invalid or absent dates", () => {
    expect(render({ plan: "pro", current_period_end: "2099-11-01T00:00:00Z" })).toContain("Current period ends:");
    expect(render({ current_period_end: "invalid" })).not.toContain("<time");
    expect(render({ current_period_end: null })).not.toContain("<time");
  });
});
