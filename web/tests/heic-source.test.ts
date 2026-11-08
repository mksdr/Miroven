import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { prepareUpdateSource } from "./updates/build-fixtures.mjs";
import { repositoryRoot, verifyHeic } from "../scripts/check-heic.mjs";
import { allowedSourcePath, collectSource, sourceTar, sourceFiles, sourceDirectories, sourceFileList, updateSourceFiles, validateSourceFiles } from "../scripts/package-source.mjs";

const temps: string[] = [];
async function temporary() { const root = await mkdtemp(path.join(os.tmpdir(), "heic-evidence-test-")); temps.push(root); return root; }
async function sourceFixture() {
  const root = await temporary();
  const approved = [...sourceFiles, sourceFileList, "web/app/example.ts"].sort();
  for (const name of approved) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), "source");
  }
  for (const name of sourceDirectories) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, sourceFileList), JSON.stringify({ schemaVersion: 1, files: approved }));
  return root;
}
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
    const root = await sourceFixture();
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
  it("rejects unapproved local files before they can enter the published archive", async () => {
    const root = await sourceFixture();
    // This tree deliberately has no Git metadata, like a Docker context/download.
    for (const name of ["docs/internal-notes.md", "deploy/credentials.json", "web/app/scratch.ts", "web/public/photo.jpg"]) {
      await writeFile(path.join(root, name), "synthetic private data");
      await expect(collectSource(root)).rejects.toThrow(`Unapproved source input: ${name}`);
      await rm(path.join(root, name));
    }
  });
  it("keeps modified approved contents and its file list when repackaging without Git", async () => {
    const root = await sourceFixture();
    await writeFile(path.join(root, "web/app/example.ts"), "modified actual build input");
    const files = await collectSource(root);
    expect(files.get("web/app/example.ts")?.data.toString()).toBe("modified actual build input");
    expect(files.has(sourceFileList)).toBe(true);
    const archive = sourceTar(files);
    const output = await temporary();
    const filename = path.join(output, "source.tar.gz");
    await writeFile(filename, archive);
    const result = spawnSync("tar", ["-xzf", filename, "-C", output], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    // Empty source directories are not stored in tar archives.
    for (const name of sourceDirectories) await mkdir(path.join(output, name), { recursive: true });
    expect(sourceTar(await collectSource(output))).toEqual(archive);
  });
  it("fails when an approved file or the file list is missing", async () => {
    const root = await sourceFixture();
    await rm(path.join(root, "web/app/example.ts"));
    await expect(collectSource(root)).rejects.toThrow("Approved source input missing: web/app/example.ts");
    await rm(path.join(root, sourceFileList));
    await expect(collectSource(root)).rejects.toThrow("ENOENT");
  });
  it("rejects unsafe, out-of-scope, duplicate and incomplete approval lists", () => {
    const files = [...sourceFiles, sourceFileList];
    for (const name of ["../private", "/etc/passwd", "web/app/../private", "web/app\\private", "web/app//private", "web/app/.env", "web/app/private.key", "web/.local/private", "BUILD-SETTINGS.json"]) {
      expect(() => validateSourceFiles({ schemaVersion: 1, files: [...files, name] })).toThrow("Forbidden source file list entry");
    }
    expect(() => validateSourceFiles({ schemaVersion: 1, files: [...files, files[0]] })).toThrow("Duplicate");
    expect(() => validateSourceFiles({ schemaVersion: 1, files: [sourceFileList] })).toThrow("Required");
    expect(() => validateSourceFiles({ schemaVersion: 2, files })).toThrow("Invalid");
  });
  it("refuses symlinks at approved paths and at source-root ancestors", async () => {
    const root = await sourceFixture();
    const approvedFile = path.join(root, "web/app/example.ts");
    const target = path.join(root, "web/package.json");
    await rm(approvedFile);
    await symlink(target, approvedFile);
    await expect(collectSource(root)).rejects.toThrow("symlink");
    await rm(path.join(root, "tools"), { recursive: true });
    const other = await temporary();
    await mkdir(path.join(other, "heic"));
    await symlink(other, path.join(root, "tools"), "junction");
    await expect(collectSource(root)).rejects.toThrow("Source symlink is not permitted: tools");
  });
  it("updates candidates only from tracked paths, never ignored or untracked files", async () => {
    const root = await sourceFixture();
    const git = (args: string[]) => {
      const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
    };
    await writeFile(path.join(root, ".gitignore"), "docs/internal-notes.md\n");
    git(["init", "--quiet"]);
    git(["add", "."]);
    await writeFile(path.join(root, "docs/internal-notes.md"), "synthetic ignored private data");
    await writeFile(path.join(root, "deploy/credentials.json"), "synthetic untracked private data");
    await writeFile(path.join(root, "web/app/new-feature.ts"), "reviewed new source");
    git(["add", "web/app/new-feature.ts"]);
    await updateSourceFiles(root);
    const list = JSON.parse(await readFile(path.join(root, sourceFileList), "utf8"));
    expect(list.files).toContain("web/app/new-feature.ts");
    expect(list.files).not.toContain("docs/internal-notes.md");
    expect(list.files).not.toContain("deploy/credentials.json");
    await expect(collectSource(root)).rejects.toThrow("Unapproved source input");
    await writeFile(path.join(root, "docs/private.key"), "synthetic forbidden tracked file");
    git(["add", "docs/private.key"]);
    await expect(updateSourceFiles(root)).rejects.toThrow("Forbidden source file list entry");
    expect(JSON.parse(await readFile(path.join(root, sourceFileList), "utf8"))).toEqual(list);
  });
});
