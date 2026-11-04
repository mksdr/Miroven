import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";

const origin = "https://journal.test";
const current = "miroven-shell-dev";
const old = "miroven-shell-old";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function worker(windows: string[] = ["other-tab"]) {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, string>>([
    [current, new Map([["/", "installed B HTML"], ["/_next/static/B.js", "B chunk"]])],
    [old, new Map([["/", "old A HTML"], ["/_next/static/A.js", "A lazy chunk"]])],
    ["unrelated-app", new Map([["/_next/static/unlisted.js", "untrusted"]])],
  ]);
  const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("latest C HTML"));
  const claim = vi.fn();
  const remove = vi.fn(async (key: string) => stores.delete(key));
  vm.runInNewContext(source, {
    URL, Request, Response, fetch,
    self: {
      location: { origin },
      addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
      clients: { claim, matchAll: async () => windows.map((id) => ({ id })) },
    },
    caches: {
      keys: async () => [...stores.keys()], delete: remove,
      open: async (key: string) => ({
        match: async (path: string) => {
          const body = stores.get(key)?.get(path);
          if (body === undefined) return undefined;
          const response = new Response(body, { headers: {
            "Content-Type": "application/javascript", "Content-Security-Policy": "script-src 'self'",
          } });
          Object.defineProperty(response, "url", { value: `${origin}${path}` });
          return response;
        },
      }),
    },
  });
  async function navigate(path = "/", method = "GET", destination = "") {
    let response: Promise<Response> | undefined;
    const pending: Promise<unknown>[] = [];
    const request = new Request(path.startsWith("https:") ? path : `${origin}${path}`, { method });
    Object.defineProperty(request, "mode", { value: "navigate" });
    Object.defineProperty(request, "destination", { value: destination });
    handlers.get("fetch")!({
      request,
      replacesClientId: "replaced", resultingClientId: "result",
      respondWith: (value: Promise<Response>) => { response = value; },
      waitUntil: (value: Promise<unknown>) => pending.push(value),
    });
    const result = await response;
    await Promise.all(pending);
    return result;
  }
  async function activate() {
    let pending!: Promise<unknown>;
    handlers.get("activate")!({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
  }
  return { stores, fetch, remove, claim, navigate, activate };
}

it.each(["worker", "sharedworker"])("preserves the requested %s URL for current and retained cached scripts", async (destination) => {
  const sw = worker();
  for (const [path, body] of [["/_next/static/B.js", "B chunk"], ["/_next/static/A.js", "A lazy chunk"]]) {
    const response = (await sw.navigate(path, "GET", destination))!;
    expect(response.url).toBe("");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/javascript");
    expect(response.headers.get("Content-Security-Policy")).toBe("script-src 'self'");
    expect(await response.text()).toBe(body);
  }
  expect(sw.fetch).not.toHaveBeenCalled();
  const regular = (await sw.navigate("/_next/static/B.js"))!;
  expect(regular.url).toBe(`${origin}/_next/static/B.js`);
});

it("serves latest online HTML without replacing the complete installed offline build", async () => {
  const sw = worker();
  expect(await (await sw.navigate())!.text()).toBe("latest C HTML");
  expect(sw.fetch.mock.calls[0][0].cache).toBe("no-cache");
  expect(sw.stores.get(current)?.get("/")).toBe("installed B HTML");
  sw.fetch.mockRejectedValueOnce(new TypeError("offline"));
  expect(await (await sw.navigate())!.text()).toBe("installed B HTML");
  expect(await (await sw.navigate("/_next/static/B.js"))!.text()).toBe("B chunk");
});

it.each([503, 404])("falls back to the installed build on HTTP %s", async (status) => {
  const sw = worker();
  sw.fetch.mockResolvedValueOnce(new Response("unavailable", { status }));
  expect(await (await sw.navigate())!.text()).toBe("installed B HTML");
  expect(sw.remove).not.toHaveBeenCalled();
});

it("preserves old tabs' lazy chunks after activation even when the server is offline", async () => {
  const sw = worker();
  await sw.activate();
  expect(sw.claim).toHaveBeenCalledOnce();
  sw.fetch.mockRejectedValue(new TypeError("offline"));
  expect(await (await sw.navigate("/_next/static/A.js"))!.text()).toBe("A lazy chunk");
  expect(sw.fetch).not.toHaveBeenCalled();
  expect(sw.remove).not.toHaveBeenCalled();
});

it("cleans obsolete app caches on a sole-window navigation but preserves unrelated caches", async () => {
  const sw = worker(["replaced", "result"]);
  await sw.activate();
  await sw.navigate();
  expect([...sw.stores.keys()]).toEqual([current, "unrelated-app"]);
});

it("cleans obsolete caches on activation only when there are no open windows", async () => {
  const sw = worker([]);
  await sw.activate();
  expect([...sw.stores.keys()]).toEqual([current, "unrelated-app"]);
});

it("never serves executable assets from unrelated caches or caches a network miss", async () => {
  const sw = worker();
  sw.fetch.mockResolvedValueOnce(new Response("network asset"));
  expect(await (await sw.navigate("/_next/static/unlisted.js"))!.text()).toBe("network asset");
  expect(sw.stores.get(current)?.has("/_next/static/unlisted.js")).toBe(false);
});

it("leaves cross-origin, API, non-executable and non-GET requests to the browser", async () => {
  const sw = worker();
  for (const path of ["/api/v1/session", "/_next/static/data.json", "/photo.png", "https://other.test/"]) {
    expect(await sw.navigate(path)).toBeUndefined();
  }
  expect(await sw.navigate("/", "POST")).toBeUndefined();
  expect(sw.fetch).not.toHaveBeenCalled();
});

it("never deletes a newer build's installing cache during navigation", async () => {
  const sw = worker(["replaced", "result"]);
  await sw.activate();
  sw.stores.set("miroven-shell-installing-C", new Map());
  await sw.navigate();
  expect(sw.stores.has("miroven-shell-installing-C")).toBe(true);
});
