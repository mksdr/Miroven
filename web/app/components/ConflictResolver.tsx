"use client";

import type { JournalEntry } from "../lib/local-vault";

type ConflictResolverProps = {
  entry: Pick<JournalEntry, "id">;
  language: "ko" | "en";
  onResolveUseLocal: (entryId: string) => Promise<void>;
  onResolveKeepBoth: (entryId: string) => Promise<void>;
};

export function ConflictResolver({
  entry,
  language,
  onResolveUseLocal,
  onResolveKeepBoth,
}: ConflictResolverProps) {
  return (
    <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 text-xs text-amber-200 backdrop-blur-sm">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 font-semibold text-amber-300">
          <svg
            className="h-4 w-4 shrink-0 text-amber-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            {language === "ko"
              ? "동기화 충돌 감지됨 (서버와 이 기기의 내용이 다름)"
              : "Sync conflict detected (Server & local content differ)"}
          </span>
        </div>

        <p className="leading-relaxed opacity-90">
          {language === "ko"
            ? "다른 기기에서 동일한 기록이 수정되었습니다. 아래 버튼을 눌러 이 기기의 내용으로 유지하거나, 복사본으로 둘 다 보존하세요."
            : "This entry was modified on another device. Select how to resolve this conflict below."}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => void onResolveUseLocal(entry.id)}
            className="rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 transition-colors"
          >
            {language === "ko" ? "이 기기 내용으로 재시도" : "Use local version"}
          </button>

          <button
            type="button"
            onClick={() => void onResolveKeepBoth(entry.id)}
            className="rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/30 transition-colors"
          >
            {language === "ko" ? "복사본으로 둘 다 보존" : "Keep both as copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
