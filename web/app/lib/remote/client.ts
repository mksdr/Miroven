import { beginDiagnosticOperation, clearDiagnosticActivity, diagnosticApiOperation, setDiagnosticAuthenticated } from "../diagnostic-activity";
import type { components } from "./api.types";

type Session = components["schemas"]["SessionResponse"];
export type AuthIdentity = { id: string; email: string | null };
export const apiBase = process.env.NEXT_PUBLIC_MIROVEN_API_URL?.replace(/\/$/, "") ?? "";
export const isApiConfigured = Boolean(apiBase);
let currentSession: Session | null = null;
let sessionResolved = false;
let sessionGeneration = 0;
const listeners = new Set<(identity: AuthIdentity | null) => void>();

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function apiUrl(path: string): string {
  if (!isApiConfigured) throw new Error("Miroven API가 설정되지 않았습니다.");
  const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
  const url = new URL(apiBase, origin);
  if (url.username || url.password || url.search || url.hash
    || !["http:", "https:"].includes(url.protocol)
    || (url.origin !== origin && url.protocol !== "https:"
      && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("API 주소는 HTTPS 또는 로컬 개발 주소여야 합니다.");
  }
  if (apiBase.startsWith("//")) throw new Error("API 주소에 HTTPS를 명시해 주세요.");
  return new URL(apiBase + path, origin).href;
}

export function remoteScope(userId: string): string { return `${apiUrl("")}|${userId}`; }
/** Discovery is not an account change until this document has resolved a session. */
function applySession(session: Session | null, source: "discovery" | "transition") {
  sessionGeneration++;
  const changed = currentSession?.user_id !== session?.user_id || currentSession?.email !== session?.email;
  if (source === "transition" || (sessionResolved && currentSession?.user_id !== session?.user_id)) {
    clearDiagnosticActivity();
  }
  sessionResolved = true;
  setDiagnosticAuthenticated(Boolean(session));
  currentSession = session;
  const identity = session ? { id: session.user_id, email: session.email } : null;
  if (changed) for (const listener of listeners) listener(identity);
}

/** Successful explicit authentication actions always start a new diagnostic generation. */
export function publishSession(session: Session | null) {
  applySession(session, "transition");
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, userId?: string): Promise<T> {
  const finish = beginDiagnosticOperation(diagnosticApiOperation(path));
  let status: number | undefined;
  try {
    const method = init.method ?? "GET";
    if (userId && !currentSession) await refreshSession();
    if (userId && currentSession?.user_id !== userId) {
      throw new ApiError(409, "auth_scope_changed", "로그인 계정이 변경되었습니다. 다시 확인해 주세요.");
    }
    const headers = new Headers(init.headers);
    if (userId) headers.set("X-Miroven-User-ID", userId);
    if (method !== "GET" && currentSession) headers.set("X-CSRF-Token", currentSession.csrf_token);
    const requestSession = currentSession;
    const response = await fetch(apiUrl(path), { ...init, headers, credentials: "include", cache: "no-store" });
    status = response.status;
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      if (response.status === 401 && error.code !== "invalid_code" && path !== "/account/deletion"
        && path !== "/auth/code/verify" && currentSession === requestSession) applySession(null, "discovery");
      throw new ApiError(response.status, error.code ?? "http_error", error.message ?? "서버 요청을 처리하지 못했습니다.");
    }
    if (response.status === 204) { finish("succeeded", undefined, status); return undefined as T; }
    if (response.headers.get("content-type")?.includes("application/octet-stream")) {
      const value = await response.arrayBuffer() as T;
      finish("succeeded", undefined, status);
      return value;
    }
    const value = await response.json() as T;
    finish("succeeded", undefined, status);
    return value;
  } catch (error) {
    finish(init.signal?.aborted ? "cancelled" : "failed", error, status);
    throw error;
  }
}

export async function refreshSession(): Promise<AuthIdentity | null> {
  if (!isApiConfigured) return null;
  const generation = sessionGeneration;
  try {
    const value = await apiRequest<Session>("/auth/session");
    if (generation === sessionGeneration) applySession(value, "discovery");
    return currentSession ? { id: currentSession.user_id, email: currentSession.email } : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return currentSession ? { id: currentSession.user_id, email: currentSession.email } : null;
    }
    throw error;
  }
}

export async function subscribeToAuth(listener: (identity: AuthIdentity | null) => void): Promise<() => void> {
  listeners.add(listener);
  const refresh = () => { void refreshSession().catch(() => undefined); };
  const channel = typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("miroven-auth") : null;
  if (channel) channel.onmessage = refresh;
  if (typeof window !== "undefined") window.addEventListener("focus", refresh);
  return () => {
    listeners.delete(listener);
    channel?.close();
    if (typeof window !== "undefined") window.removeEventListener("focus", refresh);
  };
}

export function broadcastAuthChange() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("miroven-auth");
  channel.postMessage("changed");
  channel.close();
}
