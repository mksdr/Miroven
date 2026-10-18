import type { EncryptedBlobEnvelope, RemoteSyncChange, SyncOperation } from "../local-vault";
import type { components } from "./api.types";
import { apiRequest, ApiError, remoteScope } from "./client";
import { encodeEnvelope, decodeEnvelope, toBase64 } from "./wire";
import { mapWithBudget } from "../performance-policy";

const PAGE_SIZE = "10";
const downloadBudget = { concurrency: 3, workSliceMs: 8 };

export type RemoteSyncBatchItem = { change: RemoteSyncChange; blob?: EncryptedBlobEnvelope; blobs?: EncryptedBlobEnvelope[] };
export interface JournalSyncTransport {
  pushOperation(userId: string, operation: SyncOperation): Promise<"accepted" | "conflict">;
  listChangesAfter(cursor: number | string, limit: number, userId?: string): Promise<RemoteSyncBatchItem[]>;
  scopeKey?: string;
  readPage?(cursor?: string): Promise<{ items: RemoteSyncBatchItem[]; nextCursor: string; hasMore: boolean }>;
  readSnapshot?(cursor?: string): Promise<{ items: RemoteSyncBatchItem[]; nextCursor: string | null; resumeCursor: string }>;
}

export function createHttpJournalSyncTransport(userId: string): JournalSyncTransport {
  async function convert(item: components["schemas"]["SyncChange"]): Promise<RemoteSyncBatchItem> {
    const blobs: EncryptedBlobEnvelope[] = [];
    for (const id of item.blob_ids?.length ? item.blob_ids : item.blob_id ? [item.blob_id] : []) {
      const bytes = await apiRequest<ArrayBuffer>(`/blobs/${id}`, {}, userId);
      const value = JSON.parse(new TextDecoder().decode(bytes));
      if (value.version !== 1) throw new Error("지원하지 않는 사진 봉투입니다.");
      blobs.push({ ...decodeEnvelope({ ciphertext: value.ciphertext, content_nonce: value.contentNonce,
        wrapped_data_key: value.wrappedDataKey, key_nonce: value.keyNonce, crypto_version: 1 }), id });
    }
    return { change: {
      serverCursor: item.cursor, operationId: item.operation_id, entryId: item.entry_id,
      baseRevision: item.base_revision, revision: item.revision, changeType: item.change_type,
      ...(item.payload ? { payload: decodeEnvelope(item.payload) } : {}),
    }, ...(item.attachment_version === 2 ? { blobs } : { blob: blobs[0] }) };
  }
  const transport: JournalSyncTransport = {
    scopeKey: remoteScope(userId),
    async pushOperation(_userId, operation) {
      for (const blob of operation.blobs ?? (operation.blob ? [operation.blob] : [])) {
        const payload = JSON.stringify({ version: 1, ciphertext: toBase64(blob.ciphertext),
          contentNonce: toBase64(blob.contentNonce), wrappedDataKey: toBase64(blob.wrappedDataKey), keyNonce: toBase64(blob.keyNonce) });
        const query = new URLSearchParams({ blob_id: blob.id, entry_id: operation.entryId, revision: String(operation.revision) });
        await apiRequest(`/blobs?${query}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: payload }, userId);
      }
      try {
        await apiRequest("/sync/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          operation_id: operation.operationId, entry_id: operation.entryId, base_revision: operation.baseRevision,
          revision: operation.revision, change_type: operation.changeType,
          attachment_version: operation.attachmentVersion === 2 ? 2 : 1,
          payload: operation.payload ? encodeEnvelope(operation.payload) : null,
          blob_id: operation.attachmentVersion === 2 ? null : operation.blob?.id ?? null,
          ...(operation.attachmentVersion === 2
            ? { attachment_version: 2 as const, blob_ids: (operation.blobs ?? (operation.blob ? [operation.blob] : [])).map((blob) => blob.id) } : {}),
        } satisfies components["schemas"]["SyncWrite"]) }, userId);
        return "accepted";
      } catch (error) {
        if (error instanceof ApiError && error.code === "revision_conflict") return "conflict";
        throw error;
      }
    },
    async readPage(cursor) {
      const query = new URLSearchParams({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      const page = await apiRequest<components["schemas"]["ChangePage"]>(`/sync/changes?${query}`, {}, userId);
      return { items: await mapWithBudget(page.items, convert, downloadBudget), nextCursor: page.next_cursor, hasMore: page.has_more };
    },
    async readSnapshot(cursor) {
      const query = new URLSearchParams({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
      const page = await apiRequest<components["schemas"]["SnapshotPage"]>(`/sync/snapshot?${query}`, {}, userId);
      return { items: await mapWithBudget(page.items, convert, downloadBudget), nextCursor: page.next_cursor, resumeCursor: page.resume_cursor };
    },
    async listChangesAfter(cursor) { return (await transport.readPage!(typeof cursor === "string" ? cursor : undefined)).items; },
  };
  return transport;
}
