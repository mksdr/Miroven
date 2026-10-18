import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSyncContent } from "../app/components/account/AccountSyncContent";
import { EncryptedBackupContent } from "../app/components/account/EncryptedBackupContent";

const accountCopy = {
  localMode: "Local mode",
  localModeDetail: "Write before setup",
  checkingLogin: "Checking sign-in",
  loggedInUser: "Signed-in user",
  syncNow: "Sync now",
  syncing: "Syncing",
  signOut: "Sign out",
  emailStart: "Continue with email",
  sendLink: "Send link",
  sending: "Sending",
  emailNote: "Encrypted sync only",
  otpInputLabel: "Security code",
  otpPlaceholder: "12345678",
  verifyCode: "Verify",
  verifyingCode: "Verifying",
  otpSentNotice: (emailAddress: string) => `Sent to ${emailAddress}`,
  otpPwaTip: "Use the link or code",
  resendOrChangeEmail: "Change email",
};

const baseAccountProps: ComponentProps<typeof AccountSyncContent> = {
  inputId: "account-email",
  copy: accountCopy,
  isConfigured: true,
  isLoading: false,
  isSignedIn: false,
  identityEmail: null,
  syncSummary: { title: "Ready", detail: "No pending changes" },
  canSync: false,
  isSyncing: false,
  authStep: "email",
  email: "",
  otpCode: "",
  isSending: false,
  isVerifying: false,
  deleteAccountLabel: "Delete account",
  onEmailChange: vi.fn(),
  onOtpCodeChange: vi.fn(),
  onSubmitEmail: vi.fn(),
  onSubmitOtp: vi.fn(),
  onResetOtp: vi.fn(),
  onSync: vi.fn(),
  onSignOut: vi.fn(),
  onDeleteAccount: vi.fn(),
};

const backupCopy = {
  backupGuard: "Keep the file and code separately",
  checkingBackup: "Checking backup",
  exportBackup: "Export backup",
  emptyDeviceOnly: "Import on an empty device only",
  backupNeeds: "The backup and Recovery Code are required",
  recoveryCode: "Recovery Code",
  importBackup: "Import backup",
};

const baseBackupProps: ComponentProps<typeof EncryptedBackupContent> = {
  inputId: "backup",
  copy: backupCopy,
  hasLocalEnvelope: false,
  entryCount: 0,
  busy: false,
  recoveryInput: "",
  acceptedFileTypes: ".json,application/json",
  onExport: vi.fn(),
  onRecoveryInputChange: vi.fn(),
  onImport: vi.fn(),
};

describe("account and backup presentation", () => {
  it("renders local mode without exposing an authentication form", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountSyncContent, {
        ...baseAccountProps,
        isConfigured: false,
      }),
    );

    expect(markup).toContain("Local mode");
    expect(markup).not.toContain("<form");
  });

  it("renders a signed-in session even when the identity has no email", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountSyncContent, {
        ...baseAccountProps,
        isSignedIn: true,
        canSync: true,
      }),
    );

    expect(markup).toContain("Signed-in user");
    expect(markup).toContain("No pending changes");
    expect(markup).toContain("Sync now");
    expect(markup).toContain("Delete account");
  });

  it("renders the OTP form independently from the authentication controller", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountSyncContent, {
        ...baseAccountProps,
        authStep: "otp",
        email: "user@example.com",
        otpCode: "12345678",
      }),
    );

    expect(markup).toContain("Sent to user@example.com");
    expect(markup).toContain('one-time-code');
    expect(markup).toContain("Change email");
  });

  it("keeps backup export, blocked import, and empty-device import states distinct", () => {
    const exportMarkup = renderToStaticMarkup(
      createElement(EncryptedBackupContent, {
        ...baseBackupProps,
        hasLocalEnvelope: true,
      }),
    );
    const blockedMarkup = renderToStaticMarkup(
      createElement(EncryptedBackupContent, {
        ...baseBackupProps,
        entryCount: 1,
      }),
    );
    const importMarkup = renderToStaticMarkup(
      createElement(EncryptedBackupContent, {
        ...baseBackupProps,
        recoveryInput: "TEST-RECOVERY-CODE",
      }),
    );

    expect(exportMarkup).toContain("Export backup");
    expect(blockedMarkup).toContain("Import on an empty device only");
    expect(importMarkup).toContain("Import backup");
    expect(importMarkup).not.toContain("disabled");
  });
});
