"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cleanupExpiredTombstones,
  cleanupOrphanedBlobs,
  getLocalVaultEnvelope,
  getSyncSnapshot,
  resolveConflictKeepBoth,
  resolveConflictUseLocal,
  sameVaultEnvelope,
  type SyncStatus,
  type VaultEnvelope,
} from "../lib/local-vault";
import { synchronizeJournal } from "../lib/journal-sync";
import {
  downloadVaultEnvelope,
  uploadVaultEnvelope,
  type AuthIdentity,
} from "../lib/remote";
import type { Language } from "./useAppearance";

type UseVaultSyncOptions = {
  identity: AuthIdentity | null;
  language: Language;
  refreshEntries: () => Promise<void>;
  showToast: (message: string) => void;
};

export function useVaultSync({
  identity,
  language,
  refreshEntries,
  showToast,
}: UseVaultSyncOptions) {
  const [online, setOnline] = useState(true);
  const [localEnvelope, setLocalEnvelope] = useState<VaultEnvelope | null>(null);
  const [remoteEnvelope, setRemoteEnvelope] = useState<VaultEnvelope | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [conflictEntryIds, setConflictEntryIds] = useState<string[]>([]);
  const syncInFlight = useRef(false);
  const syncAgain = useRef(false);
  const generation = useRef(0);

  useLayoutEffect(() => {
    generation.current++;
    syncAgain.current = false;
  }, [identity?.id]);

  const refreshLocalSyncState = useCallback(async () => {
    const [envelope, snapshot] = await Promise.all([
      getLocalVaultEnvelope(),
      getSyncSnapshot(),
    ]);
    setLocalEnvelope(envelope);
    setPendingSyncCount(snapshot.pending);
    setConflictEntryIds(snapshot.conflictEntryIds);
  }, []);

  const runSync = useCallback(async () => {
    if (!identity || !localEnvelope || !online) return;
    if (syncInFlight.current) {
      syncAgain.current = true;
      return;
    }
    syncInFlight.current = true;
    const started = generation.current;
    try {
      await uploadVaultEnvelope(identity.id, localEnvelope);
      if (started !== generation.current) return;
      do {
        syncAgain.current = false;
        setSyncStatus("syncing");
        const result = await synchronizeJournal(identity.id);
        if (started !== generation.current) return;
        setConflictEntryIds((await getSyncSnapshot()).conflictEntryIds);
        await cleanupExpiredTombstones().catch(() => 0);
        await cleanupOrphanedBlobs().catch(() => 0);
        if (result.pulled > 0) await refreshEntries();
        setPendingSyncCount(result.pending);
        setSyncStatus(result.conflicts > 0 ? "conflict" : "synced");
      } while (syncAgain.current && navigator.onLine && started === generation.current);
    } catch {
      if (started !== generation.current) return;
      const snapshot = await getSyncSnapshot().catch(() => null);
      if (snapshot) setPendingSyncCount(snapshot.pending);
      setSyncStatus("error");
    } finally {
      syncInFlight.current = false;
    }
  }, [identity, localEnvelope, online, refreshEntries]);

  const runSyncRef = useRef(runSync);
  useEffect(() => {
    runSyncRef.current = runSync;
  }, [runSync]);

  useLayoutEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      void runSyncRef.current();
    };
    const handleOffline = () => setOnline(false);
    const handleFocus = () => {
      void refreshEntries().catch(() =>
        showToast(
          language === "ko"
            ? "목록을 새로 고치지 못했습니다."
            : "Could not refresh entries.",
        ),
      );
      if (navigator.onLine) {
        setOnline(true);
        void runSyncRef.current();
      }
    };

    const initialStateTimer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      void refreshLocalSyncState().catch(() => null);
    }, 0);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("focus", handleFocus);
      window.clearTimeout(initialStateTimer);
    };
  }, [language, refreshEntries, refreshLocalSyncState, showToast]);

  useEffect(() => {
    if (!identity) return;
    const currentIdentity = identity;
    let cancelled = false;

    async function reconcileVaultEnvelope() {
      try {
        const remote = await downloadVaultEnvelope(currentIdentity.id);
        if (cancelled) return;
        if (localEnvelope) {
          if (!remote) {
            await uploadVaultEnvelope(currentIdentity.id, localEnvelope);
          } else if (!sameVaultEnvelope(localEnvelope, remote)) {
            if (!cancelled) setRemoteEnvelope(remote);
            showToast(
              language === "ko"
                ? "서버에 다른 금고 키가 존재합니다. 복구 코드로 이 기기에 통합할 수 있습니다."
                : "A different vault key exists on the server. You can restore it with your recovery code.",
            );
          }
          return;
        }
        if (!cancelled) setRemoteEnvelope(remote);
      } catch (error) {
        if (!cancelled) {
          showToast(
            error instanceof Error
              ? error.message
              : language === "ko"
                ? "암호화 키 봉투를 동기화하지 못했습니다."
                : "We couldn’t sync the encrypted key envelope.",
          );
        }
      }
    }

    void reconcileVaultEnvelope();
    return () => {
      cancelled = true;
    };
  }, [identity, language, localEnvelope, showToast]);

  useEffect(() => {
    if (!identity || !localEnvelope || !online) return;
    const syncTimer = window.setTimeout(() => void runSync(), 0);
    return () => window.clearTimeout(syncTimer);
  }, [identity, localEnvelope, online, runSync]);

  const handleResolveConflictUseLocal = useCallback(
    async (entryId: string) => {
      try {
        await resolveConflictUseLocal(entryId, { reload: false });
        await refreshEntries();
        showToast(
          language === "ko"
            ? "로컬 변경사항으로 재시도합니다."
            : "Retrying local version for sync.",
        );
      } catch {
        showToast(
          language === "ko" ? "충돌 처리 실패" : "Conflict resolution failed",
        );
      }
    },
    [language, refreshEntries, showToast],
  );

  const handleResolveConflictKeepBoth = useCallback(
    async (entryId: string) => {
      try {
        await resolveConflictKeepBoth(entryId, { reload: false });
        await refreshEntries();
        showToast(
          language === "ko"
            ? "로컬 일기를 복사본으로 보존했습니다."
            : "Saved local entry as copy.",
        );
      } catch {
        showToast(
          language === "ko" ? "충돌 처리 실패" : "Conflict resolution failed",
        );
      }
    },
    [language, refreshEntries, showToast],
  );

  const resetVaultSync = useCallback(() => {
    generation.current++;
    syncAgain.current = false;
    setLocalEnvelope(null);
    setRemoteEnvelope(null);
    setPendingSyncCount(0);
    setConflictEntryIds([]);
    setSyncStatus("local");
  }, []);

  const effectiveSyncStatus: SyncStatus = !localEnvelope
    ? "local"
    : !identity || !online
      ? "ready"
      : syncStatus;

  return {
    conflictEntryIds,
    effectiveSyncStatus,
    handleResolveConflictKeepBoth,
    handleResolveConflictUseLocal,
    localEnvelope,
    online,
    pendingSyncCount,
    refreshLocalSyncState,
    remoteEnvelope,
    resetVaultSync,
    runSync,
    setLocalEnvelope,
    setPendingSyncCount,
    setRemoteEnvelope,
    syncStatus,
  };
}
