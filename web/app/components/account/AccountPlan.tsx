import type { AccountUsage } from "../../lib/remote/account";

const STATUS_LABELS = {
  active: { ko: "이용 중", en: "Active" },
  trialing: { ko: "체험 중", en: "Trial" },
  past_due: { ko: "결제 지연", en: "Past due" },
  canceled: { ko: "해지됨", en: "Canceled" },
  expired: { ko: "만료됨", en: "Expired" },
} satisfies Record<NonNullable<AccountUsage["subscription_status"]>, Record<"ko" | "en", string>>;

export function AccountPlan({ usage, language }: { usage: AccountUsage; language: "ko" | "en" }) {
  const ko = language === "ko";
  // Older servers omit subscription fields and use the Free limits.
  const plan = usage.plan === "pro" ? "Pro" : "Free";
  const status = usage.subscription_status;
  const periodEnd = usage.current_period_end ? new Date(usage.current_period_end) : null;
  const validEnd = periodEnd && Number.isFinite(periodEnd.getTime()) ? periodEnd : null;
  const ending = usage.plan === "pro" && (usage.cancel_at_period_end || status === "canceled");
  const dateLabel = status === "expired"
    ? (ko ? "만료일" : "Expired on")
    : ending ? (ko ? "이용 종료 예정" : "Access ends")
      : (ko ? "현재 이용 기간 종료" : "Current period ends");

  return <div className="account-plan" aria-label={ko ? "현재 플랜" : "Current plan"}>
    <div className="account-plan-heading">
      <strong>{ko ? "현재 플랜" : "Current plan"}</strong>
      <span className={`account-plan-badge${plan === "Pro" ? " account-plan-pro" : ""}`}>{plan}</span>
    </div>
    {status && <span>{STATUS_LABELS[status]?.[language]}</span>}
    {validEnd && <small>{dateLabel}: <time dateTime={usage.current_period_end!}>
      {validEnd.toLocaleString(ko ? "ko-KR" : "en-US", { dateStyle: "medium", timeStyle: "short" })}
    </time></small>}
    {usage.plan === "pro" && usage.cancel_at_period_end && status !== "expired" && <small>
      {ko ? "현재 이용 기간이 끝나면 Free 플랜으로 전환됩니다." : "Your plan changes to Free at the end of the current period."}
    </small>}
  </div>;
}
