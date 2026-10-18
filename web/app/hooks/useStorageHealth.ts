"use client";

import { useCallback, useState } from "react";
import { requestPersistentStorage } from "../lib/local-vault";

export type StorageEstimate = {
  usedMB: string;
  totalMB: string;
  remainingMB: string;
  percent: number;
  isLow: boolean;
};

export function useStorageHealth() {
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate | null>(null);
  const [isPersistentStorage, setIsPersistentStorage] = useState(false);

  const refreshStorageInfo = useCallback(async () => {
    if (navigator.storage?.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const usageBytes = estimate.usage ?? 0;
        const quotaBytes = estimate.quota ?? 0;
        const remainingBytes = Math.max(0, quotaBytes - usageBytes);
        const percent = quotaBytes ? Math.round((usageBytes / quotaBytes) * 100) : 0;
        setStorageEstimate({
          usedMB: (usageBytes / (1024 * 1024)).toFixed(1),
          totalMB: (quotaBytes / (1024 * 1024)).toFixed(1),
          remainingMB: (remainingBytes / (1024 * 1024)).toFixed(1),
          percent,
          isLow: quotaBytes > 0 && (percent >= 90 || remainingBytes < 25 * 1024 * 1024),
        });
      } catch {
        // Storage estimates are optional browser capabilities.
      }
    }
    if (navigator.storage?.persisted) {
      try {
        setIsPersistentStorage(await navigator.storage.persisted());
      } catch {
        // Persistence status is optional browser capability.
      }
    }
  }, []);

  const requestPersistence = useCallback(async () => {
    const granted = await requestPersistentStorage();
    setIsPersistentStorage(granted);
    return granted;
  }, []);

  return {
    isPersistentStorage,
    refreshStorageInfo,
    requestPersistence,
    storageEstimate,
  };
}
