import type { components } from "./api.types";
import { apiRequest, broadcastAuthChange, publishSession, refreshSession } from "./client";
export { subscribeToAuth, type AuthIdentity } from "./client";
export const getAuthIdentity = refreshSession;

export type AuthPolicy = components["schemas"]["AuthPolicyResponse"];
export async function getAuthPolicy(signal?: AbortSignal): Promise<AuthPolicy> {
  const policy = await apiRequest<AuthPolicy>("/auth/policy", { signal });
  if (!policy?.domain_groups || !["DEFAULT", "KR", "JP"].every((group) => {
    const domains = policy.domain_groups[group as keyof AuthPolicy["domain_groups"]];
    return Array.isArray(domains) && domains.every((domain) => typeof domain === "string");
  })) throw new Error("Invalid authentication policy");
  const blocked = policy.blocked_local_part_characters;
  if (blocked !== undefined && (!Array.isArray(blocked)
    || !blocked.every((character) => character === "+" || character === "."))) {
    throw new Error("Invalid authentication policy");
  }
  return policy;
}

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
