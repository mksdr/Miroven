"use client";

import { useSyncExternalStore, type RefObject } from "react";
import type { ComposerDraft } from "../../lib/composer-draft";

type ComposerTextProps = {
  draft: ComposerDraft;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  placeholder: string;
  disabled: boolean;
};

export function ComposerText({ draft, textareaRef, placeholder, disabled }: ComposerTextProps) {
  const text = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getServerSnapshot);
  return (
    <textarea
      ref={textareaRef}
      value={text}
      onChange={(event) => draft.set(event.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={4000}
      disabled={disabled}
    />
  );
}

type ComposerSubmitProps = {
  draft: ComposerDraft;
  hydrated: boolean;
  disabled: boolean;
  hasImage: boolean;
  label: string;
  onSubmit: () => Promise<void>;
};

export function ComposerSubmit({ draft, hydrated, disabled, hasImage, label, onSubmit }: ComposerSubmitProps) {
  const text = useSyncExternalStore(draft.subscribe, draft.getSnapshot, draft.getServerSnapshot);
  return (
    <button
      className="post-button"
      type="button"
      onClick={() => void onSubmit()}
      disabled={hydrated && (disabled || (!text.trim() && !hasImage))}
    >
      {label}
    </button>
  );
}
