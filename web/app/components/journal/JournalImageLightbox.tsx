"use client";
import { useEffect, useRef } from "react";
import "./JournalImageLightbox.css";

export type JournalLightboxImage = {
  src: string;
  alt: string;
  gallery?: Array<{ src: string; alt: string }>;
  index?: number;
};

export function JournalImageLightbox({
  image,
  dialogLabel,
  closeLabel,
  onClose,
  onNavigate,
  language = "ko",
}: {
  image: JournalLightboxImage | null;
  dialogLabel: string;
  closeLabel: string;
  onClose: () => void;
  onNavigate?: (index: number) => void;
  language?: "ko" | "en";
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const isOpen = Boolean(image);
  const count = image?.gallery?.length ?? 1;
  const index = image?.index ?? 0;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => { document.body.style.overflow = overflow; previous?.focus(); };
  }, [isOpen]);
  useEffect(() => {
    if (!image) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        onNavigate?.((index + (event.key === "ArrowRight" ? 1 : count - 1)) % count);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [image, count, index, onClose, onNavigate]);
  if (!image) return null;

  return (
    <div
      className="lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={dialogLabel}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (count > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          event.stopPropagation();
          onNavigate?.((index + (event.key === "ArrowRight" ? 1 : count - 1)) % count);
        }
        if (event.key === "Tab") {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}
    >
      <div
        className="lightbox-container"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButton}
          type="button"
          onClick={onClose}
          className="lightbox-close-btn"
          aria-label={closeLabel}
        >
          ✕
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.src} alt={image.alt} className="lightbox-img" />
        {count > 1 ? <div className="lightbox-navigation">
          <button type="button" aria-label={language === "ko" ? "이전 사진" : "Previous photo"}
            onClick={() => onNavigate?.((index + count - 1) % count)}>←</button>
          <span role="status" aria-live="polite">{index + 1} / {count}</span>
          <button type="button" aria-label={language === "ko" ? "다음 사진" : "Next photo"}
            onClick={() => onNavigate?.((index + 1) % count)}>→</button>
        </div> : null}
      </div>
    </div>
  );
}
