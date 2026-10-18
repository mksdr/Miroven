import type { JournalEntry, JournalImage, StoredEntry } from "./types";
import { entryImages, type JournalImageMetadata } from "../journal-images";

export type JournalEntrySummary = Omit<JournalEntry, "image" | "images"> & {
  image?: Omit<JournalImage, "dataUrl">;
  images?: JournalImageMetadata[];
  /** Memory-only content identity; never written to disk or sent remotely. */
  contentVersion: string;
};

type Limits = { bytes: number; entries: number };

class BoundedCache<T> {
  private values = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  constructor(private limits: Limits) {}

  get(id: string): T | undefined {
    const item = this.values.get(id);
    if (!item) return;
    this.values.delete(id);
    this.values.set(id, item);
    return item.value;
  }

  put(id: string, value: T, bytes: number) {
    this.remove(id);
    if (bytes > this.limits.bytes) return;
    this.values.set(id, { value, bytes });
    this.bytes += bytes;
    this.trim();
  }

  remove(id: string) {
    const item = this.values.get(id);
    if (item) this.bytes -= item.bytes;
    this.values.delete(id);
  }

  configure(limits: Limits) { this.limits = limits; this.trim(); }
  clear() { this.values.clear(); this.bytes = 0; }
  prune(ids: Set<string>) { for (const id of this.values.keys()) if (!ids.has(id)) this.remove(id); }
  stats() { return { entries: this.values.size, estimatedBytes: this.bytes, ...{ maxBytes: this.limits.bytes, maxEntries: this.limits.entries } }; }

  private trim() {
    while (this.bytes > this.limits.bytes || this.values.size > this.limits.entries) {
      this.remove(this.values.keys().next().value!);
    }
  }
}

const HEX_TABLE = Array.from({ length: 256 }, (_, index) =>
  index.toString(16).padStart(2, "0"),
);

function hex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let result = "";
  for (let i = 0; i < bytes.length; i++) {
    result += HEX_TABLE[bytes[i]];
  }
  return result;
}

export async function readKeyIdentity(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  try { return hex(await crypto.subtle.digest("SHA-256", raw)); }
  finally { new Uint8Array(raw).fill(0); }
}

async function contentIdentity(record: StoredEntry): Promise<string> {
  // Ciphertext MUST be hashed too: a reused IV/revision is not proof of unchanged content.
  const ciphertextHash = hex(await crypto.subtle.digest("SHA-256", record.ciphertext));
  return [record.id, record.cryptoVersion, hex(record.iv),
    record.keyNonce ? hex(record.keyNonce) : "", record.wrappedDataKey ? hex(record.wrappedDataKey) : "",
    ciphertextHash].join(":");
}

type Cached<T> = { keyIdentity: string; contentVersion: string; value: T };
type ReadContext = { keyIdentity: string; decrypt: (record: StoredEntry) => Promise<JournalEntry>; check: () => void };

export class JournalReadCache {
  private summaries = new BoundedCache<Cached<JournalEntrySummary>>({ bytes: 0, entries: 0 });
  private images = new BoundedCache<Cached<JournalImage[]>>({ bytes: 0, entries: 0 });

  constructor(lowSpecMode: boolean) { this.configure(lowSpecMode); }

  configure(low: boolean) {
    this.summaries.configure({ bytes: (low ? 8 : 32) * 1024 * 1024, entries: low ? 5000 : 20000 });
    this.images.configure({ bytes: (low ? 8 : 32) * 1024 * 1024, entries: low ? 8 : 32 });
  }

  clear() { this.summaries.clear(); this.images.clear(); }
  prune(ids: Set<string>) { this.summaries.prune(ids); this.images.prune(ids); }
  stats() { return { summaries: this.summaries.stats(), images: this.images.stats() }; }

  async summary(record: StoredEntry, context: ReadContext, knownEntry?: JournalEntry): Promise<JournalEntrySummary> {
    context.check();
    const cached = this.summaries.get(record.id);
    let contentVersion: string;
    let entry: JournalEntry;
    if (cached) {
      contentVersion = await contentIdentity(record);
      context.check();
      if (cached.contentVersion === contentVersion && cached.keyIdentity === context.keyIdentity) return cached.value;
      this.summaries.remove(record.id);
      this.images.remove(record.id);
      entry = knownEntry ?? await context.decrypt(record);
    } else if (knownEntry) {
      contentVersion = await contentIdentity(record);
      entry = knownEntry;
    } else {
      // Hash and decrypt fresh records together to avoid adding a serial crypto round-trip.
      [contentVersion, entry] = await Promise.all([contentIdentity(record), context.decrypt(record)]);
    }
    context.check();
    const summary: JournalEntrySummary = {
      id: entry.id, text: entry.text, createdAt: entry.createdAt, contentVersion,
      ...(entry.pinnedAt ? { pinnedAt: entry.pinnedAt } : {}),
      ...(entry.quotedEntryId ? { quotedEntryId: entry.quotedEntryId } : {}),
      ...(entry.image ? { image: { width: entry.image.width, height: entry.image.height, mimeType: entry.image.mimeType } } : {}),
      ...(entry.images ? { images: entry.images.map(({ id, width, height, mimeType }) => ({ id, width, height, mimeType })), attachmentVersion: 2 as const } : {}),
    };
    // Conservative string accounting plus a fixed allowance for object/map metadata.
    const bytes = 512 + 256 * entryImages(summary).length + 2 * (summary.id.length + summary.text.length + summary.createdAt.length + contentVersion.length + context.keyIdentity.length);
    this.summaries.put(record.id, { keyIdentity: context.keyIdentity, contentVersion, value: summary }, bytes);
    return summary;
  }

  async image(record: StoredEntry, summary: JournalEntrySummary, context: ReadContext): Promise<JournalImage | undefined> {
    return (await this.imageList(record, summary, context))[0];
  }

  async imageList(record: StoredEntry, summary: JournalEntrySummary, context: ReadContext): Promise<JournalImage[]> {
    context.check();
    const contentVersion = await contentIdentity(record);
    context.check();
    if (contentVersion !== summary.contentVersion) throw new Error("기록이 변경되었습니다. 목록을 새로 고친 뒤 다시 시도하세요.");
    const cached = this.images.get(record.id);
    if (cached?.contentVersion === contentVersion && cached.keyIdentity === context.keyIdentity) return cached.value;
    this.images.remove(record.id);
    const entry = await context.decrypt(record);
    context.check();
    const images = entryImages(entry);
    if (images.length) {
      this.images.put(record.id, { keyIdentity: context.keyIdentity, contentVersion, value: images },
        512 + 2 * (images.reduce((sum, image) => sum + image.dataUrl.length + 128, 0) + contentVersion.length + context.keyIdentity.length));
    }
    return images;
  }
}
