import { KEY_STORE, VAULT_RESET_TOKEN_ID } from "./contracts";
import { requestToPromise, transactionDone, withVaultDatabase } from "./idb";
import { VaultResetError } from "./operation-errors";

export async function assertVaultResetToken(keys: IDBObjectStore, expected: string): Promise<void> {
  if (await requestToPromise(keys.get(VAULT_RESET_TOKEN_ID)) !== expected) {
    throw new VaultResetError();
  }
}

export async function getOrCreateVaultResetToken(): Promise<string> {
  return withVaultDatabase(async (database) => {
    const transaction = database.transaction(KEY_STORE, "readwrite");
    const done = transactionDone(transaction);
    const keys = transaction.objectStore(KEY_STORE);
    try {
      const existing = await requestToPromise(keys.get(VAULT_RESET_TOKEN_ID));
      if (typeof existing === "string") {
        await done;
        return existing;
      }
      const token = crypto.randomUUID();
      keys.put(token, VAULT_RESET_TOKEN_ID);
      await done;
      return token;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
  });
}
