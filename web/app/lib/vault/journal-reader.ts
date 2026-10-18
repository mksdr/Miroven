import { PERSONA_DOCUMENT_ID } from "../persona";
import type { JournalEntry, JournalImage, StoredEntry } from "./types";
import { orderJournalEntries } from "../entry-pins";
import { ENTRY_STORE, SYNC_META_STORE } from "./contracts";
import { openVaultDatabase, requestToPromise } from "./idb";
import { getDeviceKey } from "./device-key";
import { JournalReadCache, readKeyIdentity, type JournalEntrySummary } from "./read-cache";
import { mapWithBudget, performancePolicy, prefersLowSpecMode } from "../performance-policy";

/** Per-screen plaintext caches; callers must clear them when locking or unmounting. */
export function createJournalReader(decryptEntry: (key: CryptoKey, record: StoredEntry) => Promise<JournalEntry>, lowSpecMode = prefersLowSpecMode()) {
  const cache = new JournalReadCache(lowSpecMode);
  let generation = 0;
  let mode = lowSpecMode;
  type ReadOptions = { signal?: AbortSignal };

  async function read<T>(options: ReadOptions, action: (
    database: IDBDatabase,
    context: { keyIdentity: string; decrypt: (record: StoredEntry) => Promise<JournalEntry>; check: () => void },
  ) => Promise<T>, includeKeyIdentity = true): Promise<T> {
    const started = generation;
    const check = () => {
      options.signal?.throwIfAborted();
      if (started !== generation) throw new DOMException("Reader cleared", "AbortError");
    };
    check();
    const database = await openVaultDatabase();
    try {
      check();
      // Always check current key availability, including on cache hits.
      const key = await getDeviceKey(database);
      const keyIdentity = includeKeyIdentity ? await readKeyIdentity(key) : "";
      check();
      return await action(database, { keyIdentity, decrypt: (record) => decryptEntry(key, record), check });
    } finally { database.close(); }
  }

  async function getRecord(database: IDBDatabase, id: string): Promise<StoredEntry> {
    const record = await requestToPromise(database.transaction(ENTRY_STORE, "readonly").objectStore(ENTRY_STORE).get(id)) as StoredEntry | undefined;
    if (!record) throw new Error("기록을 찾을 수 없습니다.");
    return record;
  }

  return {
    configure(low: boolean) { mode = low; cache.configure(low); },
    clear() { generation++; cache.clear(); },
    missingQuoteState(id: string, options: ReadOptions = {}): Promise<"deleted" | "missing"> {
      return read(options, async (database, context) => {
        const revision = await requestToPromise(database.transaction(SYNC_META_STORE, "readonly").objectStore(SYNC_META_STORE).get(`revision:${id}`));
        context.check();
        return typeof revision === "number" ? "deleted" : "missing";
      }, false);
    },
    cacheStats: () => cache.stats(),
    list(options: ReadOptions = {}): Promise<JournalEntrySummary[]> {
      return read(options, async (database, context) => {
        const records = await requestToPromise(database.transaction(ENTRY_STORE, "readonly").objectStore(ENTRY_STORE).getAll()) as StoredEntry[];
        context.check();
        const policy = performancePolicy(mode);
        const summaries = await mapWithBudget(records.filter(record => record.id !== PERSONA_DOCUMENT_ID), (record) => cache.summary(record, context), {
          concurrency: policy.decryptConcurrency, workSliceMs: policy.workSliceMs, signal: options.signal,
        });
        context.check();
        cache.prune(new Set(records.map((record) => record.id)));
        return orderJournalEntries(summaries);
      });
    },
    summary(id: string, options: ReadOptions = {}, knownEntry?: JournalEntry): Promise<JournalEntrySummary> {
      return read(options, async (database, context) => cache.summary(await getRecord(database, id), context, knownEntry));
    },
    image(summary: JournalEntrySummary, options: ReadOptions = {}): Promise<JournalImage | undefined> {
      return read(options, async (database, context) => cache.image(await getRecord(database, summary.id), summary, context));
    },
    images(summary: JournalEntrySummary, options: ReadOptions = {}): Promise<JournalImage[]> {
      return read(options, async (database, context) => cache.imageList(await getRecord(database, summary.id), summary, context));
    },
  };
}

export type JournalReader = ReturnType<typeof createJournalReader>;

