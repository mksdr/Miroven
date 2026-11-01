import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

it("never intercepts API or removed page navigations and caches only the app shell", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const match = vi.fn(async () => "installed shell");
  const fetch = vi.fn(async () => ({ ok: true, clone: () => "public page" }));
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, fetch,
    self: { location: { origin: "https://journal.test" }, addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn) },
    caches: { open: async () => ({ match }), match: vi.fn() },
  });
  const respondWith = vi.fn();
  for (const path of ["/api/v1/auth/session", "/api/v1/blobs/private", "/api/v1/sync/changes", "/api/v1/account/usage", "/api/v1/account/deletion", "/_next/static/private.json", "/_next/static/unlisted.js", "/about", "/privacy", "/tos"]) {
    handlers.get("fetch")!({ request: { method: "GET", mode: "navigate", url: `https://journal.test${path}` }, respondWith });
  }
  expect(respondWith).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  handlers.get("fetch")!({ request: { method: "GET", mode: "navigate", url: "https://journal.test/" }, respondWith });
  await respondWith.mock.calls[0][0];
  expect(match).toHaveBeenCalledWith("/");
  expect(fetch).not.toHaveBeenCalled();
});
