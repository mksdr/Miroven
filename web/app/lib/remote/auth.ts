import type { components } from "./api.types";
import { apiRequest, broadcastAuthChange, publishSession, refreshSession } from "./client";
export { subscribeToAuth, type AuthIdentity } from "./client";
export const getAuthIdentity = refreshSession;

export async function sendLoginCode(email: string): Promise<void> {
  await apiRequest("/auth/code/request", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
}
export async function verifyOtpCode(email: string, code: string): Promise<void> {
  const session = await apiRequest<components["schemas"]["SessionResponse"]>("/auth/code/verify", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }),
  });
  publishSession(session);
  broadcastAuthChange();
}
export async function signOutCurrentDevice(expectedUserId?: string): Promise<void> {
  const userId = expectedUserId ?? (await refreshSession())?.id;
  if (userId) await apiRequest("/auth/logout", { method: "POST" }, userId);
  publishSession(null);
  broadcastAuthChange();
}

export async function signOutAllDevices(userId: string): Promise<void> {
  await apiRequest("/auth/logout-all", { method: "POST" }, userId);
  publishSession(null);
  broadcastAuthChange();
}
