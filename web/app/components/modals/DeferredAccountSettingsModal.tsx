"use client";

import { useEffect, useState } from "react";
import { AccountSettingsDialog } from "./AccountSettingsDialog";
import type { AccountFeatureLoadState, AccountSettingsModal, AccountSettingsModalProps } from "./AccountSettingsModal";

type Props = Omit<AccountSettingsModalProps, "backupModule" | "diagnosticsModule"> & { onLoadError: () => void };
const loadBackup = () => import("../../lib/vault/backup");
const loadDiagnostics = () => import("../../lib/diagnostics");

function useAccountFeature(load: () => Promise<unknown>): AccountFeatureLoadState {
  const [status, setStatus] = useState<AccountFeatureLoadState["status"]>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void load().then(
      () => { if (!cancelled) setStatus("ready"); },
      () => { if (!cancelled) setStatus("error"); },
    );
    return () => { cancelled = true; };
  }, [load, attempt]);
  return {
    status,
    retry: () => { setStatus("loading"); setAttempt((value) => value + 1); },
  };
}

/** Preload optional features independently so ready actions also work offline. */
export function DeferredAccountSettingsModal({ onLoadError, ...props }: Props) {
  const [Settings, setSettings] = useState<typeof AccountSettingsModal | null>(null);
  const backupModule = useAccountFeature(loadBackup);
  const diagnosticsModule = useAccountFeature(loadDiagnostics);
  useEffect(() => {
    let cancelled = false;
    void import("./AccountSettingsModal")
      .then((module) => { if (!cancelled) setSettings(() => module.AccountSettingsModal); })
      .catch(() => { if (!cancelled) onLoadError(); });
    return () => { cancelled = true; };
  }, [onLoadError]);
  if (!props.isOpen) return null;
  return Settings ? <Settings {...props} backupModule={backupModule} diagnosticsModule={diagnosticsModule} /> : (
    <AccountSettingsDialog onClose={props.onClose} language={props.language} copy={props.copy} busy>
      <p role="status">{props.language === "ko" ? "계정 설정을 불러오고 있습니다…" : "Loading Account settings…"}</p>
    </AccountSettingsDialog>
  );
}
