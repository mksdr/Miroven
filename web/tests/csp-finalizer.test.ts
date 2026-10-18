import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePagesHeaders } from "../scripts/header-rules.mjs";

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(html: string) {
  // Stay under web so the copied CLI resolves the installed @next/env package.
  const parent = path.join(webDirectory, ".local");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "csp-test-"));
  temporaryDirectories.push(root);
  for (const directory of ["scripts", "public", "out"]) await mkdir(path.join(root, directory));
  for (const file of ["finalize-csp.mjs", "header-rules.mjs"]) {
    await copyFile(path.join(webDirectory, "scripts", file), path.join(root, "scripts", file));
  }
  const template = await readFile(path.join(webDirectory, "public", "_headers"), "utf8");
  await writeFile(path.join(root, "public", "_headers"), template);
  await writeFile(path.join(root, "out", "_headers"), template);
  await writeFile(path.join(root, "out", "notice.html"), html);
  return {
    read: (file: string) => readFile(path.join(root, "out", file), "utf8"),
    write: (file: string, content: string) => writeFile(path.join(root, "out", file), content),
    run: (...args: string[]) => spawnSync(process.execPath, [path.join(root, "scripts", "finalize-csp.mjs"), ...args], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NEXT_PUBLIC_MIROVEN_API_URL: "https://api.example.test" },
    }),
    root,
  };
}

describe("CSP finalizer extraction", () => {
  it("keeps scripts inline when the policy fits, even for a large license page", async () => {
    const html = `<html><body>${"License text. ".repeat(20000)}<script>window.ready = true;</script></body></html>`;
    const output = await fixture(html);
    const result = output.run();
    expect(result.status, result.stderr).toBe(0);
    expect(await output.read("notice.html")).toBe(html);
    expect((await readdir(path.join(output.root, "out"))).sort()).toEqual(["_headers", "notice.html"]);
    expect(validatePagesHeaders(await output.read("_headers")).longestLine).toBeLessThanOrEqual(2000);
    const check = output.run("--check");
    expect(check.status, check.stderr).toBe(0);
  });

  it("extracts an oversized policy in order, preserves attributed scripts, and verifies assets", async () => {
    const scripts = Array.from({ length: 40 }, (_, i) => `window.order = (window.order || []).concat(${i});`);
    const jsonLd = '<script type="application/ld+json">{"@type":"WebPage"}</script>';
    const moduleScript = '<script type="module">window.moduleReady = true;</script>';
    const style = "<style>body { color: black; }</style>";
    const html = `<html><head>${style}${jsonLd}</head><body>${scripts.map((content) => `<script>${content}</script>`).join("")}${moduleScript}</body></html>`;
    const output = await fixture(html);
    const template = await output.read("_headers");
    const needsExtraction = output.run("--check");
    expect(needsExtraction.status).not.toBe(0);
    expect(needsExtraction.stderr).toContain("CSP requires script extraction");
    expect(await output.read("notice.html")).toBe(html);
    expect(await output.read("_headers")).toBe(template);

    const result = output.run();
    expect(result.status, result.stderr).toBe(0);
    const finalizedHtml = await output.read("notice.html");
    const headers = await output.read("_headers");
    const assets = [...finalizedHtml.matchAll(/<script src="(\/_next\/static\/csp\/([a-f0-9]{64})\.js)"><\/script>/g)];
    expect(assets).toHaveLength(scripts.length);
    for (const [i, [, url, digest]] of assets.entries()) {
      const content = await output.read(url);
      expect(content).toBe(scripts[i]);
      expect(createHash("sha256").update(content).digest("hex")).toBe(digest);
    }
    expect(finalizedHtml).toContain(jsonLd);
    expect(finalizedHtml).toContain(moduleScript);
    expect(finalizedHtml).toContain(style);
    expect(finalizedHtml).not.toContain("<script>");
    expect(validatePagesHeaders(headers).longestLine).toBeLessThanOrEqual(2000);
    const repeated = output.run();
    expect(repeated.status, repeated.stderr).toBe(0);
    expect(await output.read("notice.html")).toBe(finalizedHtml);
    expect(await output.read("_headers")).toBe(headers);
    const check = output.run("--check");
    expect(check.status, check.stderr).toBe(0);

    await output.write(assets[0][1], "tampered");
    const invalid = output.run("--check");
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("does not match its content hash");
  });
});
