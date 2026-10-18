"use client";

import { useLayoutEffect, useRef } from "react";

export function DeleteEntryModal({
  language,
  title,
  description,
  deleting,
  onClose,
  onConfirm,
}: {
  language: "ko" | "en";
  title: string;
  description: string;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    cancelRef.current?.focus();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog delete-entry-dialog"
      aria-labelledby="delete-entry-title"
      aria-describedby="delete-entry-description"
      aria-busy={deleting}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (!first || !last) {
          event.preventDefault();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || deleting) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <header className="settings-dialog-header">
        <button
          type="button"
          className="dialog-close"
          aria-label={language === "ko" ? "닫기" : "Close"}
          disabled={deleting}
          onClick={onClose}
        >
          ×
        </button>
        <div>
          <h2 id="delete-entry-title">{title}</h2>
          <p id="delete-entry-description">{description}</p>
        </div>
      </header>
      <div className="modal-action-row">
        <button
          ref={cancelRef}
          type="button"
          className="edit-button btn-pill"
          disabled={deleting}
          onClick={onClose}
        >
          {language === "ko" ? "취소" : "Cancel"}
        </button>
        <button
          type="button"
          className={`btn-delete-confirm ${deleting ? "inactive" : "active"}`}
          disabled={deleting}
          onClick={() => void onConfirm()}
        >
          {deleting
            ? language === "ko" ? "삭제 중..." : "Deleting..."
            : language === "ko" ? "삭제" : "Delete"}
        </button>
      </div>
    </dialog>
  );
}
