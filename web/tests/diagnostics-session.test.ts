import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const owner = { user_id: "synthetic-owner", email: "synthetic@example.com", csrf_token: "synthetic-csrf" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const unauthorized = () => json({ code: "unauthenticated", message: "synthetic private server message" }, 401);
async function modules() {
  return {
    client: await import("../app/lib/remote/client"),
    activity: await import("../app/lib/diagnostic-activity"),
  };
}
beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "/api/v1"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("diagnostic session discovery and authentication boundaries", () => {
  it("preserves boot history, pending completions and the initial authenticated session request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(json(owner))));
    const { client, activity } = await modules();
    activity.recordDiagnosticEvent("runtime.error", new TypeError("synthetic private boot error"));
    const finish = activity.beginDiagnosticOperation("entry.list");
    const before = activity.diagnosticActivity().events;
    const generation = activity.diagnosticGeneration();
    const listener = vi.fn();
    const unsubscribe = await client.subscribeToAuth(listener);
    try {
      expect(await client.refreshSession()).toEqual({ id: owner.user_id, email: owner.email });
      finish();
      expect(activity.diagnosticGeneration()).toBe(generation);
      expect(activity.diagnosticActivity().events).toEqual(expect.arrayContaining(before));
      expect(activity.diagnosticActivity().events).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: "api.auth.session", outcome: "succeeded", httpStatus: 200 }),
        expect.objectContaining({ operation: "entry.list", outcome: "succeeded" }),
      ]));
      expect(activity.diagnosticContext().authenticated).toBe(true);
      expect(listener).toHaveBeenCalledOnce();
      await client.refreshSession();
      expect(activity.diagnosticGeneration()).toBe(generation);
      expect(listener).toHaveBeenCalledOnce();
      for (const secret of [...Object.values(owner), "synthetic private boot error"]) {
        expect(JSON.stringify(activity.diagnosticActivity())).not.toContain(secret);
      }
    } finally { unsubscribe(); }
  });

  it("preserves initial and repeated signed-out discovery and classifies its 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(unauthorized())));
    const { client, activity } = await modules();
    activity.recordDiagnosticEvent("entry.list");
    const before = activity.diagnosticActivity().events;
    const generation = activity.diagnosticGeneration();
    expect(await client.refreshSession()).toBeNull();
    expect(await client.refreshSession()).toBeNull();
    expect(activity.diagnosticGeneration()).toBe(generation);
    expect(activity.diagnosticActivity().events).toEqual(expect.arrayContaining(before));
    expect(activity.diagnosticActivity().events.at(-1)).toMatchObject({
      operation: "api.auth.session", outcome: "failed", httpStatus: 401, errorCode: "unauthenticated",
    });
    expect(activity.diagnosticContext().authenticated).toBe(false);
  });

  it("does not resolve authentication on network failure and preserves boot history on retry", async () => {
    const network = new TypeError("synthetic private network detail");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(network).mockResolvedValueOnce(json(owner)));
    const { client, activity } = await modules();
    activity.recordDiagnosticEvent("sw.register");
    const before = activity.diagnosticActivity().events;
    const generation = activity.diagnosticGeneration();
    await expect(client.refreshSession()).rejects.toBe(network);
    expect(activity.diagnosticContext().authenticated).toBeNull();
    await client.refreshSession();
    expect(activity.diagnosticGeneration()).toBe(generation);
    expect(activity.diagnosticActivity().events).toEqual(expect.arrayContaining(before));
  });

  it.each(["signed-out to signed-in", "account switch", "session expiry"])("fences old activity on discovered %s", async (transition) => {
    const first = transition === "signed-out to signed-in" ? unauthorized() : json(owner);
    const next = transition === "session expiry" ? unauthorized() : json({ ...owner, user_id: "synthetic-other" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next));
    const { client, activity } = await modules();
    await client.refreshSession();
    const finish = activity.beginDiagnosticOperation("entry.save");
    const generation = activity.diagnosticGeneration();
    await client.refreshSession();
    finish();
    expect(activity.diagnosticGeneration()).toBeGreaterThan(generation);
    expect(activity.diagnosticActivity().events).toEqual([]);
    expect(activity.diagnosticContext().authenticated).toBe(transition !== "session expiry");
  });

  it.each(["login before discovery", "same-account login", "logout", "account deletion"])("clears history on explicit %s", async (transition) => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(json(owner)));
    vi.stubGlobal("fetch", fetcher);
    const { client, activity } = await modules();
    if (transition !== "login before discovery") await client.refreshSession();
    const finish = activity.beginDiagnosticOperation("entry.save");
    const generation = activity.diagnosticGeneration();
    if (transition.includes("login")) {
      await (await import("../app/lib/remote/auth")).verifyOtpCode(owner.email, "123456");
    } else if (transition === "logout") {
      fetcher.mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 204 })));
      await (await import("../app/lib/remote/auth")).signOutCurrentDevice(owner.user_id);
    } else {
      fetcher.mockImplementationOnce(() => Promise.resolve(json({ deletion_id: "synthetic-delete", status: "pending", deletion_token: "synthetic-receipt" })));
      await (await import("../app/lib/remote/account")).deleteRemoteAccount(owner.user_id, "123456");
    }
    finish();
    expect(activity.diagnosticGeneration()).toBeGreaterThan(generation);
    expect(activity.diagnosticActivity().events).toEqual([]);
  });

  it.each([200, 401])("ignores an initial delayed %i response after explicit login", async (status) => {
    let release!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }))
      .mockResolvedValueOnce(json(owner)));
    const { client, activity } = await modules();
    const reading = client.refreshSession();
    await (await import("../app/lib/remote/auth")).verifyOtpCode(owner.email, "123456");
    activity.recordDiagnosticEvent("network.online");
    const before = activity.diagnosticActivity().events;
    const generation = activity.diagnosticGeneration();
    release(status === 401 ? unauthorized() : json({ ...owner, user_id: "synthetic-stale" }));
    expect(await reading).toEqual({ id: owner.user_id, email: owner.email });
    expect(activity.diagnosticGeneration()).toBe(generation);
    expect(activity.diagnosticActivity().events).toEqual(before);
  });

  it.each([false, true])("clears explicit signed-out logout (previously resolved: %s)", async (resolved) => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(unauthorized())));
    const { client, activity } = await modules();
    if (resolved) await client.refreshSession();
    const finish = activity.beginDiagnosticOperation("entry.list");
    const generation = activity.diagnosticGeneration();
    await (await import("../app/lib/remote/auth")).signOutCurrentDevice();
    finish();
    expect(activity.diagnosticGeneration()).toBeGreaterThan(generation);
    expect(activity.diagnosticActivity().events).toEqual([]);
  });
});
