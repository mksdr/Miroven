import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LeftRail } from "../app/components/layout/LeftRail";
import { TimelineHeader } from "../app/components/layout/TimelineHeader";
import { RightRail } from "../app/components/layout/RightRail";
import { MobileNav } from "../app/components/layout/MobileNav";
import { KeyboardShortcutsModal } from "../app/components/KeyboardShortcutsModal";
import { COPY } from "../app/lib/journal-copy";

describe("App Shell presentation components", () => {
  const t = COPY.en;

  function occurrences(markup: string, value: string) {
    return markup.split(value).length - 1;
  }

  describe("LeftRail", () => {
    const baseProps: ComponentProps<typeof LeftRail> = {
      activeTab: "journal",
      language: "en",
      copy: t,
      online: true,
      onSelectTab: vi.fn(),
      onOpenAccount: vi.fn(),
      onOpenSettings: vi.fn(),
    };

    it("renders brand, navigation items, and active journal tab", () => {
      const markup = renderToStaticMarkup(createElement(LeftRail, baseProps));
      expect(markup).toContain("Miroven");
      expect(markup).toContain('class="nav-item active"');
      expect(markup).toContain(t.journal);
      expect(markup).toContain(t.search);
      expect(markup).toContain(t.account);
      expect(markup).toContain(t.display);
    });

    it("reflects search tab active state and offline indicator", () => {
      const markup = renderToStaticMarkup(
        createElement(LeftRail, {
          ...baseProps,
          activeTab: "search",
          online: false,
        }),
      );
      expect(occurrences(markup, 'class="nav-item active"')).toBe(1);
      expect(markup).toContain(`aria-label="${t.search}"`);
      expect(markup).toContain('class="online-dot offline"');
      expect(markup).toContain(`title="${t.offline}"`);
    });

    it("keeps the Korean profile and compose shortcut contract", () => {
      const markup = renderToStaticMarkup(
        createElement(LeftRail, {
          ...baseProps,
          language: "ko",
          copy: COPY.ko,
        }),
      );
      expect(markup).toContain('href="#composer"');
      expect(markup).toContain('class="avatar avatar-small">나</span>');
      expect(markup).toContain(`title="${COPY.ko.online}"`);
    });
  });

  describe("TimelineHeader", () => {
    const baseProps: ComponentProps<typeof TimelineHeader> = {
      activeTab: "journal",
      language: "en",
      copy: t,
      onOpenShortcuts: vi.fn(),
      onManualLock: vi.fn(),
    };

    it("renders timeline title, shortcuts button, lock pill, and lock button", () => {
      const markup = renderToStaticMarkup(createElement(TimelineHeader, baseProps));
      expect(markup).toContain(t.timelineTitle);
      expect(markup).toContain(t.encrypted);
      expect(markup).toContain(t.lockVault);
      expect(markup).toContain("Shortcuts (?)");
    });

    it("renders search title when activeTab is search", () => {
      const markup = renderToStaticMarkup(
        createElement(TimelineHeader, { ...baseProps, activeTab: "search" }),
      );
      expect(markup).toContain("Search &amp; filter entries");
    });

    it("renders Korean search and shortcut accessibility labels", () => {
      const markup = renderToStaticMarkup(
        createElement(TimelineHeader, {
          ...baseProps,
          activeTab: "search",
          language: "ko",
          copy: COPY.ko,
        }),
      );
      expect(markup).toContain("기록 검색 및 필터");
      expect(markup).toContain('aria-label="키보드 단축키 안내 (?)"');
      expect(markup).toContain(`aria-label="${COPY.ko.lockVault}"`);
    });
  });

  describe("RightRail", () => {
    const baseProps: ComponentProps<typeof RightRail> = {
      language: "en",
      copy: t,
      date: { day: "13", detail: "September 13, 2026" },
      localEnvelope: null,
      storageEstimate: {
        usedMB: "1.2",
        totalMB: "500",
        percent: 1,
        isLow: false,
        remainingMB: "498.8",
      },
      isPersistentStorage: false,
      onRequestPersistent: vi.fn(),
      identityEmail: null,
      onOpenAccount: vi.fn(),
      onOpenSettings: vi.fn(),
    };

    it("renders date, privacy cards, storage estimation, and account info", () => {
      const markup = renderToStaticMarkup(createElement(RightRail, baseProps));
      expect(markup).toContain("September 13, 2026");
      expect(markup).toContain("AES-256-GCM");
      expect(markup).toContain(t.privacyTitle);
      expect(markup).toContain("1.2 of 500 MB used");
      expect(markup).toContain(t.localMode);
      expect(markup).toContain(t.requestPersistent);
    });

    it("shows user email when signed in", () => {
      const markup = renderToStaticMarkup(
        createElement(RightRail, {
          ...baseProps,
          identityEmail: "user@example.com",
          isPersistentStorage: true,
        }),
      );
      expect(markup).toContain("user@example.com");
      expect(markup).toContain("Granted");
      expect(markup).not.toContain(t.requestPersistent);
    });

    it("renders recovery-ready Korean state without a storage estimate", () => {
      const markup = renderToStaticMarkup(
        createElement(RightRail, {
          ...baseProps,
          language: "ko",
          copy: COPY.ko,
          localEnvelope: {
            wrappedVaultKey: new ArrayBuffer(0),
            wrappingNonce: new ArrayBuffer(0),
            recoverySalt: new ArrayBuffer(0),
            recoveryFormat: "base32-hkdf-sha256-v1",
            cryptoVersion: 1,
            keyVersion: 1,
          },
          storageEstimate: null,
        }),
      );
      expect(markup).toContain(`<strong>${COPY.ko.done}</strong>`);
      expect(markup).toContain("미승인");
      expect(markup).not.toContain("MB 사용 중");
      expect(markup).toContain("계정 설정 열기");
    });
  });

  describe("MobileNav", () => {
    const baseProps: ComponentProps<typeof MobileNav> = {
      activeTab: "journal",
      copy: t,
      onSelectTab: vi.fn(),
      onOpenAccount: vi.fn(),
      onOpenSettings: vi.fn(),
    };

    it("renders mobile navigation buttons with active state", () => {
      const markup = renderToStaticMarkup(createElement(MobileNav, baseProps));
      expect(markup).toContain('class="active"');
      expect(markup).toContain(t.journal);
      expect(markup).toContain(t.search);
      expect(markup).toContain(t.account);
      expect(markup).toContain(t.display);
    });

    it("moves the sole active state to search", () => {
      const markup = renderToStaticMarkup(
        createElement(MobileNav, { ...baseProps, activeTab: "search" }),
      );
      expect(occurrences(markup, 'class="active"')).toBe(1);
      expect(markup).toContain(`<button class="active" type="button"><svg`);
      expect(markup).toContain(`aria-label="${t.account}"`);
      expect(markup).toContain(`aria-label="${t.display}"`);
    });
  });

  describe("KeyboardShortcutsModal", () => {
    it("renders null when isOpen is false", () => {
      const markup = renderToStaticMarkup(
        createElement(KeyboardShortcutsModal, { isOpen: false, onClose: vi.fn(), lang: "en" }),
      );
      expect(markup).toBe("");
    });

    it("renders English shortcut keys without Korean '또는' when lang is 'en'", () => {
      const markup = renderToStaticMarkup(
        createElement(KeyboardShortcutsModal, { isOpen: true, onClose: vi.fn(), lang: "en" }),
      );
      expect(markup).toContain("Keyboard Shortcuts");
      expect(markup).toContain("Ctrl + K or /");
      expect(markup).toContain("j or ↓");
      expect(markup).toContain("k or ↑");
      expect(markup).toContain("n or c");
      expect(markup).not.toContain("또는");
    });

    it("renders Korean shortcut keys with '또는' when lang is 'ko'", () => {
      const markup = renderToStaticMarkup(
        createElement(KeyboardShortcutsModal, { isOpen: true, onClose: vi.fn(), lang: "ko" }),
      );
      expect(markup).toContain("키보드 단축키 안내");
      expect(markup).toContain("Ctrl + K 또는 /");
      expect(markup).toContain("j 또는 ↓");
      expect(markup).toContain("k 또는 ↑");
      expect(markup).toContain("n 또는 c");
    });
  });
});

