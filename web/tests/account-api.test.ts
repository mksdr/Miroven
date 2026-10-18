import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeletionReceipt } from "../app/lib/remote/account";

const session = { user_id: "owner", email: "owner@example.com", csrf_token: "csrf" };
const receipt: DeletionReceipt = { deletion_id: "id", deletion_token: "t".repeat(43), status: "pending",
  expires_at: "2099-01-01T00:00:00Z" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});

describe("Miroven account lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "/api/v1");
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      setItem: (key: string, value: string) => values.set(key, value),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("deletes only the asserted account with a fresh code, then publishes sign-out", async () => {
    const fetcher = vi.fn().mockResolvedValue(json(receipt, 202));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    const account = await import("../app/lib/remote/account");
    client.publishSession(session);
    const listener = vi.fn();
    const unsubscribe = await client.subscribeToAuth(listener);
    expect(await account.deleteRemoteAccount("owner", "123456")).toEqual(receipt);
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url).pathname).toBe("/api/v1/account");
    expect(options.method).toBe("DELETE");
    expect(options.headers.get("X-Miroven-User-ID")).toBe("owner");
    expect(options.headers.get("X-CSRF-Token")).toBe("csrf");
    expect(JSON.parse(options.body)).toEqual({ code: "123456" });
    expect(listener).toHaveBeenCalledWith(null);
    unsubscribe();
  });

  it("keeps the session and local data available after an incorrect reauthentication code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code: "invalid_code" }, 401)));
    const client = await import("../app/lib/remote/client");
    const account = await import("../app/lib/remote/account");
    client.publishSession(session);
    const listener = vi.fn();
    const unsubscribe = await client.subscribeToAuth(listener);
    await expect(account.deleteRemoteAccount("owner", "000000")).rejects.toMatchObject({ code: "invalid_code" });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("uses the receipt only as a bearer header and does not sign out another current account on expiry", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ code: "invalid_deletion_token" }, 401));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    const account = await import("../app/lib/remote/account");
    client.publishSession(session);
    const listener = vi.fn();
    const unsubscribe = await client.subscribeToAuth(listener);
    await expect(account.getDeletionStatus(receipt)).rejects.toMatchObject({ status: 401 });
    const [url, options] = fetcher.mock.calls[0];
    expect(new URL(url).search).toBe("");
    expect(url).not.toContain(receipt.deletion_token);
    expect(options.headers.get("Authorization")).toBe(`Bearer ${receipt.deletion_token}`);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("resumes receipts only for the same API and within their validity period", async () => {
    const account = await import("../app/lib/remote/account");
    account.saveDeletionReceipt(receipt);
    expect(account.loadDeletionReceipt()).toEqual(receipt);
    vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "/other-api/v1");
    vi.resetModules();
    expect((await import("../app/lib/remote/account")).loadDeletionReceipt()).toBeNull();
    account.saveDeletionReceipt({ ...receipt, status: "pending", expires_at: "2000-01-01T00:00:00Z" });
    expect(account.loadDeletionReceipt()).toBeNull();
  });

  it("revokes all devices through the account-scoped API", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    client.publishSession(session);
    await (await import("../app/lib/remote/auth")).signOutAllDevices("owner");
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/api/v1/auth/logout-all");
    expect(fetcher.mock.calls[0][1].headers.get("X-Miroven-User-ID")).toBe("owner");
  });

  it("asserts the displayed account on logout instead of refreshing into another account", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ code: "auth_scope_changed" }, 409));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    client.publishSession(session);
    await expect((await import("../app/lib/remote/auth")).signOutCurrentDevice("owner"))
      .rejects.toMatchObject({ code: "auth_scope_changed" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0][0]).pathname).toBe("/api/v1/auth/logout");
    expect(fetcher.mock.calls[0][1].headers.get("X-Miroven-User-ID")).toBe("owner");
  });

  it("does not restore a delayed session response after account deletion or logout", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const client = await import("../app/lib/remote/client");
    client.publishSession(session);
    const reading = client.refreshSession();
    client.publishSession(null);
    finish(json(session));
    expect(await reading).toBeNull();
  });

  it("ignores a stale request’s 401 when a different account has signed in", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const client = await import("../app/lib/remote/client");
    client.publishSession(session);
    const reading = client.apiRequest("/vault", {}, "owner");
    client.publishSession({ ...session, user_id: "other" });
    const listener = vi.fn();
    const unsubscribe = await client.subscribeToAuth(listener);
    finish(json({ code: "unauthenticated" }, 401));
    await expect(reading).rejects.toMatchObject({ status: 401 });
    expect(listener).not.toHaveBeenCalledWith(null);
    unsubscribe();
  });
});
