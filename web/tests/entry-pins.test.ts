import { describe, expect, it } from "vitest";
import { EntryPinLimitError } from "../app/lib/entry-pins";
import { createJournalReader, deleteEntry, listEntries, saveEntry, setEntryPinned } from "../app/lib/local-vault";
import { synchronizeJournal } from "../app/lib/journal-sync";
import { MockRemoteSyncServer, pairedDevices, TEST_USER_ID, VirtualDevice } from "./helpers/sync";

async function seed() {
  for (let i = 1; i <= 5; i++) {
    await saveEntry({ id: `entry-${i}`, text: `Entry ${i}`, createdAt: `2026-10-${10 + i}T00:00:00.000Z` });
  }
}

describe("entry pins", () => {
  it("enforces the limit across concurrent requests and frees slots on unpin/delete", async () => {
    await new VirtualDevice("pins").run(async () => {
      await seed();
      const results = await Promise.allSettled([1, 2, 3, 4].map((i) => setEntryPinned(`entry-${i}`, true)));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
      expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: new EntryPinLimitError() });
      expect((await listEntries()).filter((entry) => entry.pinnedAt)).toHaveLength(3);
      await setEntryPinned("entry-1", false);
      await setEntryPinned("entry-4", true);
      await deleteEntry("entry-2");
      await setEntryPinned("entry-5", true);
      expect((await listEntries()).filter((entry) => entry.pinnedAt).map((entry) => entry.id).sort()).toEqual(["entry-3", "entry-4", "entry-5"]);
      await expect(setEntryPinned("missing", true)).rejects.toThrow("Entry not found");
    });
  });

  it("persists pin order and preserves text, images, and the latest pin through stale edits", async () => {
    await new VirtualDevice("edit-pins").run(async () => {
      await seed();
      const image = { dataUrl: "data:image/webp;base64,AQID", width: 1, height: 1, mimeType: "image/webp" };
      await saveEntry({ ...(await listEntries()).find((entry) => entry.id === "entry-1")!, image });
      const stale = (await listEntries()).find((entry) => entry.id === "entry-1")!;
      await setEntryPinned("entry-1", true);
      await saveEntry({ ...stale, text: "Edited" });
      const reader = createJournalReader();
      const summaries = await reader.list();
      expect(summaries.map((entry) => entry.id)).toEqual(["entry-1", "entry-5", "entry-4", "entry-3", "entry-2"]);
      expect(summaries[0].pinnedAt).toBeTruthy();
      expect(summaries[0].text).toBe("Edited");
      expect(await reader.image(summaries[0])).toEqual(image);
      const pinned = (await listEntries())[0];
      await setEntryPinned("entry-1", false);
      await saveEntry({ ...pinned, text: "Edited again" });
      expect((await reader.list())[0].id).toBe("entry-5");
      expect((await listEntries()).find((entry) => entry.id === "entry-1")?.pinnedAt).toBeUndefined();
      reader.clear();
    });
  });

  it("syncs pins and resolves concurrent offline pins to the same maximum of three", async () => {
    const { a, b } = await pairedDevices();
    const server = new MockRemoteSyncServer();
    const sync = () => synchronizeJournal(TEST_USER_ID, server);
    await a.run(async () => { await seed(); await sync(); });
    await b.run(sync);
    await a.run(async () => {
      await setEntryPinned("entry-1", true);
      await setEntryPinned("entry-2", true);
      await setEntryPinned("entry-3", true);
      await sync();
    });
    await b.run(async () => {
      await setEntryPinned("entry-4", true);
      await setEntryPinned("entry-5", true);
      await sync();
    });
    await a.run(sync);
    const onA = await a.run(listEntries);
    const onB = await b.run(listEntries);
    expect(onA).toEqual(onB);
    expect(onA.filter((entry) => entry.pinnedAt)).toHaveLength(3);
    const id = onA[0].id;
    await a.run(async () => { await setEntryPinned(id, false); await sync(); });
    await b.run(sync);
    expect((await b.run(listEntries)).find((entry) => entry.id === id)?.pinnedAt).toBeUndefined();
  });
});
