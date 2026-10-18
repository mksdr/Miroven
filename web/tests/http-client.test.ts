import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
describe("Miroven HTTP session contract", () => {
  beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "/api/v1"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("uses the configured HTTPS API with cookies and query parameters", async () => {
    vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "https://miroven-api.mksdr.bid/api/v1");
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    await client.apiRequest("/sync/changes?limit=1&cursor=opaque");
    expect(fetcher.mock.calls[0][0]).toBe("https://miroven-api.mksdr.bid/api/v1/sync/changes?limit=1&cursor=opaque");
    expect(fetcher.mock.calls[0][1].credentials).toBe("include");
    expect(client.remoteScope("owner")).toBe("https://miroven-api.mksdr.bid/api/v1|owner");
  });
  it.each(["http://remote.example/api/v1", "https://user:secret@api.example/api/v1", "//api.example/api/v1", "https://api.example/api/v1?token=x"])("rejects unsafe API configuration %s", async (url) => {
    vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", url);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    await expect(client.apiRequest("/auth/session")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("sends HttpOnly-session credentials, CSRF and an account assertion without any SDK", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    client.publishSession({ user_id: "owner", email: "owner@example.com", csrf_token: "csrf" });
    await client.apiRequest("/sync/push", { method: "POST", body: "{}" }, "owner");
    const init = fetcher.mock.calls[0][1];
    expect(init.credentials).toBe("include");
    expect(init.headers.get("X-Miroven-User-ID")).toBe("owner");
    expect(init.headers.get("X-CSRF-Token")).toBe("csrf");
  });
  it("rejects a changed account before any mutation request is sent", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const client = await import("../app/lib/remote/client");
    client.publishSession({ user_id: "other", email: "other@example.com", csrf_token: "csrf" });
    await expect(client.apiRequest("/vault", { method: "PUT" }, "owner")).rejects.toMatchObject({ code: "auth_scope_changed" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("accepts a six-digit code using the documented code field", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ user_id: "owner", email: "owner@example.com", csrf_token: "csrf" }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const auth = await import("../app/lib/remote/auth");
    await auth.verifyOtpCode("owner@example.com", "123456");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ email: "owner@example.com", code: "123456" });
  });
});
