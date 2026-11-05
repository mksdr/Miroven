import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { prepareUpdateSource } from "./updates/build-fixtures.mjs";
import { repositoryRoot, verifyHeic } from "../scripts/check-heic.mjs";
import { allowedSourcePath, collectSource, sourceTar, sourceFiles, sourceDirectories } from "../scripts/package-source.mjs";

const temps: string[] = [];
async function temporary() { const root = await mkdtemp(path.join(os.tmpdir(), "heic-evidence-test-")); temps.push(root); return root; }
afterEach(async () => { await Promise.all(temps.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("HEIC source distribution", () => {
  it("checks the native build evidence and rejects altered source or output", async () => {
    await expect(verifyHeic()).resolves.toMatchObject({ schemaVersion: 1 });
    const root = await temporary();
    for (const name of ["web/vendor/heic", "tools/heic", "web/scripts/bundled-licenses.json", "web/package-lock.json"]) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await cp(path.join(repositoryRoot, name), path.join(root, name), { recursive: true });
    }
    const filename = path.join(root, "web/vendor/heic/manifest.json");
    const manifest = JSON.parse(await readFile(filename, "utf8"));
    manifest.components[0].license = "MIT";
    await writeFile(filename, JSON.stringify(manifest));
    await expect(verifyHeic(root)).rejects.toThrow("component version/provenance drift");
    manifest.components[0].license = "LGPL-3.0";
    manifest.components[0].version = "2.0.0";
    await writeFile(filename, JSON.stringify(manifest));
    await expect(verifyHeic(root)).rejects.toThrow("component version/provenance drift");
    manifest.components[0].version = "1.5.2";
    await writeFile(filename, JSON.stringify(manifest));
    await writeFile(path.join(root, "web/vendor/heic/heic-to.js"), "tampered");
    await expect(verifyHeic(root)).rejects.toThrow("hash mismatch: heic-to.js");
    await writeFile(path.join(root, "web/vendor/heic/sources/libheif.tar.gz"), "tampered");
    await expect(verifyHeic(root)).rejects.toThrow("hash mismatch: sources/libheif.tar.gz");
  });
  it("prepares update fixtures with the complete repository layout and verified vendor", async () => {
    const root = await temporary();
    expect(await prepareUpdateSource(root)).toBe(path.join(root, "web"));
    await expect(verifyHeic(root)).resolves.toMatchObject({ schemaVersion: 1 });
    const files = await collectSource(root);
    for (const name of ["LICENSE", "tools/heic/prepare-ca.mjs", "web/vendor/heic/manifest.json", "web/scripts/package-source.mjs"]) expect(files.has(name)).toBe(true);
    expect([...files.keys()].some((name) => /node_modules|\.env.local|\.local/.test(name))).toBe(false);
  });
  it("publishes the compiler runtime copyright texts without losing their originals", async () => {
    const manifest = await verifyHeic();
    const notices = JSON.parse(await readFile(path.join(repositoryRoot, "web/app/notice/notices.json"), "utf8"));
    for (const runtime of manifest.runtimeNotices) {
      const notice = notices.find((item: { name: string }) => item.name === runtime.name);
      expect(notice).toBeDefined();
      for (const file of runtime.files) {
        const text = (await readFile(path.join(repositoryRoot, "web", file.file), "utf8")).trim();
        expect(notice.files.find((item: { file: string }) => item.file === file.file).text).toBe(text);
      }
    }
  });
  it("packs deterministic readable archives and preserves executable scripts", async () => {
    const root = await temporary();
    const files = new Map([
      ["LICENSE", { data: Buffer.from("License text\n"), mode: 0o644 }],
      ["tools/heic/build.sh", { data: Buffer.from("#!/bin/sh\nexit 0\n"), mode: 0o755 }],
    ]);
    const archive = sourceTar(files);
    expect(sourceTar(new Map([...files].reverse()))).toEqual(archive);
    const filename = path.join(root, "source.tar.gz");
    await writeFile(filename, archive);
    const result = spawnSync("tar", ["-xzf", filename, "-C", root], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(path.join(root, "LICENSE"), "utf8")).toBe("License text\n");
    if (process.platform !== "win32") expect(spawnSync(path.join(root, "tools/heic/build.sh")).status).toBe(0);
  });
  it("excludes private/generated roots and refuses secret files or symlinks in source roots", async () => {
    const root = await temporary();
    for (const name of sourceFiles) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), "source");
    }
    for (const name of sourceDirectories) await mkdir(path.join(root, name), { recursive: true });
    for (const name of ["web/.local/private", "web/out/source/old.tar.gz", "web/.env.local", "web/node_modules/private"]) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), "private");
    }
    const collected = await collectSource(root);
    expect([...collected.keys()].some((name) => /\.local|node_modules|web\/out|\.env.local/.test(name))).toBe(false);
    expect(collected.has("web/.env.example")).toBe(true);
    for (const name of ["web/app/.env", "web/app/private.pem", "../private"]) expect(allowedSourcePath(name)).toBe(false);
    await symlink(path.join(root, "web/node_modules"), path.join(root, "web/app/link"), "junction");
    await expect(collectSource(root)).rejects.toThrow("symlink");
    await rm(path.join(root, "web/app/link"));
    await writeFile(path.join(root, "web/app/.env"), "private");
    await expect(collectSource(root)).rejects.toThrow("Forbidden source input");
  });
});
