"use client";

import { useEffect, useRef } from "react";
import "./KeyboardShortcutsModal.css";

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang?: "ko" | "en";
}

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
  lang = "ko",
}: KeyboardShortcutsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus trap & Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    // Focus initial close button
    const timer = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
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
      clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isKo = lang === "ko";
  const orText = isKo ? "또는" : "or";

  const shortcuts = [
    {
      category: isKo ? "전역 (Global)" : "Global",
      items: [
        { key: "?", desc: isKo ? "단축키 도움말 열기/닫기" : "Toggle shortcut help" },
        { key: "Esc", desc: isKo ? "모달 / 라이트박스 / 검색 닫기" : "Close modal / lightbox / search" },
      ],
    },
    {
      category: isKo ? "네비게이션 (Navigation)" : "Navigation",
      items: [
        { key: "1 ~ 4", desc: isKo ? "탭 이동 (저널 / 검색 / 계정 / 설정)" : "Switch tabs (Journal / Search / Account / Settings)" },
      ],
    },
    {
      category: isKo ? "검색 (Search)" : "Search",
      items: [
        { key: `Ctrl + K ${orText} /`, desc: isKo ? "검색 입력창에 포커스" : "Focus search input" },
      ],
    },
    {
      category: isKo ? "저널 타임라인 (Timeline)" : "Timeline",
      items: [
        { key: `j ${orText} ↓`, desc: isKo ? "다음 저널 글 포커스" : "Focus next entry" },
        { key: `k ${orText} ↑`, desc: isKo ? "이전 저널 글 포커스" : "Focus previous entry" },
      ],
    },
    {
      category: isKo ? "글 작성 (Composer)" : "Composer",
      items: [
        { key: `n ${orText} c`, desc: isKo ? "새 글 작성란 포커스" : "Focus new post composer" },
        { key: "Ctrl + Enter", desc: isKo ? "작성한 저널 저장/제출" : "Submit & save journal draft" },
      ],
    },
  ];

  return (
    <div
      className="shortcuts-overlay"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        className="shortcuts-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shortcuts-header">
          <div className="shortcuts-header-title">
            <span className="shortcuts-emoji">⌨️</span>
            <h2 id="shortcuts-dialog-title">
              {isKo ? "키보드 단축키 안내" : "Keyboard Shortcuts"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={isKo ? "도움말 닫기" : "Close help"}
            className="shortcuts-close-btn"
          >
            ✕
          </button>
        </div>

        {/* Shortcuts List */}
        <div className="shortcuts-body">
          {shortcuts.map((group, idx) => (
            <div key={idx}>
              <h3 className="shortcuts-category-title">
                {group.category}
              </h3>
              <div className="shortcuts-group-card">
                {group.items.map((item, i) => (
                  <div key={i} className="shortcuts-item-row">
                    <span className="shortcuts-desc">{item.desc}</span>
                    <kbd className="kbd-badge">{item.key}</kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="shortcuts-footer-note">
          {isKo
            ? "입력창 작성 중에는 단일 키 단축키가 비활성화됩니다."
            : "Single-key shortcuts are disabled while typing inside input fields."}
        </div>
      </div>
    </div>
  );
}
