"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "miroven:ios_pwa_prompt_dismissed";

type IosPwaPromptProps = {
  language: "ko" | "en";
};

export function IosPwaPrompt({ language }: IosPwaPromptProps) {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent;
    const isIos = /iPhone|iPad|iPod/i.test(userAgent);
    if (!isIos) return;

    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    if (isStandalone) return;

    let shouldShow = false;
    try {
      const dismissed = localStorage.getItem(DISMISS_KEY);
      if (!dismissed) {
        shouldShow = true;
      }
    } catch {
      shouldShow = true;
    }

    if (shouldShow) {
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    setShowPrompt(false);
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Ignore
    }
  };

  if (!showPrompt) return null;

  return (
    <div
      className="ios-pwa-prompt"
      role="region"
      aria-label={language === "ko" ? "iOS Safari 안내" : "iOS Safari Notice"}
    >
      <div className="ios-pwa-prompt-header">
        <div className="ios-pwa-prompt-content">
          <div className="ios-pwa-prompt-title">
            <svg
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 18h.01M12 6v6m8.5 6A9.5 9.5 0 113.5 12a9.5 9.5 0 0117 6z"
              />
            </svg>
            <span>
              {language === "ko"
                ? "iOS Safari 데이터 보호 및 홈 화면 추가 안내"
                : "iOS Safari Storage & Add to Home Screen"}
            </span>
          </div>
          <p className="ios-pwa-prompt-desc">
            {language === "ko" ? (
              <>
                Safari 브라우저 정책으로 인해 오랫동안 방문하지 않거나 저장 공간이 부족해지면 로컬 기록이 정리될 수 있습니다. Safari 하단의 공유 버튼
                <span className="ios-share-badge" title="공유 버튼">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>
                을 누르고 &apos;홈 화면에 추가&apos;를 선택하면 한결 안전하게 Miroven을 사용하실 수 있습니다. 중요 기록은 복구 코드 보관과 암호화 백업을 권장합니다.
              </>
            ) : (
              <>
                Safari browser policies may clear local storage if unvisited for extended periods or under storage pressure. Tap the Share button{" "}
                <span className="ios-share-badge" title="Share button">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </span>{" "}
                in Safari and select &apos;Add to Home Screen&apos; for better persistence. We also recommend keeping your recovery code and encrypted backups safe.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="ios-pwa-prompt-close"
          aria-label={language === "ko" ? "안내 닫기" : "Dismiss notice"}
        >
          {language === "ko" ? "닫기" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
