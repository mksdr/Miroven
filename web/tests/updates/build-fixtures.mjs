import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = path.join(web, ".local/update-builds");

function build(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
      cwd: directory,
      // Do not inherit API settings or cache-name overrides into local-only fixtures.
      env: { ...process.env, NEXT_PUBLIC_MIROVEN_API_URL: "", SERVICE_WORKER_CACHE_VERSION: "" },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Update fixture build exited ${code}`)));
  });
}

export default async function buildUpdateFixtures() {
  await mkdir(fixtures, { recursive: true });
  const source = await mkdtemp(path.join(fixtures, "source-"));
  try {
    // Copy source/config only: never mutate the checkout, reuse out/, or copy .env files.
    const inputs = ["app", "public", "scripts", "package.json", "package-lock.json", "tsconfig.json"];
    const configs = (await readdir(web)).filter((name) => /^(?:next|postcss)\.config\./.test(name));
    for (const name of [...inputs, ...configs]) await cp(path.join(web, name), path.join(source, name), { recursive: true });
    await symlink(path.join(web, "node_modules"), path.join(source, "node_modules"), "junction");
    // Keep the linked dependencies inside Turbopack's root; otherwise use the production config.
    const config = path.join(source, "next.config.ts");
    const originalConfig = await readFile(config, "utf8");
    const exportLine = "export default nextConfig;";
    if (!originalConfig.includes(exportLine)) throw new Error("Update the fixture builder for the new Next config");
    await writeFile(config, originalConfig.replace(exportLine,
      `nextConfig.turbopack = { ...nextConfig.turbopack, root: ${JSON.stringify(web)} };\n${exportLine}`));
    const account = path.join(source, "app/components/modals/AccountSettingsModal.tsx");
    const originalAccount = await readFile(account, "utf8");
    const fieldset = '<fieldset className="settings-group">';
    if (!originalAccount.includes(fieldset)) throw new Error("Update the fixture's Account marker placement");
    const metadata = {};
    for (const version of ["A", "B"]) {
      // A real source change forces a different lazy Account chunk through Next's compiler.
      await writeFile(account, originalAccount.replace(fieldset,
        `<fieldset data-update-build="${version}" className="settings-group">`));
      await rm(path.join(source, ".next"), { recursive: true, force: true });
      await rm(path.join(source, "out"), { recursive: true, force: true });
      await build(source);
      const output = path.join(fixtures, version);
      await rm(output, { recursive: true, force: true });
      await cp(path.join(source, "out"), output, { recursive: true });
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
