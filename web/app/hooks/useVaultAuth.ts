"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  getAuthIdentity,
  isApiConfigured,
  loginCodeErrorMessage,
  otpErrorMessage,
  sendLoginCode,
  signOutCurrentDevice,
  signOutAllDevices,
  subscribeToAuth,
  verifyOtpCode,
  type AuthIdentity,
} from "../lib/remote";
import type { Language } from "./useAppearance";
import { useAccountDeletion } from "./useAccountDeletion";

type UseVaultAuthOptions = {
  language: Language;
  onAccountDeleted: () => void;
  onSignedOut: () => void;
  showToast: (message: string) => void;
};

export function useVaultAuth({
  language,
  onAccountDeleted,
  onSignedOut,
  showToast,
}: UseVaultAuthOptions) {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const previousIdentity = useRef<AuthIdentity | null>(null);
  const [authLoading, setAuthLoading] = useState(isApiConfigured);
  const [authSending, setAuthSending] = useState(false);
  const [email, setEmail] = useState("");
  const [authStep, setAuthStep] = useState<"email" | "otp">("email");
  const [otpCode, setOtpCode] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [nextCodeRequestAt, setNextCodeRequestAt] = useState(0);

  const deletion = useAccountDeletion({
    identity,
    language,
    nextCodeRequestAt,
    setNextCodeRequestAt,
    onAccountDeleted,
    onSignedOut,
    showToast,
  });

  const updateIdentity = useCallback(
    (nextIdentity: AuthIdentity | null) => {
      if (previousIdentity.current && previousIdentity.current.id !== nextIdentity?.id) {
        onSignedOut();
      }
      previousIdentity.current = nextIdentity;
      setIdentity((previous) => {
        if (previous === nextIdentity) return previous;
        if (
          previous &&
          nextIdentity &&
          previous.id === nextIdentity.id &&
          previous.email === nextIdentity.email
        ) {
          return previous;
        }
        return nextIdentity;
      });
      setAuthStep("email");
      setOtpCode("");
    },
    [onSignedOut],
  );

  useEffect(() => {
    if (isApiConfigured) {
      getAuthIdentity()
        .then(updateIdentity)
        .catch(() =>
          showToast(
            language === "ko"
              ? "로그인 상태를 확인하지 못했습니다."
              : "We couldn’t check your sign-in status.",
          ),
        )
        .finally(() => setAuthLoading(false));
    }

    let unsubscribeFromAuth: () => void = () => undefined;
    let cancelled = false;
    void subscribeToAuth((nextIdentity) => {
      updateIdentity(nextIdentity);
      setAuthLoading(false);
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else unsubscribeFromAuth = unsubscribe;
      })
      .catch(() => {
        if (!cancelled) setAuthLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribeFromAuth();
    };
  }, [language, showToast, updateIdentity]);

  const handleSendCode = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedEmail = email.trim().toLowerCase();
      if (!normalizedEmail || authSending) return;

      setAuthSending(true);
      try {
        await sendLoginCode(normalizedEmail);
        setNextCodeRequestAt(Date.now() + 60_000);
        setAuthStep("otp");
        showToast(
          language === "ko"
            ? "이메일로 6자리 로그인 코드를 요청했습니다."
            : "Requested a six-digit sign-in code by email.",
        );
      } catch (error) {
        showToast(loginCodeErrorMessage(error, language));
      } finally {
        setAuthSending(false);
      }
    },
    [authSending, email, language, showToast],
  );

  const handleVerifyOtp = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const normalizedEmail = email.trim().toLowerCase();
      const cleanOtp = otpCode.trim();
      if (!normalizedEmail || !cleanOtp || otpVerifying) return;

      setOtpVerifying(true);
      try {
        await verifyOtpCode(normalizedEmail, cleanOtp);
        setOtpCode("");
        showToast(
          language === "ko"
            ? "보안 코드가 확인되었습니다. 로그인되었습니다."
            : "Security code verified. You are signed in.",
        );
      } catch (error) {
        showToast(otpErrorMessage(error, language));
      } finally {
        setOtpVerifying(false);
      }
    },
    [email, language, otpCode, otpVerifying, showToast],
  );

  const handleSignOut = useCallback(async () => {
    try {
      await signOutCurrentDevice(identity?.id);
      setIdentity(null);
      onSignedOut();
      showToast(
        language === "ko"
          ? "이 기기에서 로그아웃했습니다."
          : "Signed out on this device.",
      );
    } catch {
      showToast(
        language === "ko"
          ? "로그아웃하지 못했습니다."
          : "We couldn’t sign you out.",
      );
    }
  }, [identity, language, onSignedOut, showToast]);

  const handleSignOutAll = useCallback(async () => {
    if (!identity) return;
    try {
      await signOutAllDevices(identity.id);
      onSignedOut();
      showToast(
        language === "ko"
          ? "모든 기기에서 로그아웃했습니다."
          : "Signed out on all devices.",
      );
    } catch {
      showToast(
        language === "ko"
          ? "전체 로그아웃에 실패했습니다. 다시 시도해 주세요."
          : "Could not sign out all devices. Try again.",
      );
    }
  }, [identity, language, onSignedOut, showToast]);

  const resetOtp = useCallback(() => {
    setAuthStep("email");
    setOtpCode("");
  }, []);

  return {
    authLoading,
    authSending,
    authStep,
    email,
    handleSendCode,
    handleSignOut,
    handleSignOutAll,
    handleVerifyOtp,
    identity,
    nextCodeRequestAt,
    otpCode,
    otpVerifying,
    resetOtp,
    setEmail,
    setOtpCode,
    ...deletion,
  };
}
