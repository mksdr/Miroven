"use client";

import { useEffect, useState } from "react";
import { getAccountUsage, type AccountUsage as Usage } from "../../lib/remote/account";
import { AccountPlan } from "./AccountPlan";

export function AccountUsage({ userId, language, refreshing }: { userId: string; language: "ko" | "en"; refreshing: boolean }) {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const ko = language === "ko";
  useEffect(() => {
    let cancelled = false;
    void getAccountUsage(userId).then(value => {
      if (!cancelled) { setUsage(value); setError(false); }
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [userId, attempt, refreshing]);
  if (error) return <div className="account-usage">
    <span role="status">{ko ? "플랜과 서버 사용량을 불러오지 못했습니다." : "Could not load plan and server usage."}</span>
    <button type="button" className="edit-button" onClick={() => setAttempt(value => value + 1)}>{ko ? "플랜·사용량 다시 확인" : "Retry plan and usage"}</button>
  </div>;
  if (!usage) return <small role="status">{ko ? "플랜과 서버 사용량 확인 중…" : "Loading plan and server usage…"}</small>;
  const mb = (bytes: number) => (bytes / 1024 / 1024).toLocaleString(ko ? "ko-KR" : "en-US", { maximumFractionDigits: 2 });
  return <div className="account-usage" aria-label={ko ? "서버 사용량" : "Server usage"}>
    <AccountPlan usage={usage} language={language} />
    <strong>{ko ? "서버 사용량" : "Server usage"}</strong>
    <span>{mb(usage.storage_bytes)} / {mb(usage.storage_limit_bytes)} MiB</span>
    <progress value={usage.storage_bytes} max={usage.storage_limit_bytes} aria-label={ko ? "서버 파일 저장 공간" : "Server file storage"} />
    <small>{ko ? `기록 ${usage.entries.toLocaleString()} / ${usage.entry_limit.toLocaleString()}개 · 파일당 ${mb(usage.blob_max_bytes)} MiB`
      : `${usage.entries.toLocaleString()} / ${usage.entry_limit.toLocaleString()} entries · ${mb(usage.blob_max_bytes)} MiB per file`}</small>
    <small>{ko ? "업로드 대기 파일과 보존 중인 과거 사진도 포함합니다. 기록 수에는 삭제 표시가 포함됩니다."
      : "Includes reserved uploads and retained photo versions. Entry count includes deletion markers."}</small>
    <button type="button" className="edit-button" onClick={() => setAttempt(value => value + 1)}>{ko ? "플랜·사용량 새로고침" : "Refresh plan and usage"}</button>
  </div>;
}
