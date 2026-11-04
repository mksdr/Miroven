import { VAULT_ENVELOPE_ID, VAULT_STORE } from "./contracts";
import { requestToPromise, withVaultDatabase } from "./idb";
import type { StoredVaultEnvelope, VaultEnvelope } from "./types";

export async function getLocalVaultEnvelope(): Promise<VaultEnvelope | null> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(VAULT_STORE, "readonly");
    const stored = (await requestToPromise(
      transaction.objectStore(VAULT_STORE).get(VAULT_ENVELOPE_ID),
    )) as StoredVaultEnvelope | undefined;
    if (!stored) return null;
    return {
      wrappedVaultKey: stored.wrappedVaultKey,
      wrappingNonce: stored.wrappingNonce,
      recoverySalt: stored.recoverySalt,
      recoveryFormat: stored.recoveryFormat,
      cryptoVersion: stored.cryptoVersion,
      keyVersion: stored.keyVersion,
    };
  });
}
