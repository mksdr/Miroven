"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Language } from "../../hooks/useAppearance";
import styles from "./JournalOnboarding.module.css";

const STORAGE_KEY = "miroven:onboarding:v1";
type Step = "welcome" | "writing" | "skipped" | "saved" | "done";

export function JournalOnboarding({ ready, existingUser, firstEntrySaved, language, onWrite, onRestore }: {
  ready: boolean;
  existingUser: boolean;
  firstEntrySaved: boolean;
  language: Language;
  onWrite: () => void;
  onRestore: () => void;
}) {
  const [step, setStep] = useState<Step | null>(null);
  const initialized = useRef(false);
  const currentStep = useRef<Step | null>(null);

  const transition = useCallback((next: Step) => {
    currentStep.current = next;
    setStep(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Keep this session usable when storage is unavailable. */ }
  }, []);

  // Commit guidance before paint, together with the now-ready composer. A
  // deferred insertion can move its buttons between pointerdown and pointerup.
  useLayoutEffect(() => {
    if (!ready) return;
    if (initialized.current) {
      if (existingUser && !firstEntrySaved && (currentStep.current === "welcome" || currentStep.current === "writing")) transition("done");
      return;
    }
    let saved: string | null = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* Use in-memory state. */ }
    const next: Step = saved === "writing" || saved === "skipped" || saved === "saved" || saved === "done"
      ? saved : existingUser ? "done" : "welcome";
    initialized.current = true;
    currentStep.current = next;
    setStep(next);
    if (next === "done") {
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* Optional preference. */ }
    }
  }, [ready, existingUser, firstEntrySaved, transition]);

  useLayoutEffect(() => {
    if (!firstEntrySaved) return;
    if (currentStep.current !== "done") transition("saved");
  }, [firstEntrySaved, transition]);

  if (!ready || !step || step === "done" || step === "skipped") return null;
  const ko = language === "ko";
  const welcome = step === "welcome";
  const saved = step === "saved";
  return (
    <section className={styles.card} aria-labelledby="onboarding-title">
      <div className={styles.heading}>
        <p className={styles.eyebrow}>{ko ? "Miroven 사용 안내" : "Getting started with Miroven"}</p>
        <button type="button" className="edit-button" onClick={() => transition(saved ? "done" : "skipped")} aria-label={ko ? "사용 안내 숨기기" : "Dismiss getting started"}>×</button>
      </div>
      <h2 id="onboarding-title">{welcome
        ? ko ? "나만의 기록을 남기는 공간" : "A space for your own thoughts"
        : saved ? ko ? "첫 기록을 저장했어요" : "Your first entry is saved"
          : ko ? "짧은 글이나 사진 한 장이면 충분해요" : "A few words or a photo is enough"}</h2>
      <p>{welcome
        ? ko ? "글과 사진으로 하루를 기록하세요. 기록은 이 기기에서 암호화되며 다른 사용자에게 공개되지 않아요. 로그인 없이 바로 시작할 수 있어요." : "Capture your day in words and photos. Entries are encrypted on this device and are not published to other users. You can start without signing in."
        : saved ? ko ? "기록은 이 브라우저에 저장됐어요. 브라우저 데이터를 지우거나 기기를 잃으면 기록을 잃을 수 있어요. 동기화와 별도 백업으로 보관을 준비해 보세요." : "Your entry is stored in this browser. Clearing browser data or losing your device can mean losing entries. Learn how sync and a separate backup help you keep them."
          : ko ? "아래 작성란에 오늘의 생각을 적거나 ‘사진’을 눌러 첨부한 뒤 ‘기록’을 누르세요. 예: 오늘은 산책하면서 마음이 조금 가벼워졌다." : "Write in the box below or attach a photo, then choose Save. For example: A walk helped me clear my head today."}</p>
      <div className={styles.actions}>
        {welcome ? <>
          <button type="button" className={styles.primary} onClick={() => { transition("writing"); onWrite(); }}>{ko ? "첫 기록 쓰기" : "Write your first entry"}</button>
          <button type="button" className="edit-button" onClick={() => { transition("skipped"); onRestore(); }}>{ko ? "기존 기록 이어서 사용하기" : "Continue with existing entries"}</button>
        </> : null}
        <a href={saved ? "/guide#storage" : "/guide"} target="_blank" rel="noopener noreferrer" className={saved ? styles.primary : styles.link}>
          {saved ? ko ? "기록 보관 방법 알아보기" : "Learn how to keep your entries" : ko ? "자세한 사용 안내" : "Read the user guide"}
          <span className="sr-only">{ko ? " (새 탭)" : " (new tab)"}</span>
        </a>
        {saved ? <button type="button" className="edit-button" onClick={() => transition("done")}>{ko ? "나중에" : "Later"}</button> : null}
      </div>
    </section>
  );
}
