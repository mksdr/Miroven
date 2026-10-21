import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("public authentication policy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MIROVEN_API_URL", "/api/v1");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("loads current server groups without caching and can cancel a stale request", async () => {
    const policy = {
      domain_groups: { DEFAULT: ["gmail.com"], KR: ["naver.com"], JP: ["yahoo.co.jp"] },
      default_email_locale: "en", existing_accounts_allowed: true,
      blocked_local_part_characters: ["+", "."],
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(policy), {
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetcher);
    const { getAuthPolicy } = await import("../app/lib/remote/auth");
    const controller = new AbortController();
    expect(await getAuthPolicy(controller.signal)).toEqual(policy);
    expect(fetcher.mock.calls[0][0]).toBe("http://localhost/api/v1/auth/policy");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", signal: controller.signal });
  });

  it.each([{}, { domain_groups: { DEFAULT: [], KR: [] } }, {
    domain_groups: { DEFAULT: [42], KR: [], JP: [] },
  }, {
    domain_groups: { DEFAULT: [], KR: [], JP: [] }, blocked_local_part_characters: "plus",
  }, {
    domain_groups: { DEFAULT: [], KR: [], JP: [] }, blocked_local_part_characters: ["*"],
  }])("rejects malformed policy responses so advisory UI can use its fallback", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    const { getAuthPolicy } = await import("../app/lib/remote/auth");
    await expect(getAuthPolicy()).rejects.toThrow("Invalid authentication policy");
  });

  it("supports an older domain policy without the local-part restriction field", async () => {
    const legacy = { domain_groups: { DEFAULT: ["gmail.com"], KR: [], JP: [] } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(legacy))));
    const { getAuthPolicy } = await import("../app/lib/remote/auth");
    expect(await getAuthPolicy()).toEqual(legacy);
  });
});
