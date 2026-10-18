import type { components } from "./api.types";

type Session = components["schemas"]["SessionResponse"];
export type AuthIdentity = { id: string; email: string | null };
export const apiBase = process.env.NEXT_PUBLIC_MIROVEN_API_URL?.replace(/\/$/, "") ?? "";
export const isApiConfigured = Boolean(apiBase);
let currentSession: Session | null = null;
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
export function publishSession(session: Session | null) {
  sessionGeneration++;
  const changed = currentSession?.user_id !== session?.user_id || currentSession?.email !== session?.email;
  currentSession = session;
  const identity = session ? { id: session.user_id, email: session.email } : null;
  if (changed) for (const listener of listeners) listener(identity);
}

export async function apiRequest<T>(path: string, init: RequestInit = {}, userId?: string): Promise<T> {
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
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401 && error.code !== "invalid_code" && path !== "/account/deletion"
      && path !== "/auth/code/verify" && currentSession === requestSession) publishSession(null);
    throw new ApiError(response.status, error.code ?? "http_error", error.message ?? "서버 요청을 처리하지 못했습니다.");
  }
  if (response.status === 204) return undefined as T;
  if (response.headers.get("content-type")?.includes("application/octet-stream")) {
    return await response.arrayBuffer() as T;
  }
  return await response.json() as T;
}

export async function refreshSession(): Promise<AuthIdentity | null> {
  if (!isApiConfigured) return null;
  const generation = sessionGeneration;
  try {
    const value = await apiRequest<Session>("/auth/session");
    if (generation === sessionGeneration) publishSession(value);
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
