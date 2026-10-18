import {
  ENTRY_STORE,
  KEY_STORE,
  OUTBOX_STORE,
  SYNC_META_STORE,
  STAGE_STORE,
  VAULT_DATABASE_CONTRACT,
  VAULT_STORE,
} from "./contracts";

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB 요청 실패"));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("저장 실패"));
    transaction.onabort = () => reject(transaction.error ?? new Error("저장 중단"));
  });
}

export async function openVaultDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("이 브라우저에서는 로컬 금고를 사용할 수 없습니다.");
  }

  const request = indexedDB.open(
    VAULT_DATABASE_CONTRACT.name,
    VAULT_DATABASE_CONTRACT.version,
  );
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(ENTRY_STORE)) {
      database.createObjectStore(ENTRY_STORE, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(KEY_STORE)) {
      database.createObjectStore(KEY_STORE);
    }
    if (!database.objectStoreNames.contains(VAULT_STORE)) {
      database.createObjectStore(VAULT_STORE, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
      database.createObjectStore(OUTBOX_STORE, { keyPath: "operationId" });
    }
    if (!database.objectStoreNames.contains(SYNC_META_STORE)) {
      database.createObjectStore(SYNC_META_STORE);
    }
    if (!database.objectStoreNames.contains(STAGE_STORE)) {
      database.createObjectStore(STAGE_STORE, { keyPath: "id" });
    }
  };
  return requestToPromise(request);
}

export async function withVaultDatabase<T>(
  action: (database: IDBDatabase) => Promise<T>,
): Promise<T> {
  const database = await openVaultDatabase();
  try {
    return await action(database);
  } finally {
    database.close();
  }
}
