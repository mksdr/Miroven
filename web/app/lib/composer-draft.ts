/** A single app instance owns this store; plain text never enters global state. */
export function createComposerDraft() {
  let text = "";
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => text,
    getServerSnapshot: () => "",
    set: (next: string) => {
      if (text === next) return;
      text = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export type ComposerDraft = ReturnType<typeof createComposerDraft>;
