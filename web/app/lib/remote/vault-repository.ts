import type { components } from "./api.types";
import type { VaultEnvelope } from "../local-vault";
import { apiRequest, ApiError } from "./client";
import { sameVaultEnvelope } from "../journal-copy";
import { toBase64, fromBase64 } from "./wire";
import { bindRemoteScope } from "../vault/remote-state";
import { remoteScope } from "./client";

export async function downloadVaultEnvelope(userId: string): Promise<VaultEnvelope | null> {
  try {
    const value = await apiRequest<components["schemas"]["VaultResponse"]>("/vault", {}, userId);
    return {
      wrappedVaultKey: fromBase64(value.wrapped_vault_key), wrappingNonce: fromBase64(value.wrapping_nonce),
      recoverySalt: fromBase64(value.recovery_salt), recoveryFormat: value.recovery_format,
      cryptoVersion: value.crypto_version, keyVersion: value.key_version,
    };
  } catch (error) {
    if (error instanceof ApiError && error.code === "vault_not_found") return null;
    throw error;
  }
}
export async function uploadVaultEnvelope(userId: string, envelope: VaultEnvelope): Promise<void> {
  await bindRemoteScope(remoteScope(userId));
  const existing = await downloadVaultEnvelope(userId);
  if (existing) {
    if (!sameVaultEnvelope(existing, envelope)) throw new Error("서버 금고가 다릅니다. 기존 복구 코드로 복구해 주세요.");
    return;
  }
  await apiRequest("/vault", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      expected_version: 0, wrapped_vault_key: toBase64(envelope.wrappedVaultKey),
      wrapping_nonce: toBase64(envelope.wrappingNonce), recovery_salt: toBase64(envelope.recoverySalt),
      recovery_format: envelope.recoveryFormat, crypto_version: 1, key_version: 1,
    }),
  }, userId);
}
