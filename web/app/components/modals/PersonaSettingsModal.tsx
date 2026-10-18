"use client";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_PERSONA, processPersonaAvatar, validatePersona, type Persona } from "../../lib/persona";

export function PersonaSettingsModal({ persona, language, conflict, onClose, onSave, onResolve }: {
  persona: Persona | null; language: "ko" | "en"; conflict: boolean;
  onClose: () => void; onSave: (persona: Persona, expected: Persona | null) => Promise<void>;
  onResolve: (remote: boolean) => Promise<void>;
}) {
  const ko = language === "ko";
  const [expected] = useState(persona);
  const [initial] = useState<Persona>(() => persona || { ...DEFAULT_PERSONA, name: ko ? "나" : "Me" });
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const processing = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    node?.showModal();
    return () => { mounted.current = false; node?.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, []);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const close = () => { if (!busy) { if (dirty) setDiscard(true); else onClose(); } };
  async function action(task: () => Promise<void>) {
    setBusy(true); setError("");
    try { await task(); if (mounted.current) onClose(); }
    catch { if (mounted.current) setError(ko ? "저장하지 못했습니다. 입력값을 확인해 주세요. 다른 곳에서 변경했다면 창을 닫고 다시 열어 주세요." : "Could not save. Check your fields. If changed elsewhere, close and reopen this editor."); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="settings-dialog persona-dialog" aria-labelledby="persona-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); } }}>
    <header className="settings-dialog-header">
      <button className="dialog-close" type="button" onClick={close} disabled={busy} aria-label={ko ? "닫기" : "Close"}>×</button>
      <div><h2 id="persona-title">{ko ? "프로필 편집" : "Edit profile"}</h2><p>{ko ? "내 저널에 표시할 모습을 꾸며보세요." : "Make your journal feel like you."}</p></div>
    </header>
    <form className="persona-form" onSubmit={event => { event.preventDefault(); void action(async () => { const value = { ...draft, name: draft.name.trim() }; validatePersona(value); await onSave(value, expected); }); }}>
      <div className="persona-preview">
        <span className="avatar persona-avatar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {draft.avatar ? <img src={draft.avatar} alt={ko ? "프로필 미리보기" : "Profile preview"} /> : draft.name.slice(0, 1)}
        </span>
        <div><strong>{draft.name}</strong><div>@{draft.handle}</div><p>{draft.bio}</p></div>
      </div>
      <fieldset disabled={busy || conflict}>
        <label className="persona-upload">{ko ? "프로필 이미지" : "Profile image"}<span className="persona-upload-action">{ko ? "이미지 변경" : "Change image"}</span><input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          const request = ++processing.current; setBusy(true); setError("");
          void processPersonaAvatar(file).then(avatar => { if (mounted.current && request === processing.current) setDraft(value => ({ ...value, avatar })); })
            .catch(() => { if (mounted.current && request === processing.current) setError(ko ? "20MB 이하의 PNG·JPEG·WebP 이미지를 선택해 주세요." : "Choose a PNG, JPEG or WebP image under 20 MB."); })
            .finally(() => { if (mounted.current && request === processing.current) setBusy(false); });
        }} /></label>
        <small>{ko ? "최대 100 × 100px로 축소해 저장합니다." : "Saved at a maximum of 100 × 100px."}</small>
        {draft.avatar && <button type="button" className="edit-button" onClick={() => setDraft({ ...draft, avatar: null })}>{ko ? "이미지 초기화" : "Reset image"}</button>}
        <label>{ko ? "표시 이름" : "Display name"}<input required maxLength={30} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label><span className="persona-label-head"><span>Bio</span><span>{draft.bio.length}/160</span></span><textarea maxLength={160} rows={3} value={draft.bio} onChange={event => setDraft({ ...draft, bio: event.target.value })} /></label>
        <label>ID<div className="persona-handle"><span>@</span><input required minLength={3} maxLength={20} pattern="[a-zA-Z0-9_]{3,20}" aria-label="ID" value={draft.handle} onChange={event => setDraft({ ...draft, handle: event.target.value })} /></div></label>
        <small>{ko ? "영문·숫자·밑줄 3~20자. 내 저널의 표시용 ID입니다." : "3–20 letters, numbers or underscores. A display ID for your journal."}</small>
      </fieldset>
      {conflict && <div role="alert" className="persona-conflict"><p>{ko ? "다른 기기에서도 프로필을 수정했습니다. 유지할 버전을 선택해 주세요." : "Your profile also changed on another device. Choose which version to keep."}</p>
        <button disabled={busy} type="button" onClick={() => void action(() => onResolve(false))}>{ko ? "이 기기 버전 유지" : "Keep this device’s version"}</button>
        <button disabled={busy} type="button" onClick={() => void action(() => onResolve(true))}>{ko ? "다른 기기 버전 사용" : "Use the other device’s version"}</button>
      </div>}
      {error && <p role="alert">{error}</p>}
      {discard ? <div role="alert"><p>{ko ? "저장하지 않은 변경사항을 버릴까요?" : "Discard unsaved changes?"}</p><div className="persona-actions"><button type="button" onClick={() => setDiscard(false)}>{ko ? "계속 편집" : "Keep editing"}</button><button type="button" onClick={onClose}>{ko ? "버리기" : "Discard"}</button></div></div>
        : <div className="persona-actions"><button type="button" disabled={busy} onClick={close}>{ko ? "취소" : "Cancel"}</button><button type="submit" disabled={busy || conflict}>{busy ? ko ? "처리 중…" : "Working…" : ko ? "저장" : "Save"}</button></div>}
    </form>
  </dialog>;
}
