import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRemoteSyncChange, createEncryptedBackup, createJournalReader, getSyncSnapshot, importEncryptedBackup, listEntries, listPendingSyncOperations, saveEntry } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { MockRemoteSyncServer, pairedDevices, VirtualDevice } from "./helpers/sync";
import type { JournalEntry } from "../app/lib/vault/types";

const images = Array.from({ length: 4 }, (_, index) => ({
  id: `photo-${index}`, dataUrl: `data:image/webp;base64,${btoa(`photo-${index}`)}`,
  width: 640, height: 480, mimeType: "image/webp",
}));
const entry: JournalEntry = { id: "multi", text: "", createdAt: "2026-10-18T00:00:00Z", images, attachmentVersion: 2 };
const sync = (device: VirtualDevice, server: MockRemoteSyncServer) => device.run(() => synchronizeJournal("user", server));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("multiple encrypted attachments", () => {
  it("uploads every file before HTTP push, retries partial failures, and downloads every attachment", async () => {
    const { a, b } = await pairedDevices();
    await a.run(() => saveEntry(entry));
    const [operation] = await a.run(listPendingSyncOperations);
    vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "/api/v1");
    const { publishSession } = await import("../app/lib/remote/client");
    const { createHttpJournalSyncTransport } = await import("../app/lib/remote/journal-sync-transport");
    publishSession({ user_id: "user", email: "test@example.com", csrf_token: "csrf" });
    const files = new Map<string, string>();
    let pushed: Record<string, unknown> | undefined;
    let fail = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url);
      if (path.pathname.endsWith("/blobs")) {
        if (fail && files.size === 2) return Response.json({ code: "storage_unavailable" }, { status: 503 });
        files.set(path.searchParams.get("blob_id")!, String(init.body));
        expect(String(init.body)).not.toContain("data:image");
        return Response.json({});
      }
      if (path.pathname.endsWith("/sync/push")) {
        expect(files.size).toBe(4);
        pushed = JSON.parse(String(init.body));
        return Response.json({ outcome: "accepted", revision: 1, cursor: "c1" });
      }
      if (path.pathname.endsWith("/sync/changes")) {
        return Response.json({ items: [{ ...pushed, cursor: "c1" }], next_cursor: "c1", has_more: false });
      }
      return new Response(files.get(path.pathname.split("/").at(-1)!), { headers: { "Content-Type": "application/octet-stream" } });
    }));
    const transport = createHttpJournalSyncTransport("user");
    await expect(transport.pushOperation("user", operation)).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(pushed).toBeUndefined();
    fail = false;
    await transport.pushOperation("user", operation);
    expect(pushed).toMatchObject({ blob_id: null, attachment_version: 2, blob_ids: operation.blobs!.map((blob) => blob.id) });
    const page = await transport.readPage!();
    expect(page.items[0].blobs).toHaveLength(4);
    await b.run(() => applyRemoteSyncChange(page.items[0].change, page.items[0].blobs));
    expect(await b.run(listEntries)).toEqual([entry]);
  });
  it("keeps photo order and edits across devices, including removal of every photo", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    for (const count of [4, 3, 2, 1, 0]) {
      const next = { ...entry, text: count ? "" : "photos removed", images: images.slice(0, count).reverse() };
      await a.run(() => saveEntry(next));
      await sync(a, server); await sync(b, server);
      expect(await b.run(listEntries)).toEqual([next]);
    }
  });

  it("preserves the cursor and retries when any attachment is missing or tampered", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    await a.run(() => saveEntry(entry)); await sync(a, server);
    const key = "user:multi:1";
    const original = structuredClone(server.attachmentBlobs.get(key)!);
    server.attachmentBlobs.set(key, original.slice(0, 3));
    await expect(sync(b, server)).rejects.toThrow("사진 암호문");
    expect((await b.run(getSyncSnapshot)).cursor).toBe(0);
    expect(await b.run(listEntries)).toEqual([]);
    const tampered = structuredClone(original);
    new Uint8Array(tampered[3].ciphertext)[0] ^= 1;
    server.attachmentBlobs.set(key, tampered);
    await expect(sync(b, server)).rejects.toThrow();
    expect((await b.run(getSyncSnapshot)).cursor).toBe(0);
    server.attachmentBlobs.set(key, original);
    await sync(b, server);
    expect(await b.run(listEntries)).toEqual([entry]);
  });

  it("restores photos and pending uploads from encrypted backup and rejects missing backup photos", async () => {
    const { a, recoveryCode } = await pairedDevices();
    await a.run(() => saveEntry(entry));
    const backup = await a.run(createEncryptedBackup);
    const restored = new VirtualDevice("restore");
    await restored.run(() => importEncryptedBackup(backup.json, recoveryCode));
    expect(await restored.run(listEntries)).toEqual([entry]);
    expect((await restored.run(getSyncSnapshot)).pending).toBe(1);
    const server = new MockRemoteSyncServer();
    await sync(restored, server);
    expect(server.attachmentBlobs.get("user:multi:1")).toHaveLength(4);
    const broken = JSON.parse(backup.json);
    broken.outbox[0].blobs.pop();
    const fresh = new VirtualDevice("broken");
    await expect(fresh.run(() => importEncryptedBackup(JSON.stringify(broken), recoveryCode))).rejects.toThrow("무결성");
    expect(await fresh.run(listEntries)).toEqual([]);
  });

  it("keeps full photos out of summaries and rejects invalid attachment lists before saving", async () => {
    const { a } = await pairedDevices();
    await a.run(async () => {
      await saveEntry(entry);
      const reader = createJournalReader(true);
      const [summary] = await reader.list();
      expect(summary.images).toHaveLength(4);
      expect(JSON.stringify(summary)).not.toContain("data:image");
      expect(await reader.images(summary)).toEqual(images);
      reader.clear();
      expect(reader.cacheStats().images.entries).toBe(0);
      await expect(saveEntry({ ...entry, images: [...images, { ...images[0], id: "fifth" }] })).rejects.toThrow("목록");
      await expect(saveEntry({ ...entry, images: [images[0], images[0]] })).rejects.toThrow("ID");
      expect(await listEntries()).toEqual([entry]);
    });
  });
});
