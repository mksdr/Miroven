import { readFileSync } from "node:fs";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountSettingsModal } from "../app/components/modals/AccountSettingsModal";
import { DisplaySettingsModal } from "../app/components/modals/DisplaySettingsModal";
import { COPY } from "../app/lib/journal-copy";
import { websiteLinks } from "../app/lib/site-config";

describe("Settings Modals presentation components", () => {
  const t = COPY.en;

  describe("AccountSettingsModal", () => {
    const baseProps: ComponentProps<typeof AccountSettingsModal> = {
      isOpen: true,
      onClose: vi.fn(),
      pinSetupOpen: false,
      deleteModalOpen: false,
      language: "en",
      copy: t,
      isApiConfigured: true,
      authLoading: false,
      identity: null,
      syncSummary: { title: "Ready", detail: "No pending changes" },
      canSync: false,
      syncStatus: "local",
      authStep: "email",
      email: "",
      otpCode: "",
      authSending: false,
      otpVerifying: false,
      localEnvelope: null,
      entryCount: 0,
      backupBusy: false,
      backupRecoveryInput: "",
      isPinConfigured: false,
      onEmailChange: vi.fn(),
      onOtpCodeChange: vi.fn(),
      onSubmitEmail: vi.fn(),
      onSubmitOtp: vi.fn(),
      onResetOtp: vi.fn(),
      onSync: vi.fn(),
      onSignOut: vi.fn(),
      onOpenDeleteAccount: vi.fn(),
      onExportBackup: vi.fn(),
      onBackupRecoveryInputChange: vi.fn(),
      onImportBackup: vi.fn(),
      onRemovePin: vi.fn(),
      onOpenPinSetup: vi.fn(),
      onExportDiagnostics: vi.fn(),
    };

    it("renders null when isOpen is false", () => {
      const markup = renderToStaticMarkup(
        createElement(AccountSettingsModal, { ...baseProps, isOpen: false }),
      );
      expect(markup).toBe("");
    });

    it("renders account modal structure and groups when open", () => {
      const markup = renderToStaticMarkup(createElement(AccountSettingsModal, baseProps));
      expect(markup).toContain('id="account-dialog-title"');
      expect(markup).toContain(t.account);
      expect(markup).toContain("Account &amp; sync");
      expect(markup).toContain(t.encryptedBackup);
      expect(markup).toContain("PIN Vault Lock");
      expect(markup).toContain("Setup PIN Lock");
      expect(markup).toContain("Diagnostics &amp; Support");
      for (const url of Object.values(websiteLinks)) expect(markup).toContain(`href="${url}"`);
      for (const route of ["/about", "/tos", "/privacy"]) expect(markup).not.toContain(`href="${route}"`);
    });

    it("uses the configured website for introduction and policy links", async () => {
      vi.stubEnv("NEXT_PUBLIC_WEBSITE_URL", "https://site.selfhost.example/project/");
      vi.resetModules();
      try {
        const { AccountSettingsModal: ConfiguredModal } = await import("../app/components/modals/AccountSettingsModal");
        const markup = renderToStaticMarkup(createElement(ConfiguredModal, baseProps));
        for (const path of ["ko/", "ko/terms/", "ko/privacy/"]) {
          expect(markup).toContain(`href="https://site.selfhost.example/project/${path}"`);
        }
        expect(markup).not.toContain("https://miroven.mksdr.bid");
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });

    it("renders configured PIN button when isPinConfigured is true", () => {
      const markup = renderToStaticMarkup(
        createElement(AccountSettingsModal, { ...baseProps, isPinConfigured: true }),
      );
      expect(markup).toContain("Remove PIN Lock");
    });

    it("propagates signed-in, syncing, backup, and PIN states", () => {
      const markup = renderToStaticMarkup(
        createElement(AccountSettingsModal, {
          ...baseProps,
          identity: { id: "user-1", email: "owner@example.com" },
          syncSummary: { title: "Syncing now", detail: "2 pending changes" },
          canSync: true,
          syncStatus: "syncing",
          localEnvelope: {
            wrappedVaultKey: new ArrayBuffer(0),
            wrappingNonce: new ArrayBuffer(0),
            recoverySalt: new ArrayBuffer(0),
            recoveryFormat: "base32-hkdf-sha256-v1",
            cryptoVersion: 1,
            keyVersion: 1,
          },
          backupBusy: true,
          isPinConfigured: true,
        }),
      );
      expect(markup).toContain("owner@example.com");
      expect(markup).toContain("Syncing now");
      expect(markup).toContain("2 pending changes");
      expect(markup).toContain(`${t.syncing}</button>`);
      expect(markup).toContain(`${t.checkingBackup}</button>`);
      expect(markup).toContain("Remove PIN Lock");
    });

    it("keeps local account and non-empty-device backup states distinct", () => {
      const markup = renderToStaticMarkup(
        createElement(AccountSettingsModal, {
          ...baseProps,
          isApiConfigured: false,
          entryCount: 2,
        }),
      );
      expect(markup).toContain(t.localMode);
      expect(markup).not.toContain('id="modal-auth-email"');
      expect(markup).toContain(t.emptyDeviceOnly);
      expect(markup).not.toContain('id="modal-backup-code"');
    });

    it("renders OTP and empty-device backup inputs with their guard rails", () => {
      const markup = renderToStaticMarkup(
        createElement(AccountSettingsModal, {
          ...baseProps,
          authStep: "otp",
          email: "owner@example.com",
          otpCode: "12345678",
          backupRecoveryInput: "RECOVERY-CODE",
        }),
      );
      expect(markup).toContain('id="modal-auth-email-otp"');
      expect(markup).toContain("Requested a six-digit sign-in code for owner@example.com.");
      expect(markup).toContain('id="modal-backup-code"');
      expect(markup).toContain('accept=".miroven-backup.json,application/json"');
      expect(markup).not.toContain('class="backup-file-button disabled"');
    });
  });

  describe("DisplaySettingsModal", () => {
    const baseProps: ComponentProps<typeof DisplaySettingsModal> = {
      isOpen: true,
      onClose: vi.fn(),
      pinSetupOpen: false,
      deleteModalOpen: false,
      language: "en",
      theme: "light",
      fontScale: "normal",
      lowSpecMode: false,
      copy: t,
      onLanguageChange: vi.fn(),
      onThemeChange: vi.fn(),
      onFontScaleChange: vi.fn(),
      onToggleLowSpecMode: vi.fn(),
    };

    it("renders null when isOpen is false", () => {
      const markup = renderToStaticMarkup(
        createElement(DisplaySettingsModal, { ...baseProps, isOpen: false }),
      );
      expect(markup).toBe("");
    });

    it("renders language, theme, font size, and low-spec mode options", () => {
      const markup = renderToStaticMarkup(createElement(DisplaySettingsModal, baseProps));
      expect(markup).toContain('id="settings-title"');
      expect(markup).toContain(t.language);
      expect(markup).toContain(t.theme);
      expect(markup).toContain(t.fontSize);
      expect(markup).toContain("Low-Spec Device Mode");
      expect(markup).toContain("Standard (Full FX)");
      expect(markup).toContain("Optimized (Fast &amp; Smooth)");
    });

    it("reflects every selected appearance state in Korean", () => {
      const markup = renderToStaticMarkup(
        createElement(DisplaySettingsModal, {
          ...baseProps,
          language: "ko",
          theme: "high-contrast",
          fontScale: "xlarge",
          lowSpecMode: true,
          copy: COPY.ko,
        }),
      );
      expect(markup).toContain('class="selected theme-choice theme-high-contrast"');
      expect(markup).toContain(`${COPY.ko.fontSizeXLarge}</span></button>`);
      expect(markup).toContain("저사양 최적화 (빠른 반응)");
      expect(markup.split('class="selected"')).toHaveLength(4);
    });

    it("prevents radio dots from distorting into ovals under narrow widths", () => {
      const modalsCss = readFileSync(new URL("../app/styles/modals.css", import.meta.url), "utf-8");
      const responsiveCss = readFileSync(new URL("../app/styles/responsive.css", import.meta.url), "utf-8");

      expect(modalsCss).toMatch(/\.radio-dot\s*\{[^}]*flex-shrink:\s*0/);
      expect(modalsCss).toMatch(/\.radio-dot\s*\{[^}]*min-width:\s*18px/);
      expect(modalsCss).toMatch(/\.radio-dot\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/);
      expect(responsiveCss).toMatch(/\.choice-row\.three-up\s*\{\s*grid-template-columns:\s*1fr;\s*\}/);
    });
  });
});
