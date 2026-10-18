import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PinRemoveModal } from "../app/components/PinRemoveModal";
import { PinSetupModal } from "../app/components/PinSetupModal";

describe("PIN Modals", () => {
  describe("PinRemoveModal", () => {
    const baseProps: ComponentProps<typeof PinRemoveModal> = {
      isOpen: true,
      language: "ko",
      onClose: vi.fn(),
      onRemovePin: vi.fn(),
    };

    it("renders null when isOpen is false", () => {
      const markup = renderToStaticMarkup(
        createElement(PinRemoveModal, { ...baseProps, isOpen: false }),
      );
      expect(markup).toBe("");
    });

    it("renders dialog and Korean texts when language is ko", () => {
      const markup = renderToStaticMarkup(createElement(PinRemoveModal, baseProps));
      expect(markup).toContain('id="pin-remove-title"');
      expect(markup).toContain("🔓 PIN 잠금 해제");
      expect(markup).toContain("기기 금고의 암호화 잠금을 해제하려면 현재 PIN 번호를 입력하세요.");
      expect(markup).toContain("현재 PIN 번호:");
      expect(markup).toContain("취소");
    });

    it("renders English texts when language is en", () => {
      const markup = renderToStaticMarkup(
        createElement(PinRemoveModal, { ...baseProps, language: "en" }),
      );
      expect(markup).toContain('id="pin-remove-title"');
      expect(markup).toContain("🔓 Remove PIN Lock");
      expect(markup).toContain("Enter your current PIN to remove the vault lock.");
      expect(markup).toContain("Current PIN:");
      expect(markup).toContain("Cancel");
    });

    it("has accessible dialog attributes", () => {
      const markup = renderToStaticMarkup(createElement(PinRemoveModal, baseProps));
      expect(markup).toContain('role="dialog"');
      expect(markup).toContain('aria-modal="true"');
      expect(markup).toContain('aria-labelledby="pin-remove-title"');
    });
  });

  describe("PinSetupModal", () => {
    const baseProps: ComponentProps<typeof PinSetupModal> = {
      isOpen: true,
      language: "ko",
      onClose: vi.fn(),
      onSavePin: vi.fn(),
    };

    it("renders null when isOpen is false", () => {
      const markup = renderToStaticMarkup(
        createElement(PinSetupModal, { ...baseProps, isOpen: false }),
      );
      expect(markup).toBe("");
    });

    it("renders dialog and Korean texts when language is ko", () => {
      const markup = renderToStaticMarkup(createElement(PinSetupModal, baseProps));
      expect(markup).toContain('id="pin-setup-title"');
      expect(markup).toContain("🔒 PIN 암호화 잠금 설정");
    });
  });
});
