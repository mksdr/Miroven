"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loginCodeErrorMessage,
  otpErrorMessage,
  sendLoginCode,
  type AuthIdentity,
} from "../lib/remote";
import { purgeAccountVaultData, purgeLocalVaultData } from "../lib/local-vault";
import { ApiError, remoteScope } from "../lib/remote/client";
import {
  deleteRemoteAccount,
  getDeletionStatus,
  loadDeletionReceipt,
  saveDeletionReceipt,
  type DeletionReceipt,
} from "../lib/remote/account";
import type { Language } from "./useAppearance";

type UseAccountDeletionOptions = {
  identity: AuthIdentity | null;
  language: Language;
  nextCodeRequestAt: number;
  setNextCodeRequestAt: (timestamp: number) => void;
  onAccountDeleted: () => void;
  onSignedOut: () => void;
  showToast: (message: string) => void;
};

export function useAccountDeletion({
  identity,
  language,
  nextCodeRequestAt,
  setNextCodeRequestAt,
  onAccountDeleted,
  onSignedOut,
  showToast,
}: UseAccountDeletionOptions) {
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletionIdentity, setDeletionIdentity] = useState<AuthIdentity | null>(null);
  const [deletionMode, setDeletionMode] = useState<"local" | "server">("local");
  const [deletionReceipt, setDeletionReceipt] = useState<DeletionReceipt | null>(null);
  const [deletionStatus, setDeletionStatus] = useState<
    "pending" | "complete" | "failed" | "expired" | null
  >(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletionCodeSending, setDeletionCodeSending] = useState(false);
  const [deletionCodeSent, setDeletionCodeSent] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const receipt = loadDeletionReceipt();
      if (receipt) {
        setDeletionReceipt(receipt);
        setDeletionStatus(receipt.status);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!deletionReceipt) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await getDeletionStatus(deletionReceipt!, controller.signal);
        if (controller.signal.aborted) return;
        setDeletionStatus(result.status);
        if (result.status === "pending") timer = setTimeout(poll, 2000);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          setDeletionStatus("expired");
        } else {
          setDeletionError(
            language === "ko"
              ? "삭제 상태를 확인하지 못했습니다. 연결 후 다시 확인해 주세요."
              : "Could not check deletion status. Reconnect and check again.",
          );
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [deletionReceipt, language, pollAttempt]);

  const openDeleteModal = useCallback(() => {
    setDeletionMode(deletionReceipt || identity ? "server" : "local");
    if (!deletionReceipt) {
      setDeletionIdentity(identity);
      setDeletionCodeSent(false);
      setDeletionError(null);
    }
    setDeleteModalOpen(true);
  }, [identity, deletionReceipt]);

  const openLocalDeleteModal = useCallback(() => {
    setDeletionMode("local");
    setDeletionIdentity(null);
    setDeletionError(null);
    setDeleteModalOpen(true);
  }, []);

  const closeDeleteModal = useCallback(() => {
    if (isDeletingAccount) return;
    setDeleteModalOpen(false);
    if (
      deletionMode === "server" &&
      (deletionStatus === "complete" || deletionStatus === "expired")
    ) {
      saveDeletionReceipt(null);
      setDeletionReceipt(null);
      setDeletionStatus(null);
      setDeletionIdentity(null);
    }
  }, [deletionStatus, deletionMode, isDeletingAccount]);

  const requestDeletionCode = useCallback(async () => {
    if (
      !deletionIdentity?.email ||
      deletionCodeSending ||
      Date.now() < nextCodeRequestAt
    ) {
      return;
    }
    setDeletionCodeSending(true);
    setDeletionError(null);
    try {
      await sendLoginCode(deletionIdentity.email);
      setNextCodeRequestAt(Date.now() + 60_000);
      setDeletionCodeSent(true);
    } catch (error) {
      setDeletionError(loginCodeErrorMessage(error, language));
    } finally {
      setDeletionCodeSending(false);
    }
  }, [
    deletionIdentity,
    deletionCodeSending,
    nextCodeRequestAt,
    language,
    setNextCodeRequestAt,
  ]);

  const handleAccountDelete = useCallback(
    async (code?: string) => {
      if (isDeletingAccount || (deletionMode === "server" && deletionReceipt)) return;
      if (deletionIdentity && !/^[0-9]{6}$/.test(code ?? "")) return;
      setIsDeletingAccount(true);
      setDeletionError(null);
      try {
        if (deletionIdentity) {
          const receipt = await deleteRemoteAccount(deletionIdentity.id, code!);
          saveDeletionReceipt(receipt);
          setDeletionReceipt(receipt);
          setDeletionStatus(receipt.status);
          // Authentication is already revoked. Local cleanup failure must not hide acceptance.
          try {
            if (await purgeAccountVaultData(remoteScope(deletionIdentity.id))) {
              onAccountDeleted();
            } else {
              onSignedOut();
            }
          } catch {
            setDeletionError(
              language === "ko"
                ? "서버 삭제는 접수됐지만 이 기기 정리에 실패했습니다. 로컬 금고를 별도로 초기화해 주세요."
                : "Server deletion was accepted, but local cleanup failed. Clear this device’s vault separately.",
            );
          }
        } else {
          await purgeLocalVaultData();
          setDeleteModalOpen(false);
          onAccountDeleted();
          showToast(
            language === "ko"
              ? "이 기기의 로컬 금고를 초기화했습니다."
              : "The local vault on this device was cleared.",
          );
        }
      } catch (error) {
        setDeletionError(
          error instanceof ApiError && error.code === "invalid_code"
            ? otpErrorMessage(error, language)
            : language === "ko"
              ? "삭제 요청을 확인하지 못했습니다. 로컬 기록은 보존했습니다. 로그인 상태와 연결을 확인해 주세요."
              : "Could not confirm the deletion request. Local entries were preserved. Check your session and connection.",
        );
      } finally {
        setIsDeletingAccount(false);
      }
    },
    [
      deletionIdentity,
      deletionReceipt,
      deletionMode,
      isDeletingAccount,
      language,
      onAccountDeleted,
      onSignedOut,
      showToast,
    ],
  );

  const retryDeletionStatus = useCallback(() => {
    setDeletionError(null);
    setPollAttempt((value) => value + 1);
  }, []);

  return {
    closeDeleteModal,
    deleteModalOpen,
    deletionCodeSending,
    deletionCodeSent,
    deletionError,
    deletionIdentity,
    deletionMode,
    deletionReceipt,
    deletionStatus,
    handleAccountDelete,
    isDeletingAccount,
    openDeleteModal,
    openLocalDeleteModal,
    requestDeletionCode,
    retryDeletionStatus,
    setDeleteModalOpen,
  };
}
