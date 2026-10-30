"use client";

import { useEffect, useRef } from "react";
import { subscribeToVaultLocks } from "../lib/vault/key-session";

export function useVaultLockEvents(onLocked: () => void) {
  const callback = useRef(onLocked);
  useEffect(() => { callback.current = onLocked; }, [onLocked]);
  useEffect(() => subscribeToVaultLocks(() => callback.current()), []);
}

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_EVENTS = ["mousemove", "keydown", "pointerdown", "touchstart", "scroll"] as const;

export function useIdleVaultLock(isVaultLocked: boolean, lockVault: () => void) {
  const idleTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (isVaultLocked) return;
    const resetIdleTimer = () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(lockVault, IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();
    IDLE_EVENTS.forEach((event) =>
      window.addEventListener(event, resetIdleTimer, { passive: true }),
    );
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      IDLE_EVENTS.forEach((event) => window.removeEventListener(event, resetIdleTimer));
    };
  }, [isVaultLocked, lockVault]);
}

export function useServiceWorkerRegistration() {
  useEffect(() => {
    const isLocalDevelopment = ["localhost", "127.0.0.1", "::1"].includes(
      window.location.hostname,
    );
    if ("serviceWorker" in navigator && isLocalDevelopment) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((item) => item.unregister())),
        )
        .catch(() => undefined);
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) =>
            Promise.all(
              keys
                .filter(
                  (key) =>
                    key.startsWith("private-journal-shell-") ||
                    key.startsWith("miroven-shell-"),
                )
                .map((key) => caches.delete(key)),
            ),
          )
          .catch(() => undefined);
      }
    } else if (
      "serviceWorker" in navigator &&
      window.location.protocol === "https:"
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
}

export function useVaultResetBroadcast(onCleared: () => void) {
  const onClearedRef = useRef(onCleared);
  useEffect(() => {
    onClearedRef.current = onCleared;
  }, [onCleared]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("miroven-vault-reset");
    channel.onmessage = (event) => {
      if (event.data === "cleared") onClearedRef.current();
    };
    return () => channel.close();
  }, []);
}
