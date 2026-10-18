"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  isOpen: boolean;
  language: "ko" | "en";
  isDeleting: boolean;
  isServerAccount?: boolean;
  email?: string | null;
  status?: "pending" | "complete" | "failed" | "expired" | null;
  error?: string | null;
  codeSending?: boolean;
  codeSent?: boolean;
  nextCodeRequestAt?: number;
  onRequestCode?: () => Promise<void>;
  onRetryStatus?: () => void;
  onClose: () => void;
  onConfirmDelete: (code?: string) => Promise<void>;
};

export function DeleteAccountModal({
  isOpen, language, isDeleting, isServerAccount = false, email, status, error,
  codeSending = false, codeSent = false, nextCodeRequestAt = 0,
  onRequestCode, onRetryStatus, onClose, onConfirmDelete,
}: Props) {
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now);
  const modal = useRef<HTMLElement>(null);
  const ko = language === "ko";
  const keyword = isServerAccount ? (ko ? "계정 삭제" : "DELETE ACCOUNT")
    : (ko ? "로컬 금고 삭제" : "CLEAR LOCAL VAULT");
  const cooldown = Math.max(0, Math.ceil((nextCodeRequestAt - now) / 1000));
  const canDelete = confirmation.trim() === keyword && !isDeleting
    && (!isServerAccount || (codeSent && /^[0-9]{6}$/.test(code)));

  function close() { setConfirmation(""); setCode(""); onClose(); }

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab" || !modal.current) return;
      const items = modal.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href]');
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!modal.current.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    window.addEventListener("keydown", trap);
    return () => { clearInterval(timer); window.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);

  if (!isOpen) return null;
  const statusText = status === "complete"
    ? (ko ? "서버 계정과 데이터 삭제가 완료되었습니다." : "The server account and its data have been deleted.")
    : status === "failed"
    ? (ko ? "계정 접근은 차단됐지만 데이터 정리가 지연되고 있습니다. 서버 운영자에게 삭제 작업 재시도를 요청해 주세요."
      : "Account access is blocked, but cleanup needs attention. Ask your server operator to retry deletion.")
    : status === "expired"
    ? (ko ? "삭제 상태 확인 기간이 만료되었습니다. 결과는 서버 운영자에게 문의해 주세요."
      : "The deletion receipt has expired. Contact your server operator to confirm the result.")
    : (ko ? "삭제 요청이 접수되어 모든 기기의 로그인이 해제되었습니다. 서버 데이터를 정리하고 있습니다."
      : "Deletion was accepted and all sessions were revoked. Server data is being removed.");

  return <div className="settings-overlay" onMouseDown={event => {
    if (event.target === event.currentTarget && !isDeleting) close();
  }}>
    <section ref={modal} className="settings-dialog delete-account-dialog" role="dialog" aria-modal="true"
      aria-labelledby="delete-account-title" onKeyDownCapture={event => {
        if (event.key === "Escape" && !isDeleting) { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
      <header className="settings-dialog-header">
        <button className="dialog-close" type="button" onClick={close} disabled={isDeleting} aria-label={ko ? "닫기" : "Close"}>×</button>
        <div>
          <h2 id="delete-account-title" className="text-danger">{isServerAccount
            ? (ko ? "계정 및 서버 데이터 삭제" : "Delete account and server data")
            : (ko ? "로컬 금고 및 이 기기의 데이터 삭제" : "Clear local vault and device data")}</h2>
          {!status && <p className="subtext-13">{isServerAccount
            ? (ko ? `${email ?? "현재 계정"}의 서버 데이터를 삭제합니다. 필요한 기록은 먼저 백업해 주세요.`
              : `Delete server data for ${email ?? "this account"}. Export a backup first if needed.`)
            : (ko ? "이 기기의 금고를 초기화합니다. 서버 계정과 데이터는 유지됩니다."
              : "Clear this device’s vault. The server account and its data are retained.")}</p>}
        </div>
      </header>
      {error && <p role="alert" className="account-message text-danger">{error}</p>}
      {status ? <div className="settings-group">
        <p role="status" aria-live="polite">{statusText}</p>
        {(status === "pending" || status === "failed") && <button type="button" className="edit-button" onClick={onRetryStatus}>
          {ko ? "삭제 상태 다시 확인" : "Check deletion status"}
        </button>}
        <p className="subtext-13">{ko ? "다른 기기의 로컬 기록과 내보낸 백업은 직접 정리해 주세요. 서버 백업은 운영자의 보존 기간 후 제거됩니다."
          : "Clear local copies on other devices and exported backups separately. Server backups expire under the operator’s retention policy."}</p>
        <button type="button" onClick={close} disabled={isDeleting}>{ko ? "확인" : "Done"}</button>
      </div> : <form onSubmit={event => { event.preventDefault(); if (canDelete) void onConfirmDelete(isServerAccount ? code : undefined); }}>
        <div className="settings-group settings-group-compact">
          <ul className="delete-account-list">
            {isServerAccount ? <>
              <li>{ko ? "서버의 계정, 암호화 기록·사진·키 봉투와 모든 로그인 세션" : "The server account, encrypted entries, photos, key envelope and all sessions"}</li>
              <li>{ko ? "이 계정과 동기화한 이 기기의 로컬 금고·미전송 기록·PIN 설정" : "This account’s synced vault, pending entries and PIN settings on this device"}</li>
              <li>{ko ? "다른 계정의 금고와 연결 전 로컬 기록은 유지됩니다." : "Vaults for other accounts and unlinked local entries are retained."}</li>
            </> : <>
              <li>{ko ? "이 기기의 암호화 기록·사진·미전송 변경사항" : "Encrypted entries, photos and pending changes on this device"}</li>
              <li>{ko ? "이 기기의 금고 키와 PIN 설정" : "Vault keys and PIN settings on this device"}</li>
            </>}
          </ul>
          {isServerAccount && <div className="deletion-reauth">
            <p className="subtext-13">{ko ? "삭제 확인을 위한 새 6자리 이메일 코드가 필요합니다. 로그인에 사용한 코드는 재사용할 수 없습니다."
              : "Request a fresh six-digit email code. A code used to sign in cannot be reused."}</p>
            <button type="button" className="edit-button" disabled={isDeleting || codeSending || cooldown > 0} onClick={() => void onRequestCode?.()}>
              {codeSending ? (ko ? "코드 요청 중…" : "Requesting…") : cooldown > 0
                ? (ko ? `${cooldown}초 후 코드 재요청` : `Request again in ${cooldown}s`)
                : (ko ? "삭제 확인 코드 받기" : "Request deletion code")}
            </button>
            {codeSent && <p role="status" className="subtext-13">{ko ? "코드를 요청했습니다. 받은 메일의 새 코드를 입력해 주세요." : "Code requested. Enter the new code from your email."}</p>}
            <label htmlFor="delete-account-code">{ko ? "삭제 확인 코드" : "Deletion code"}</label>
            <input id="delete-account-code" className="search-input input-full-rounded" value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}
              required disabled={isDeleting || !codeSent} />
          </div>}
          <label htmlFor="delete-confirm-input" className="bold-label-13">{ko ? `확인을 위해 "${keyword}"를 입력해 주세요:` : `Type "${keyword}" to confirm:`}</label>
          <input id="delete-confirm-input" className="search-input input-full-rounded" value={confirmation}
            onChange={event => setConfirmation(event.target.value)} disabled={isDeleting} autoComplete="off" required autoFocus />
        </div>
        <div className="modal-action-row">
          <button type="button" className="edit-button btn-pill" onClick={close} disabled={isDeleting}>{ko ? "취소" : "Cancel"}</button>
          <button type="submit" className={`btn-delete-confirm ${canDelete ? "active" : "inactive"}`} disabled={!canDelete}>
            {isDeleting ? (ko ? "삭제 처리 중…" : "Deleting…") : isServerAccount
              ? (ko ? "계정 및 서버 데이터 삭제" : "Delete account and server data")
              : (ko ? "로컬 금고 삭제" : "Clear local vault")}
          </button>
        </div>
      </form>}
    </section>
  </div>;
}
