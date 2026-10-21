"use client";

import { useEffect, useState } from "react";
import { getAuthPolicy, type AuthPolicy } from "../../lib/remote/auth";

export function SignupDomainNotice({ email, language }: { email: string; language: "ko" | "en" }) {
  const [policy, setPolicy] = useState<AuthPolicy | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getAuthPolicy(controller.signal).then((value) => {
      if (!controller.signal.aborted) setPolicy(value);
    }).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const domains = policy ? Object.values(policy.domain_groups).flat() : [];
  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.includes("@") ? normalizedEmail.split("@").pop() ?? "" : "";
  const unsupported = domains.length > 0 && Boolean(domain) && !domains.includes(domain);
  const localPart = normalizedEmail.slice(0, normalizedEmail.lastIndexOf("@"));
  const unsupportedLocalPart = normalizedEmail.includes("@")
    && policy?.blocked_local_part_characters?.some((character) => localPart.includes(character));

  return (
    <div className="account-message">
      <p role="status">
        {unsupportedLocalPart
          ? language === "ko"
            ? "이메일의 @ 앞부분에 + 또는 .이 있으면 신규 가입할 수 없습니다. 기존 계정은 계속 로그인할 수 있습니다."
            : "New accounts cannot use + or . before @. Existing accounts can still sign in."
          : unsupported
          ? language === "ko"
            ? "이 도메인으로는 신규 가입할 수 없습니다. 기존 계정은 계속 로그인할 수 있습니다."
            : "New accounts cannot use this domain. Existing accounts can still sign in."
          : language === "ko"
            ? "신규 가입은 지원하는 이메일 도메인으로 제한됩니다. 기존 계정은 계속 로그인할 수 있습니다."
            : "New accounts require a supported email domain. Existing accounts can still sign in."}
      </p>
      {domains.length > 0 && (
        <details>
          <summary>{language === "ko" ? "가입 가능한 이메일 도메인" : "Supported signup email domains"}</summary>
          <p>{domains.join(", ")}</p>
        </details>
      )}
    </div>
  );
}
