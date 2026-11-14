"use client";

import { beginDiagnosticOperation, type DiagnosticOperation } from "../../lib/diagnostic-activity";

import { useEffect, useState } from "react";
import { AccountSettingsDialog } from "./AccountSettingsDialog";
import type { AccountFeatureLoadState, AccountSettingsModal, AccountSettingsModalProps } from "./AccountSettingsModal";

type Props = Omit<AccountSettingsModalProps, "backupModule" | "diagnosticsModule"> & { onLoadError: () => void };
const loadBackup = () => import("../../lib/vault/backup");
const loadDiagnostics = () => import("../../lib/diagnostics");

function useAccountFeature(load: () => Promise<unknown>, operation: DiagnosticOperation): AccountFeatureLoadState {
  const [status, setStatus] = useState<AccountFeatureLoadState["status"]>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const finish = beginDiagnosticOperation(operation);
    void load().then(
      () => { if (!cancelled) { finish(); setStatus("ready"); } },
      (error) => { if (!cancelled) { finish("failed", error); setStatus("error"); } },
    );
    return () => { cancelled = true; finish("cancelled"); };
  }, [load, attempt, operation]);
  return {
    status,
    retry: () => { setStatus("loading"); setAttempt((value) => value + 1); },
  };
}

/** Preload optional features independently so ready actions also work offline. */
export function DeferredAccountSettingsModal({ onLoadError, ...props }: Props) {
  const [Settings, setSettings] = useState<typeof AccountSettingsModal | null>(null);
  const backupModule = useAccountFeature(loadBackup, "backup.load");
  const diagnosticsModule = useAccountFeature(loadDiagnostics, "diagnostics.load");
  useEffect(() => {
    let cancelled = false;
    const finish = beginDiagnosticOperation("account.load");
    void import("./AccountSettingsModal")
      .then((module) => { if (!cancelled) { finish(); setSettings(() => module.AccountSettingsModal); } })
      .catch((error) => { if (!cancelled) { finish("failed", error); onLoadError(); } });
    return () => { cancelled = true; finish("cancelled"); };
  }, [onLoadError]);
  if (!props.isOpen) return null;
  return Settings ? <Settings {...props} backupModule={backupModule} diagnosticsModule={diagnosticsModule} /> : (
    <AccountSettingsDialog onClose={props.onClose} language={props.language} copy={props.copy} busy>
      <p role="status">{props.language === "ko" ? "계정 설정을 불러오고 있습니다…" : "Loading Account settings…"}</p>
    </AccountSettingsDialog>
  );
}
