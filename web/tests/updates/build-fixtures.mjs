import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectSource } from "../../scripts/package-source.mjs";

const web = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = path.join(web, ".local/update-builds");

function build(directory) {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(windows ? (process.env.ComSpec || "cmd.exe") : "npm",
      windows ? ["/d", "/s", "/c", "npm.cmd run build"] : ["run", "build"], {
      cwd: directory,
      // Invoke the fixed batch command through cmd without shell argument interpolation.
      windowsHide: true,
      // Do not inherit API settings or cache-name overrides into local-only fixtures.
      env: { ...process.env, NEXT_PUBLIC_MIROVEN_API_URL: "", SERVICE_WORKER_CACHE_VERSION: "" },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Update fixture build exited ${code}`)));
  });
}

// Preserve the repository/web layout required by production integrity/source steps.
// The same source roots and exclusions apply without Git metadata.
export async function prepareUpdateSource(source) {
  for (const [name, file] of await collectSource(path.resolve(web, ".."))) {
    const target = path.join(source, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data, { mode: file.mode });
  }
  const sourceWeb = path.join(source, "web");
  await symlink(path.join(web, "node_modules"), path.join(sourceWeb, "node_modules"), "junction");
  // Keep the linked dependencies inside Turbopack's root; otherwise use production config.
  const config = path.join(sourceWeb, "next.config.ts");
  const originalConfig = await readFile(config, "utf8");
  const exportLine = "export default nextConfig;";
  if (!originalConfig.includes(exportLine)) throw new Error("Update the fixture builder for the new Next config");
  await writeFile(config, originalConfig.replace(exportLine,
    `nextConfig.turbopack = { ...nextConfig.turbopack, root: ${JSON.stringify(web)} };\n${exportLine}`));
  return sourceWeb;
}

export default async function buildUpdateFixtures() {
  await mkdir(fixtures, { recursive: true });
  const source = await mkdtemp(path.join(fixtures, "source-"));
  try {
    const sourceWeb = await prepareUpdateSource(source);
    const account = path.join(sourceWeb, "app/components/modals/AccountSettingsModal.tsx");
    const originalAccount = await readFile(account, "utf8");
    const fieldset = '<fieldset className="settings-group">';
    if (!originalAccount.includes(fieldset)) throw new Error("Update the fixture's Account marker placement");
    const metadata = {};
    for (const version of ["A", "B"]) {
      // A real source change forces a different lazy Account chunk through Next's compiler.
      await writeFile(account, originalAccount.replace(fieldset,
        `<fieldset data-update-build="${version}" className="settings-group">`));
      await rm(path.join(sourceWeb, ".next"), { recursive: true, force: true });
      await rm(path.join(sourceWeb, "out"), { recursive: true, force: true });
      await build(sourceWeb);
      const output = path.join(fixtures, version);
      await rm(output, { recursive: true, force: true });
      await cp(path.join(sourceWeb, "out"), output, { recursive: true });
      const sw = await readFile(path.join(output, "sw.js"), "utf8");
      const cacheName = sw.match(/const CACHE_NAME = "([^"]+)"/)?.[1];
      const assets = JSON.parse(sw.match(/const BUILD_ASSETS = (\[[\s\S]*?\]);/)?.[1] ?? "null");
      if (!cacheName || !assets?.length) throw new Error("Missing finalized build metadata");
      const accountChunks = [];
      for (const asset of assets.filter((asset) => asset.endsWith(".js"))) {
        if ((await readFile(path.join(output, asset), "utf8")).includes("data-update-build")) accountChunks.push(asset);
      }
      if (accountChunks.length !== 1) throw new Error(`Expected one emitted Account chunk in ${version}`);
      metadata[version] = { cacheName, assets, accountChunk: accountChunks[0] };
    }
    if (metadata.A.cacheName === metadata.B.cacheName || metadata.B.assets.includes(metadata.A.accountChunk)) {
      throw new Error("Fixtures must have distinct caches and Account chunks");
    }
    await writeFile(path.join(fixtures, "builds.json"), JSON.stringify(metadata, null, 2));
  } finally {
    await rm(source, { recursive: true, force: true });
  }
}
