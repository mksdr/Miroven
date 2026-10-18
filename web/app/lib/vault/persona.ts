import { PERSONA_DOCUMENT_ID, validatePersona, type Persona } from "../persona";
import { ENTRY_STORE } from "./contracts";
import { requestToPromise, withVaultDatabase } from "./idb";
import { getStoredDeviceKey } from "./device-key";
import { decryptEntry } from "./entry-crypto";
import type { StoredEntry } from "./types";

export async function readPersona(): Promise<Persona | null> {
  return withVaultDatabase(async (database) => {
    const record = (await requestToPromise(
      database.transaction(ENTRY_STORE).objectStore(ENTRY_STORE).get(PERSONA_DOCUMENT_ID),
    )) as StoredEntry | undefined;
    if (!record) return null;
    const key = await getStoredDeviceKey(database);
    if (!key) throw new Error("Vault is locked");
    const value: unknown = JSON.parse((await decryptEntry(key, record)).text);
    validatePersona(value);
    return value;
  });
}
