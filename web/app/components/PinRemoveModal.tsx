"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { isValidPinFormat, MAX_PIN_LENGTH } from "../lib/vault/pin-lock";

type PinRemoveModalProps = {
  isOpen: boolean;
  language: "ko" | "en";
  onClose: () => void;
  onRemovePin: (pin: string) => Promise<void>;
};

export function PinRemoveModal({
  isOpen,
  language,
  onClose,
  onRemovePin,
}: PinRemoveModalProps) {
  const [currentPin, setCurrentPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const modalRef = useRef<HTMLElement>(null);

  const handleClose = useCallback(() => {
    setCurrentPin("");
    setError(null);
    setIsRemoving(false);
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isRemoving, handleClose]);

  if (!isOpen) return null;

  const isValidFormat = isValidPinFormat(currentPin);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isRemoving) return;

    if (!currentPin) {
      setError(language === "ko" ? "PIN 번호를 입력해 주세요." : "Please enter your PIN.");
      return;
    }

    if (!isValidFormat) {
      setError(
        language === "ko"
          ? "PIN은 4~8자리의 숫자입니다."
          : "PIN must be 4 to 8 digits."
      );
      return;
    }

    setError(null);
    setIsRemoving(true);
    try {
      await onRemovePin(currentPin);
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : null;
      setError(
        msg ||
          (language === "ko"
            ? "PIN 번호가 올바르지 않습니다."
            : "Incorrect PIN.")
      );
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isRemoving) handleClose();
      }}
    >
      <section
        ref={modalRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-remove-title"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && !isRemoving) {
            event.preventDefault();
            event.stopPropagation();
            handleClose();
          }
        }}
      >
        <header className="settings-dialog-header">
          <button
            className="dialog-close"
            type="button"
            onClick={handleClose}
            disabled={isRemoving}
            aria-label={language === "ko" ? "닫기" : "Close"}
          >
            ×
          </button>
          <div>
            <h2 id="pin-remove-title">
              {language === "ko" ? "🔓 PIN 잠금 해제" : "🔓 Remove PIN Lock"}
            </h2>
            <p className="subtext-13">
              {language === "ko"
                ? "기기 금고의 암호화 잠금을 해제하려면 현재 PIN 번호를 입력하세요."
                : "Enter your current PIN to remove the vault lock."}
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="settings-group settings-group-compact">
            <p className="pin-setup-desc">
              {language === "ko"
                ? "PIN 잠금을 해제하면 이 기기에서 PIN 입력 없이 금고에 접근할 수 있게 됩니다. 공용 기기인 경우 잠금 유지를 권장합니다."
                : "Removing PIN lock will allow accessing your vault on this device without a PIN. Keeping it enabled is recommended on shared devices."}
            </p>

            <div className="pin-setup-stack">
              <div>
                <label
                  htmlFor="remove-pin-input"
                  className="bold-label-13"
                >
                  {language === "ko" ? "현재 PIN 번호:" : "Current PIN:"}
                </label>
                <input
                  id="remove-pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={MAX_PIN_LENGTH}
                  className="search-input input-full-rounded"
                  value={currentPin}
                  onChange={(e) => {
                    setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH));
                    if (error) setError(null);
                  }}
                  placeholder="******"
                  disabled={isRemoving}
                  autoComplete="off"
                  autoFocus
                />
              </div>

              {error && (
                <div className="alert-box-danger">
                  <span>⚠️</span>
                  <span>{error}</span>
                </div>
              )}
            </div>
          </div>

          <div className="modal-action-row">
            <button
              type="button"
              className="edit-button btn-pill"
              onClick={handleClose}
              disabled={isRemoving}
            >
              {language === "ko" ? "취소" : "Cancel"}
            </button>
            <button
              type="submit"
              className={`btn-submit-pill ${isValidFormat && !isRemoving ? "active" : "inactive"}`}
              disabled={isRemoving}
            >
              {isRemoving
                ? language === "ko"
                  ? "해제 중..."
                  : "Removing..."
                : language === "ko"
                ? "PIN 잠금 해제"
                : "Remove PIN Lock"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
