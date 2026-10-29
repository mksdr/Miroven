import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEncryptedBackup,
  createRecoveryKit,
  importEncryptedBackup,
  listEntries,
  saveEntry,
} from "../app/lib/local-vault";
import {
  VAULT_DATABASE_CONTRACT,
  VAULT_FORMAT_CONTRACT,
} from "../app/lib/vault/contracts";
import { openVaultDatabase } from "../app/lib/vault/idb";
import legacyBackupV1 from "./fixtures/legacy-backup-v1.json";

const LEGACY_BACKUP_RECOVERY_CODE =
  "3P2ZZ-A4763-F7KD3-KPBSY-9HVBT-L5QK8-PTQ4C-PECJ6-23";
const LEGACY_DATABASE_ENTRY = {
  id: "legacy-v2-entry",
  marker: "must survive the v2 to v3 upgrade",
};

function deleteTestDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(VAULT_DATABASE_CONTRACT.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("테스트 금고 초기화 실패"));
    request.onblocked = () => reject(new Error("테스트 금고 연결이 닫히지 않았습니다."));
  });
}

function createVersion2Database(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VAULT_DATABASE_CONTRACT.name, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore(VAULT_DATABASE_CONTRACT.stores.entries, {
        keyPath: "id",
      });
      database.createObjectStore(VAULT_DATABASE_CONTRACT.stores.deviceKeys);
      database.createObjectStore(VAULT_DATABASE_CONTRACT.stores.vaultEnvelopes, {
        keyPath: "id",
      });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(
        VAULT_DATABASE_CONTRACT.stores.entries,
        "readwrite",
      );
      transaction
        .objectStore(VAULT_DATABASE_CONTRACT.stores.entries)
        .put(LEGACY_DATABASE_ENTRY);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

describe("vault compatibility contracts", () => {
  beforeEach(deleteTestDatabase);
  afterEach(deleteTestDatabase);

  it("keeps the IndexedDB name, version, and store layout stable", async () => {
    await saveEntry({
      id: "018f91f0-776b-7c8a-80d8-82455b090001",
      text: "contract fixture",
      createdAt: "2026-08-11T00:00:00.000Z",
    });

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(VAULT_DATABASE_CONTRACT.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      expect(database.version).toBe(VAULT_DATABASE_CONTRACT.version);
      expect(Array.from(database.objectStoreNames).sort()).toEqual(
        Object.values(VAULT_DATABASE_CONTRACT.stores).sort(),
      );
    } finally {
      database.close();
    }
  });

  it("upgrades a version 2 database without losing existing records", async () => {
    await createVersion2Database();

    const database = await openVaultDatabase();
    try {
      expect(database.version).toBe(VAULT_DATABASE_CONTRACT.version);
      expect(Array.from(database.objectStoreNames).sort()).toEqual(
        Object.values(VAULT_DATABASE_CONTRACT.stores).sort(),
      );
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = database
          .transaction(VAULT_DATABASE_CONTRACT.stores.entries)
          .objectStore(VAULT_DATABASE_CONTRACT.stores.entries)
          .get(LEGACY_DATABASE_ENTRY.id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      expect(record).toEqual(LEGACY_DATABASE_ENTRY);
    } finally {
      database.close();
    }
  });

  it("exports the authenticated backup version without changing encryption versions", async () => {
    await saveEntry({
      id: "018f91f0-776b-7c8a-80d8-82455b090002",
      text: "backup contract fixture",
      createdAt: "2026-08-11T00:00:00.000Z",
    });
    await createRecoveryKit();
    const exported = await createEncryptedBackup();
    expect(exported.filename).toMatch(/^miroven-\d{4}-\d{2}-\d{2}\.miroven-backup\.json$/);
    const backup = JSON.parse(exported.json) as {
      format: string;
      version: number;
      vault: { recoveryFormat: string; cryptoVersion: number };
      entries: Array<{ cryptoVersion: number }>;
    };

    expect(backup.format).toBe(VAULT_FORMAT_CONTRACT.backupFormat);
    expect(backup.version).toBe(VAULT_FORMAT_CONTRACT.backupVersion);
    expect(backup.vault.recoveryFormat).toBe(VAULT_FORMAT_CONTRACT.recoveryFormat);
    expect(backup.vault.cryptoVersion).toBe(VAULT_FORMAT_CONTRACT.syncCryptoVersion);
    expect(backup.entries[0].cryptoVersion).toBe(
      VAULT_FORMAT_CONTRACT.currentEntryCryptoVersion,
    );
  });

  it("restores the committed encrypted backup v1 compatibility fixture", async () => {
    const result = await importEncryptedBackup(
      JSON.stringify(legacyBackupV1),
      LEGACY_BACKUP_RECOVERY_CODE,
    );

    expect(result).toMatchObject({ entries: 1 });
    await expect(listEntries()).resolves.toEqual([
      {
        id: "018f91f0-776b-7c8a-80d8-82455b09f001",
        text: "Miroven backup v1 compatibility fixture",
        createdAt: "2026-09-13T00:00:00.000Z",
      },
    ]);
  });

  it("rejects the retired backup format before writing vault data", async () => {
    await expect(
      importEncryptedBackup(
        JSON.stringify({
          ...legacyBackupV1,
          format: "x-style-journal-encrypted-backup",
        }),
        LEGACY_BACKUP_RECOVERY_CODE,
      ),
    ).rejects.toThrow("지원하지 않는 암호화 백업 파일입니다.");
    await expect(listEntries()).resolves.toEqual([]);
  });
});
