import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bindRemoteScope } from "../app/lib/vault/remote-state";
import { createRecoveryKit, getSyncSnapshot, hasPinLock, listEntries, purgeAccountVaultData,
  saveEntry, setupPinLock } from "../app/lib/local-vault";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

it("preserves another account’s local records when a server account is deleted", async () => {
  await saveEntry({ id: crypto.randomUUID(), text: "keep this vault", createdAt: new Date().toISOString() });
  await bindRemoteScope("api|other");
  expect(await purgeAccountVaultData("api|owner")).toBe(false);
  expect((await listEntries())[0].text).toBe("keep this vault");
});

it("preserves unlinked local entries", async () => {
  await saveEntry({ id: crypto.randomUUID(), text: "local only", createdAt: new Date().toISOString() });
  expect(await purgeAccountVaultData("api|owner")).toBe(false);
  expect(await listEntries()).toHaveLength(1);
});

it("clears the matching account’s vault, PIN and unsent changes together", async () => {
  await createRecoveryKit();
  await bindRemoteScope("api|owner");
  await saveEntry({ id: crypto.randomUUID(), text: "remove this vault", createdAt: new Date().toISOString() });
  await setupPinLock("123456");
  expect((await getSyncSnapshot()).pending).toBeGreaterThan(0);
  expect(await purgeAccountVaultData("api|owner")).toBe(true);
  expect(await hasPinLock()).toBe(false);
  expect(await listEntries()).toHaveLength(0);
  expect((await getSyncSnapshot()).pending).toBe(0);
});
