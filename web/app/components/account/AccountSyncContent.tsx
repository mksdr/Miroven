"use client";

import type { FormEventHandler } from "react";
import { AccountUsage } from "./AccountUsage";

type AccountSyncCopy = {
  localMode: string;
  localModeDetail: string;
  checkingLogin: string;
  loggedInUser: string;
  syncNow: string;
  syncing: string;
  signOut: string;
  emailStart: string;
  sendLink: string;
  sending: string;
  emailNote: string;
  otpInputLabel: string;
  otpPlaceholder: string;
  verifyCode: string;
  verifyingCode: string;
  otpSentNotice: (emailAddress: string) => string;
  otpPwaTip: string;
  resendOrChangeEmail: string;
};

export function AccountSyncContent({
  inputId,
  copy,
  isConfigured,
  isLoading,
  isSignedIn,
  identityEmail,
  syncSummary,
  canSync,
  isSyncing,
  authStep,
  email,
  otpCode,
  isSending,
  isVerifying,
  deleteAccountLabel,
  onEmailChange,
  onOtpCodeChange,
  onSubmitEmail,
  onSubmitOtp,
  onResetOtp,
  onSync,
  onSignOut,
  onDeleteAccount,
  onSignOutAll,
  identityId,
  language = "ko",
}: {
  inputId: string;
  copy: AccountSyncCopy;
  isConfigured: boolean;
  isLoading: boolean;
  isSignedIn: boolean;
  identityEmail: string | null;
  identityId?: string;
  language?: "ko" | "en";
  syncSummary: { title: string; detail: string };
  canSync: boolean;
  isSyncing: boolean;
  authStep: "email" | "otp";
  email: string;
  otpCode: string;
  isSending: boolean;
  isVerifying: boolean;
  deleteAccountLabel: string;
  onEmailChange: (value: string) => void;
  onOtpCodeChange: (value: string) => void;
  onSubmitEmail: FormEventHandler<HTMLFormElement>;
  onSubmitOtp: FormEventHandler<HTMLFormElement>;
  onResetOtp: () => void;
  onSync: () => void;
  onSignOut: () => void;
  onSignOutAll?: () => void;
  onDeleteAccount: () => void;
}) {
  if (!isConfigured) {
    return (
      <div className="sync-state">
        <div className="sync-icon" aria-hidden="true">↻</div>
        <div>
          <strong>{copy.localMode}</strong>
          <span>{copy.localModeDetail}</span>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <p className="account-message">{copy.checkingLogin}</p>;
  }

  if (isSignedIn) {
    return (
      <div className="account-session">
        <strong>{identityEmail ?? copy.loggedInUser}</strong>
        <span>{syncSummary.title}</span>
        <small>{syncSummary.detail}</small>
        {identityId && <AccountUsage key={identityId} userId={identityId} language={language} refreshing={isSyncing} />}
        {canSync ? (
          <button type="button" onClick={onSync} disabled={isSyncing}>
            {isSyncing ? copy.syncing : copy.syncNow}
          </button>
        ) : null}
        <button type="button" onClick={onSignOut}>
          {copy.signOut}
        </button>
        {onSignOutAll && <button type="button" onClick={onSignOutAll}>
          {language === "ko" ? "모든 기기에서 로그아웃" : "Sign out all devices"}
        </button>}
        <button
          type="button"
          className="secondary account-danger-button"
          onClick={onDeleteAccount}
        >
          {deleteAccountLabel}
        </button>
      </div>
    );
  }

  if (authStep === "otp") {
    return (
      <form className="auth-form" onSubmit={onSubmitOtp}>
        <p className="account-message account-notice">
          {copy.otpSentNotice(email)}
        </p>
        <p className="account-message account-tip">{copy.otpPwaTip}</p>
        <label htmlFor={`${inputId}-otp`}>{copy.otpInputLabel}</label>
        <input
          id={`${inputId}-otp`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="[0-9]{6}"
          value={otpCode}
          onChange={(event) => onOtpCodeChange(event.target.value)}
          placeholder={copy.otpPlaceholder}
          required
          autoFocus
        />
        <button type="submit" disabled={isVerifying || !otpCode.trim()}>
          {isVerifying ? copy.verifyingCode : copy.verifyCode}
        </button>
        <button
          type="button"
          className="edit-button full-width-button"
          onClick={onResetOtp}
        >
          {copy.resendOrChangeEmail}
        </button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={onSubmitEmail}>
      <label htmlFor={inputId}>{copy.emailStart}</label>
      <input
        id={inputId}
        type="email"
        inputMode="email"
        autoComplete="email"
        value={email}
        onChange={(event) => onEmailChange(event.target.value)}
        placeholder="you@example.com"
        required
      />
      <button type="submit" disabled={isSending}>
        {isSending ? copy.sending : copy.sendLink}
      </button>
      <small>{copy.emailNote}</small>
    </form>
  );
}
