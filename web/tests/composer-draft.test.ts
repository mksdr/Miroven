import { describe, expect, it, vi } from "vitest";
import { createComposerDraft } from "../app/lib/composer-draft";

describe("draft restore revisions", () => {
  it("detects typing followed by clearing even when the text returns to empty", () => {
    const draft = createComposerDraft();
    const restoreRevision = draft.getRevision();
    draft.set("새 글");
    draft.set("");
    expect(draft.getSnapshot()).toBe("");
    expect(draft.getRevision()).not.toBe(restoreRevision);
  });

  it("invalidates restoration on an empty reset without notifying text subscribers", () => {
    const draft = createComposerDraft();
    const listener = vi.fn();
    draft.subscribe(listener);
    const restoreRevision = draft.getRevision();
    draft.set("");
    expect(draft.getRevision()).not.toBe(restoreRevision);
    expect(listener).not.toHaveBeenCalled();
  });
});
