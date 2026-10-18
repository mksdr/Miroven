"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  isRecommendedPinLength,
  isValidPinFormat,
  MAX_PIN_LENGTH,
} from "../lib/vault/pin-lock";

type PinSetupModalProps = {
  isOpen: boolean;
  language: "ko" | "en";
  onClose: () => void;
  onSavePin: (pin: string) => Promise<void>;
};

export function PinSetupModal({
  isOpen,
  language,
  onClose,
  onSavePin,
}: PinSetupModalProps) {
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const modalRef = useRef<HTMLElement>(null);

  const handleClose = useCallback(() => {
    setNewPin("");
    setConfirmPin("");
    setError(null);
    setIsSaving(false);
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
  }, [isOpen, isSaving, handleClose]);



  if (!isOpen) return null;

  const isValidFormat = isValidPinFormat(newPin);
  const isRecommended = isRecommendedPinLength(newPin);
  const isMatching = isValidFormat && newPin === confirmPin;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSaving) return;

    if (!newPin && !confirmPin) {
      setError(language === "ko" ? "PIN 번호를 입력해 주세요." : "Please enter a PIN.");
      return;
    }

    if (!isValidFormat) {
      setError(
        language === "ko"
          ? "PIN은 4~8자리의 숫자만 가능합니다."
          : "PIN must be 4 to 8 digits."
      );
      return;
    }

    if (newPin !== confirmPin) {
      setError(
        language === "ko"
          ? "PIN 번호가 서로 일치하지 않습니다."
          : "PIN numbers do not match."
      );
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await onSavePin(newPin);
      handleClose();
    } catch {
      setError(
        language === "ko"
          ? "PIN 저장에 실패했습니다. 다시 시도해 주세요."
          : "Failed to save PIN. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="settings-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !isSaving) handleClose();
      }}
    >
      <section
        ref={modalRef}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-setup-title"
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && !isSaving) {
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
            disabled={isSaving}
            aria-label={language === "ko" ? "닫기" : "Close"}
          >
            ×
          </button>
          <div>
            <h2 id="pin-setup-title">
              {language === "ko" ? "🔒 PIN 암호화 잠금 설정" : "🔒 Setup PIN Vault Lock"}
            </h2>
            <p className="subtext-13">
              {language === "ko"
                ? "기기 금고를 안전하게 보호할 4~8자리 PIN 번호를 설정하세요."
                : "Set a 4-8 digit PIN to securely protect your local vault."}
            </p>
          </div>
        </header>

        <form onSubmit={handleSubmit}>
          <div className="settings-group settings-group-compact">
            <p className="pin-setup-desc">
              {language === "ko"
                ? "PIN은 화면 무단 열람을 방지하는 로컬 편의 잠금입니다. 브라우저 저장소 복제 및 오프라인 무차별 대입 공격에 대비하여 최소 6자리(6~8자리) 설정을 권장합니다."
                : "PIN is a local convenience lock preventing screen snooping. To protect against offline brute-force attacks on copied browser storage, 6 or more digits (6–8 digits) is recommended."}
            </p>

            <div className="pin-setup-stack">
              <div>
                <label
                  htmlFor="new-pin-input"
                  className="bold-label-13"
                >
                  {language === "ko" ? "새 PIN 번호 (4~8자리 숫자, 최소 6자리 권장):" : "New PIN (4-8 digits, 6+ recommended):"}
                </label>
                <input
                  id="new-pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={MAX_PIN_LENGTH}
                  className="search-input input-full-rounded"
                  value={newPin}
                  onChange={(e) => {
                    setNewPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH));
                    if (error) setError(null);
                  }}
                  placeholder="******"
                  disabled={isSaving}
                  autoComplete="off"
                  autoFocus
                />
              </div>

              {isValidFormat && !isRecommended && (
                <div className="pin-recommendation-box" role="status">
                  <span>💡</span>
                  <span>
                    {language === "ko"
                      ? "4~5자리 PIN은 오프라인 무차별 대입 공격에 취약할 수 있습니다. 6자리 이상 설정을 권장합니다."
                      : "4–5 digit PINs can be vulnerable to offline brute-force attacks. 6 or more digits recommended."}
                  </span>
                </div>
              )}

              {isValidFormat && isRecommended && (
                <div className="pin-recommendation-box pin-recommendation-safe" role="status">
                  <span>✅</span>
                  <span>
                    {language === "ko"
                      ? "권장 안전 길이 (6~8자리)를 충족합니다."
                      : "Meets recommended security length (6–8 digits)."}
                  </span>
                </div>
              )}

              <div>
                <label
                  htmlFor="confirm-pin-input"
                  className="bold-label-13"
                >
                  {language === "ko" ? "PIN 번호 확인:" : "Confirm PIN:"}
                </label>
                <input
                  id="confirm-pin-input"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={MAX_PIN_LENGTH}
                  className="search-input input-full-rounded"
                  value={confirmPin}
                  onChange={(e) => {
                    setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH));
                    if (error) setError(null);
                  }}
                  placeholder="******"
                  disabled={isSaving}
                  autoComplete="off"
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
              disabled={isSaving}
            >
              {language === "ko" ? "취소" : "Cancel"}
            </button>
            <button
              type="submit"
              className={`btn-submit-pill ${isMatching && !isSaving ? "active" : "inactive"}`}
              disabled={isSaving}
            >
              {isSaving
                ? language === "ko"
                  ? "저장 중..."
                  : "Saving..."
                : language === "ko"
                ? "저장 및 잠금 설정"
                : "Save PIN"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
