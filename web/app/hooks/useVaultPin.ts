"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getPinLockoutRemainingSeconds,
  hasPinLock,
  isVaultLocked,
  LegacyPinKeyMismatchError,
  removePinLock,
  setupPinLock,
  unlockVaultWithPin,
} from "../lib/local-vault";
import type { Language } from "./useAppearance";
import { subscribeToVaultLocks } from "../lib/vault/key-session";

type VaultPinOptions = {
  language: Language;
  onUnlocked: () => Promise<void>;
  showToast: (message: string) => void;
  setVaultLocked: (locked: boolean) => void;
};

function formatLockoutBeforeMessage(seconds: number, language: Language): string {
  return language === "ko"
    ? `연속 입력 실패로 인해 ${seconds}초 후 다시 시도할 수 있습니다.`
    : `Too many failed attempts. Try again in ${seconds} seconds.`;
}

function formatPinFailureMessage(remainingSeconds: number, language: Language): string {
  if (remainingSeconds > 0) {
    return language === "ko"
      ? `연속 입력 실패로 인해 ${remainingSeconds}초 동안 시도가 제한됩니다.`
      : `Too many failed attempts. Locked for ${remainingSeconds} seconds.`;
  }
  return language === "ko" ? "올바른 PIN 번호가 아닙니다." : "Incorrect PIN.";
}

function formatPinError(error: unknown, language: Language): string {
  if (error instanceof LegacyPinKeyMismatchError) {
    return language === "ko" ? error.message : "The existing vault key and PIN settings do not match. Keep the original browser data and recovery code; do not clear them.";
  }
  return language === "ko" ? "금고를 열지 못했습니다. 다시 시도해 주세요." : "Could not open the vault. Please retry.";
}

export function useVaultPin({
  language,
  onUnlocked,
  showToast,
  setVaultLocked,
}: VaultPinOptions) {
  const [isPinConfigured, setIsPinConfigured] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSetupOpen, setPinSetupOpen] = useState(false);
  const [pinRemoveOpen, setPinRemoveOpen] = useState(false);

  useEffect(() => {
    void hasPinLock().then(setIsPinConfigured);
    void isVaultLocked().then((locked) => {
      if (locked) setVaultLocked(true);
    });
  }, [setVaultLocked]);

  useEffect(() => subscribeToVaultLocks(() => {
    setPinInput("");
    setPinError(null);
    setPinSetupOpen(false);
    setPinRemoveOpen(false);
    void hasPinLock().then(setIsPinConfigured);
  }), []);

  const handlePinUnlock = async () => {
    if (!pinInput.trim()) return;
    const remainingBefore = await getPinLockoutRemainingSeconds();
    if (remainingBefore > 0) {
      setPinError(formatLockoutBeforeMessage(remainingBefore, language));
      return;
    }

    let unlocked: boolean;
    try {
      unlocked = await unlockVaultWithPin(pinInput.trim());
    } catch (error) {
      setPinError(formatPinError(error, language));
      return;
    }
    if (unlocked) {
      setPinInput("");
      setPinError(null);
      await onUnlocked();
      return;
    }

    const remainingAfter = await getPinLockoutRemainingSeconds();
    setPinError(formatPinFailureMessage(remainingAfter, language));
  };

  const handleSavePinSetup = async (pin: string) => {
    try {
      await setupPinLock(pin);
      setIsPinConfigured(true);
      showToast(
        language === "ko"
          ? "PIN 암호화 잠금이 설정되었습니다."
          : "PIN Vault Lock is now enabled.",
      );
    } catch {
      showToast(language === "ko" ? "PIN 설정 실패" : "Failed to setup PIN.");
      throw new Error("PIN setup failed");
    }
  };

  const handleRemovePin = () => {
    setPinRemoveOpen(true);
  };

  const handleConfirmRemovePin = async (pin: string) => {
    const remainingBefore = await getPinLockoutRemainingSeconds();
    if (remainingBefore > 0) {
      throw new Error(formatLockoutBeforeMessage(remainingBefore, language));
    }

    let removed: boolean;
    try {
      removed = await removePinLock(pin.trim());
    } catch (error) {
      throw new Error(formatPinError(error, language));
    }
    if (removed) {
      setIsPinConfigured(false);
      showToast(
        language === "ko" ? "PIN 잠금이 해제되었습니다." : "PIN Lock removed.",
      );
      return;
    }

    const remainingAfter = await getPinLockoutRemainingSeconds();
    throw new Error(formatPinFailureMessage(remainingAfter, language));
  };

  const updatePinInput = (value: string) => {
    setPinError(null);
    setPinInput(value.replace(/\D/g, "").slice(0, 8));
  };

  const resetPinState = useCallback(() => {
    setIsPinConfigured(false);
    setPinInput("");
    setPinError(null);
    setPinSetupOpen(false);
    setPinRemoveOpen(false);
  }, []);

  return {
    handleConfirmRemovePin,
    handlePinUnlock,
    handleRemovePin,
    handleSavePinSetup,
    isPinConfigured,
    pinError,
    pinInput,
    pinRemoveOpen,
    pinSetupOpen,
    setPinRemoveOpen,
    setPinSetupOpen,
    updatePinInput,
    resetPinState,
  };
}
