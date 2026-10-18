import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withVaultLock } from "../app/lib/vault/mutation-lock";

afterEach(() => vi.unstubAllGlobals());

describe("vault lock adapter", () => {
  it("uses distinct origin-scoped Web Locks for mutation and synchronization", async () => {
    const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => callback());
    vi.stubGlobal("navigator", { locks: { request } });
    expect(await withVaultLock("mutation", async () => 42)).toBe(42);
    expect(await withVaultLock("sync", async () => "done")).toBe("done");
    expect(request.mock.calls.map(([name]) => name)).toEqual(["private-journal:mutation", "private-journal:sync"]);
  });

  it("releases the fallback queue after a failed mutation and preserves ordering", async () => {
    vi.stubGlobal("navigator", {});
    const order: number[] = [];
    const first = withVaultLock("mutation", async () => { order.push(1); throw new Error("failed write"); });
    const second = withVaultLock("mutation", async () => { order.push(2); return "saved"; });
    await expect(first).rejects.toThrow("failed write");
    await expect(second).resolves.toBe("saved");
    expect(order).toEqual([1, 2]);
  });
});
