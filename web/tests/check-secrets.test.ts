import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "miroven-secret-scan-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "scripts"));
  const script = path.join(root, "scripts/check-secrets.mjs");
  await copyFile(new URL("../scripts/check-secrets.mjs", import.meta.url), script);
  return {
    root,
    async write(file: string, content: string) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
      return target;
    },
    run(preload?: string) {
      const args = preload ? ["--import", pathToFileURL(preload).href, script] : [script];
      return spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true });
    },
  };
}

describe("secret scanner", () => {
  it("accepts clean files and absent optional outputs, preserving exclusions", async () => {
    const scan = await fixture();
    await scan.write("package.json", "{}");
    await scan.write("app/nested/clean.js", "export const value = 1;");
    for (const file of ["app/ignored.map", "app/ignored.sst", "app/cache/ignored.js", "app/node_modules/ignored.js"]) {
      await scan.write(file, "MIROVEN_SECRET_KEY");
    }
    const result = scan.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Secret scan passed");
  });

  it.each([".env.example", "app/nested/config.js"])("detects forbidden content in %s without logging it", async (file) => {
    const scan = await fixture();
    const content = "MIROVEN_SECRET_KEY=synthetic-test-value";
    const target = await scan.write(file, content);
    const result = scan.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(target);
    expect(result.stderr).toContain("Secret scan failed");
    expect(result.stderr).not.toContain(content);
  });

  it.each([".env.example", "app/nested/config.js"])("reads the opened file when %s is replaced during inspection", async (file) => {
    const scan = await fixture();
    const target = await scan.write(file, 'import "@supabase/synthetic-test-fixture";');
    const preload = await scan.write("replace-path.mjs", `
      import fs from "node:fs";
      const target = ${JSON.stringify(target)};
      const open = fs.openSync;
      const stat = fs.statSync;
      const fstat = fs.fstatSync;
      const read = fs.readFileSync;
      let watchedFd;
      let replaced = false;
      function replace() {
        if (replaced) return;
        replaced = true;
        fs.renameSync(target, target + ".opened");
        fs.writeFileSync(target, "safe replacement");
        console.log("fixture path replaced");
      }
      fs.openSync = function (file, ...args) {
        const fd = open.call(this, file, ...args);
        if (file === target) watchedFd = fd;
        return fd;
      };
      fs.statSync = function (file, ...args) {
        const result = stat.call(this, file, ...args);
        if (file === target) replace();
        return result;
      };
      fs.fstatSync = function (fd, ...args) {
        const result = fstat.call(this, fd, ...args);
        if (fd === watchedFd) replace();
        return result;
      };
      fs.readFileSync = function (file, ...args) {
        if (file === target) replace();
        return read.call(this, file, ...args);
      };
    `);
    const result = scan.run(preload);
    expect(result.stdout).toContain("fixture path replaced");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`[SECRET SCAN ERROR] Retired backend dependency or connection found in: ${target}`);
  });

  it("fails on read errors and closes the opened descriptor", async () => {
    const scan = await fixture();
    const target = await scan.write(".env.example", "safe content");
    const preload = await scan.write("fail-read.mjs", `
      import fs from "node:fs";
      const target = ${JSON.stringify(target)};
      const open = fs.openSync;
      const read = fs.readFileSync;
      const close = fs.closeSync;
      let watchedFd;
      fs.openSync = function (file, ...args) {
        const fd = open.call(this, file, ...args);
        if (file === target) watchedFd = fd;
        return fd;
      };
      fs.readFileSync = function (file, ...args) {
        if (file === watchedFd) throw new Error("synthetic read failure");
        return read.call(this, file, ...args);
      };
      fs.closeSync = function (fd) {
        if (fd === watchedFd) console.log("fixture descriptor closed");
        return close.call(this, fd);
      };
    `);
    const result = scan.run(preload);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("synthetic read failure");
    expect(result.stdout).toContain("fixture descriptor closed");
    expect(result.stdout).not.toContain("Secret scan passed");
  });
});
