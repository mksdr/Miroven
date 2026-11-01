"use client";

import { useEffect, useState } from "react";
import type { AccountSettingsModal, AccountSettingsModalProps } from "./AccountSettingsModal";

type Props = AccountSettingsModalProps & { onLoadError: () => void };

/** Once Account is interactive, its first backup/diagnostic action also works offline. */
export function DeferredAccountSettingsModal({ onLoadError, ...props }: Props) {
  const [Settings, setSettings] = useState<typeof AccountSettingsModal | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      import("./AccountSettingsModal"),
      import("../../lib/vault/backup"),
      import("../../lib/diagnostics"),
    ])
      .then(([module]) => { if (!cancelled) setSettings(() => module.AccountSettingsModal); })
      .catch(() => { if (!cancelled) onLoadError(); });
    return () => { cancelled = true; };
  }, [onLoadError]);
  return Settings ? <Settings {...props} /> : null;
}
