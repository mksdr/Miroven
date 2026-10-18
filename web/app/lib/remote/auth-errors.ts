type AuthErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

export function loginCodeErrorMessage(error: unknown, language: "ko" | "en" = "ko"): string {
  const authError = typeof error === "object" && error !== null ? (error as AuthErrorLike) : null;
  const code = typeof authError?.code === "string" ? authError.code : "";

  if (code === "rate_limited" || authError?.status === 429) {
    return language === "ko"
      ? "로그인 코드를 너무 자주 요청했습니다. 잠시 기다린 뒤 다시 시도해 주세요."
      : "Too many sign-in codes were requested. Wait a moment and try again.";
  }

  return language === "ko"
    ? "로그인 코드를 보내지 못했습니다. 잠시 후 다시 시도해 주세요."
    : "We couldn’t send the sign-in code. Try again in a moment.";
}

export function otpErrorMessage(error: unknown, language: "ko" | "en" = "ko"): string {
  const authError = typeof error === "object" && error !== null ? (error as AuthErrorLike) : null;
  const code = typeof authError?.code === "string" ? authError.code : "";

  if (code === "invalid_code") {
    return language === "ko"
      ? "보안 코드가 올바르지 않거나 만료되었습니다. 코드를 다시 확인하거나 재전송해 주세요."
      : "The security code is invalid or has expired. Please check the code or request a new one.";
  }

  if (code === "rate_limited" || authError?.status === 429) {
    return language === "ko"
      ? "보안 코드 확인을 너무 자주 시도했습니다. 잠시 기다린 뒤 다시 시도해 주세요."
      : "Too many verification attempts. Please wait a moment and try again.";
  }

  return language === "ko"
    ? "보안 코드를 확인하지 못했습니다. 다시 시도해 주세요."
    : "We couldn’t verify the security code. Please try again.";
}
