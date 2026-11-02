import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { collectBuildAssets, runFinalizeSw } from "../scripts/finalize-sw.mjs";

it("discovers nested lazy JS/CSS only and rejects a stale exported manifest", async () => {
  const outDir = await mkdtemp(path.join(tmpdir(), "miroven-precache-"));
  try {
    await mkdir(path.join(outDir, "_next/static/nested"), { recursive: true });
    for (const name of ["lazy.js", "style.css", "lazy.js.map", "photo.png", "codec.wasm"]) {
      await writeFile(path.join(outDir, "_next/static/nested", name), "asset");
    }
    await writeFile(path.join(outDir, "private.json"), "not an asset");
    const targetSwPath = path.join(outDir, "sw.js");
    await writeFile(targetSwPath, await readFile(new URL("../public/sw.js", import.meta.url)));
    const packageJsonPath = path.resolve("package.json");
    expect(await collectBuildAssets(outDir)).toEqual(["/_next/static/nested/lazy.js", "/_next/static/nested/style.css"]);
    const options = { outDir, targetSwPath, packageJsonPath };
    await runFinalizeSw({ ...options, checkOnly: false });
    await runFinalizeSw({ ...options, checkOnly: true });
    const finalized = await readFile(targetSwPath, "utf8");
    await writeFile(targetSwPath, finalized.replace('"/_next/static/nested/lazy.js",', ""));
    await expect(runFinalizeSw({ ...options, checkOnly: true })).rejects.toThrow("precache list mismatch");
  } finally { await rm(outDir, { recursive: true, force: true }); }
});

it("does not activate on a missing chunk and removes only obsolete app caches", async () => {
  const { default: vm } = await import("node:vm");
  const { vi } = await import("vitest");
  const handlers = new Map<string, (event: unknown) => void>();
  const skipWaiting = vi.fn();
  const claim = vi.fn();
  const remove = vi.fn();
  const failure = new Error("Missing lazy chunk");
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), {
    Request: class {},
    self: { addEventListener: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler), skipWaiting, clients: { claim, matchAll: async () => [] } },
    caches: {
      open: async () => ({ addAll: async () => { throw failure; } }),
      keys: async () => ["miroven-shell-dev", "miroven-shell-old", "private-journal-shell-old", "unrelated-app"],
      delete: remove,
    },
  });
  let pending!: Promise<unknown>;
  const event = { waitUntil: (promise: Promise<unknown>) => { pending = promise; } };
  handlers.get("install")!(event);
  await expect(pending).rejects.toThrow("Missing lazy chunk");
  expect(skipWaiting).not.toHaveBeenCalled();
  handlers.get("activate")!(event);
  await pending;
  expect(remove.mock.calls.flat()).toEqual(["miroven-shell-old", "private-journal-shell-old"]);
  expect(claim).toHaveBeenCalledOnce();
});
