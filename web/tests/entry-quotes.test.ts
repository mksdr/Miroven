import { describe, expect, it } from "vitest";
import { createEncryptedBackup, createJournalReader, deleteEntry, getStoredDraft, importEncryptedBackup, listEntries, listPendingSyncOperations, resolveConflictKeepBoth, saveDraft, saveEntry, setEntryPinned } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { EntryQuoteError } from "../app/lib/entry-quotes";
import { MockRemoteSyncServer, pairedDevices, VirtualDevice } from "./helpers/sync";

const original = { id: "original", text: "그때의 생각", createdAt: "2026-09-18T00:00:00Z" };
const quote = { id: "quote", text: "", quotedEntryId: original.id, createdAt: "2026-10-18T00:00:00Z", images: [], attachmentVersion: 2 as const };
const photo = { id: "photo", dataUrl: "data:image/webp;base64,AQID", width: 1, height: 1, mimeType: "image/webp" };

describe("encrypted entry quotes", () => {
  it("keeps references in summaries, preserves them through pinning/legacy edits, and allows explicit removal", async () => {
    await new VirtualDevice("quote-edits").run(async () => {
      await saveEntry(original);
      await saveEntry(quote);
      await setEntryPinned(quote.id, true);
      // A caller unaware of quotes omits the field; an updated editor supplies it explicitly.
      await saveEntry({ id: quote.id, text: "현재", createdAt: quote.createdAt });
      const reader = createJournalReader();
      expect((await reader.list()).find((entry) => entry.id === quote.id)).toMatchObject({ quotedEntryId: original.id, pinnedAt: expect.any(String) });
      await saveEntry({ ...quote, quotedEntryId: undefined, text: "인용 해제" });
      expect((await reader.list()).find((entry) => entry.id === quote.id)?.quotedEntryId).toBeUndefined();
      reader.clear();
    });
  });

  it("rejects self references and concurrent circular edits atomically", async () => {
    await new VirtualDevice("quote-cycles").run(async () => {
      await expect(saveEntry({ ...original, quotedEntryId: original.id })).rejects.toBeInstanceOf(EntryQuoteError);
      await saveEntry(original);
      await saveEntry({ ...quote, quotedEntryId: undefined, text: "둘" });
      const results = await Promise.allSettled([
        saveEntry({ ...original, quotedEntryId: quote.id }), saveEntry(quote),
      ]);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect((await listEntries()).filter((entry) => entry.quotedEntryId)).toHaveLength(1);
      await expect(saveEntry({ ...quote, quotedEntryId: " " })).rejects.toBeInstanceOf(EntryQuoteError);
    });
  });

  it("distinguishes a never-received original from a known deletion without deleting the quote", async () => {
    await new VirtualDevice("quote-missing").run(async () => {
      await saveEntry(quote); // Out-of-order records are valid.
      const reader = createJournalReader();
      expect(await reader.missingQuoteState(original.id)).toBe("missing");
      await saveEntry(original);
      expect((await reader.list()).find((entry) => entry.id === quote.id)?.quotedEntryId).toBe(original.id);
      await deleteEntry(original.id);
      expect(await reader.missingQuoteState(original.id)).toBe("deleted");
      expect(await listEntries()).toEqual([quote]);
      reader.clear();
    });
  });

  it("restores a quote-only encrypted draft", async () => {
    await new VirtualDevice("quote-draft").run(async () => {
      const draft = { text: "", quotedEntryId: original.id, updatedAt: quote.createdAt };
      await saveDraft(draft);
      expect(await getStoredDraft()).toEqual(draft);
    });
  });

  it("syncs quotes with legacy/new photos, edits, deletes and removals without duplicating original photos", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    const sync = () => synchronizeJournal("user", server);
    await a.run(async () => {
      await saveEntry({ ...original, images: [photo], attachmentVersion: 2 });
      await saveEntry(quote);
      await saveEntry({ id: "legacy-quote", text: "과거", quotedEntryId: original.id, createdAt: original.createdAt, image: photo });
      const operations = await listPendingSyncOperations();
      expect(operations.find((op) => op.entryId === quote.id)?.blobs).toEqual([]);
      expect(JSON.stringify(operations)).not.toContain("quotedEntryId");
      await sync();
    });
    await b.run(async () => {
      await sync();
      expect((await listEntries()).filter((entry) => entry.quotedEntryId)).toHaveLength(2);
      await saveEntry({ ...original, text: "바뀐 생각" });
      await sync();
    });
    await a.run(async () => {
      await sync();
      expect((await createJournalReader().list()).find((entry) => entry.id === original.id)?.text).toBe("바뀐 생각");
      await deleteEntry(original.id);
      await sync();
    });
    await b.run(async () => {
      await sync();
      expect(await createJournalReader().missingQuoteState(original.id)).toBe("deleted");
      await saveEntry({ ...quote, quotedEntryId: undefined, text: "인용 없이" });
      await sync();
    });
    await a.run(async () => {
      await sync();
      expect((await listEntries()).find((entry) => entry.id === quote.id)?.quotedEntryId).toBeUndefined();
    });
  });

  it("round-trips quote relationships and photos through encrypted backup and pending sync", async () => {
    const { a, recoveryCode } = await pairedDevices();
    await a.run(async () => { await saveEntry({ ...original, images: [photo], attachmentVersion: 2 }); await saveEntry(quote); });
    const backup = await a.run(createEncryptedBackup);
    expect(backup.json).not.toContain("quotedEntryId");
    const restored = new VirtualDevice("quote-restore");
    await restored.run(async () => {
      await importEncryptedBackup(backup.json, recoveryCode);
      expect(await listEntries()).toEqual(await a.run(listEntries));
      const server = new MockRemoteSyncServer();
      await synchronizeJournal("user", server);
      expect(server.attachmentBlobs.get("user:quote:1")).toEqual([]);
    });
  });

  it("preserves references in both copies after an offline conflict", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    const sync = () => synchronizeJournal("user", server);
    await a.run(async () => { await saveEntry(original); await saveEntry(quote); await sync(); });
    await b.run(sync);
    await a.run(async () => { await saveEntry({ ...quote, text: "A" }); await sync(); });
    await b.run(async () => {
      await saveEntry({ ...quote, text: "B" }); await sync();
      await resolveConflictKeepBoth(quote.id);
      expect((await listEntries()).filter((entry) => entry.quotedEntryId === original.id)).toHaveLength(2);
      await sync();
    });
    await a.run(async () => {
      await sync();
      expect((await listEntries()).filter((entry) => entry.quotedEntryId === original.id)).toHaveLength(2);
    });
  });
});
