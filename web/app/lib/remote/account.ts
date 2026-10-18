import type { components } from "./api.types";
import { apiRequest, apiUrl, broadcastAuthChange, publishSession } from "./client";

export type AccountUsage = components["schemas"]["Usage"];
export type DeletionReceipt = components["schemas"]["DeletionAccepted"];
export type DeletionStatus = components["schemas"]["DeletionStatus"];
const RECEIPT_KEY = "miroven:account-deletion";

export function getAccountUsage(userId: string): Promise<AccountUsage> {
  return apiRequest("/account/usage", {}, userId);
}

export async function deleteRemoteAccount(userId: string, code: string): Promise<DeletionReceipt> {
  const receipt = await apiRequest<DeletionReceipt>("/account", {
    method: "DELETE", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  }, userId);
  publishSession(null);
  broadcastAuthChange();
  return receipt;
}

export function getDeletionStatus(receipt: DeletionReceipt, signal?: AbortSignal): Promise<DeletionStatus> {
  return apiRequest("/account/deletion", {
    headers: { Authorization: `Bearer ${receipt.deletion_token}` }, signal,
  });
}

export function saveDeletionReceipt(receipt: DeletionReceipt | null): void {
  try {
    if (receipt) sessionStorage.setItem(RECEIPT_KEY, JSON.stringify({ api: apiUrl(""), receipt }));
    else sessionStorage.removeItem(RECEIPT_KEY);
  } catch { /* The receipt stays available in memory when session storage is unavailable. */ }
}

export function loadDeletionReceipt(): DeletionReceipt | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(RECEIPT_KEY) ?? "null");
    const receipt = saved?.receipt;
    if (saved?.api !== apiUrl("") || typeof receipt?.deletion_token !== "string"
      || !/^[A-Za-z0-9_-]{32,100}$/.test(receipt.deletion_token)
      || typeof receipt.deletion_id !== "string"
      || !["pending", "complete", "failed"].includes(receipt.status)
      || !Number.isFinite(Date.parse(receipt.expires_at))
      || Date.parse(receipt.expires_at) <= Date.now()) return null;
    return receipt;
  } catch { return null; }
}
