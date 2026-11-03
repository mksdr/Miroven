import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

it.each<RequestInit>([
  {},
  { mode: "same-origin" },
  { mode: "no-cors" },
  { cache: "no-store" },
  { headers: { RSC: "1", Accept: "text/x-component" } },
])("leaves non-navigation root requests to the browser (%j)", (init) => {
  const handlers = new Map<string, (event: unknown) => void>();
  const fetch = vi.fn();
  const open = vi.fn(async () => ({ match: async () => new Response("installed HTML") }));
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, Request, Response, fetch,
    self: { location: { origin: "https://journal.test" }, addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn) },
    caches: { open },
  });
  const respondWith = vi.fn();
  const waitUntil = vi.fn();
  for (const path of ["/", "/?_rsc=synthetic"]) {
    handlers.get("fetch")!({ request: new Request(`https://journal.test${path}`, init), respondWith, waitUntil });
  }
  expect(respondWith).not.toHaveBeenCalled();
  expect(waitUntil).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("never intercepts API or removed page navigations and caches only the app shell", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const match = vi.fn(async () => "installed shell");
  const fetch = vi.fn(async () => ({ ok: true, clone: () => "public page" }));
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), {
    URL, fetch,
    Request: class extends Request {
      constructor(input: { url: string }, init: RequestInit) { super(input.url, init); }
    },
    self: { location: { origin: "https://journal.test" }, addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn) },
    caches: { open: async () => ({ match }), match: vi.fn() },
  });
  const respondWith = vi.fn();
  for (const path of ["/api/v1/auth/session", "/api/v1/blobs/private", "/api/v1/sync/changes", "/api/v1/account/usage", "/api/v1/account/deletion", "/_next/static/private.json", "/about", "/privacy", "/tos"]) {
    handlers.get("fetch")!({ request: { method: "GET", mode: "navigate", url: `https://journal.test${path}` }, respondWith });
  }
  expect(respondWith).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  handlers.get("fetch")!({ request: { method: "GET", mode: "navigate", url: "https://journal.test/" }, respondWith, waitUntil: () => undefined });
  await respondWith.mock.calls[0][0];
  expect(fetch).toHaveBeenCalledOnce();
  expect(match).not.toHaveBeenCalled();
});
