import { bufferToBase64 } from "./codec";
import type { PinLockEnvelope } from "./types";

type Session = { key: CryptoKey; pin: string };
// Retain the IDBFactory wrapper for this document's lifetime: WebKit can collect
// an otherwise unreferenced wrapper and create a new one on the next access.
// Weak keys would then lose both lock listeners and an active memory session.
// Factory scopes also isolate virtual storage contexts; nothing is persisted.
const sessions = new Map<IDBFactory, Session>();
const generations = new Map<IDBFactory, number>();
const listeners = new Map<IDBFactory, Set<() => void>>();
let browserEventsStarted = false;
let channel: BroadcastChannel | undefined;
const LOCK_EVENT_KEY = "miroven:vault-lock";

export function pinIdentity(pin: PinLockEnvelope): string {
  return [bufferToBase64(pin.salt), bufferToBase64(pin.iv),
    bufferToBase64(pin.wrappedKey), pin.iterations || 100000].join(":");
}

function startBrowserEvents() {
  if (browserEventsStarted || typeof window === "undefined"
    || typeof window.addEventListener !== "function") return;
  browserEventsStarted = true;
  window.addEventListener("pagehide", () => revokeKeySession());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) revokeKeySession();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === LOCK_EVENT_KEY) revokeKeySession();
  });
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel("miroven-vault-lock");
      channel.onmessage = (event) => {
        if (event.data === "locked") revokeKeySession();
      };
    } catch { /* Use storage-event notifications if channel creation is unavailable. */ }
  }
}

export function keySessionGeneration(): number {
  startBrowserEvents();
  return generations.get(indexedDB) ?? 0;
}

export function rememberKeySession(key: CryptoKey, pin: PinLockEnvelope): void {
  startBrowserEvents();
  sessions.set(indexedDB, { key, pin: pinIdentity(pin) });
}

export function readKeySession(pin: PinLockEnvelope): CryptoKey | null {
  startBrowserEvents();
  const session = sessions.get(indexedDB);
  if (!session) return null;
  if (session.pin !== pinIdentity(pin)) {
    revokeKeySession();
    return null;
  }
  return session.key;
}

export function revokeKeySession(options: { broadcast?: boolean; notify?: boolean } = {}): void {
  startBrowserEvents();
  sessions.delete(indexedDB);
  generations.set(indexedDB, (generations.get(indexedDB) ?? 0) + 1);
  if (options.notify !== false) {
    for (const listener of listeners.get(indexedDB) ?? []) listener();
  }
  if (options.broadcast && typeof window !== "undefined") {
    try {
      if (channel) channel.postMessage("locked");
      else localStorage.setItem(LOCK_EVENT_KEY, crypto.randomUUID());
    } catch { /* Local revocation succeeds even when cross-tab messaging is unavailable. */ }
  }
}

export function subscribeToVaultLocks(listener: () => void): () => void {
  startBrowserEvents();
  const factory = indexedDB;
  let scoped = listeners.get(factory);
  if (!scoped) { scoped = new Set(); listeners.set(factory, scoped); }
  scoped.add(listener);
  return () => { scoped.delete(listener); };
}
