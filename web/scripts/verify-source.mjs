import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repositoryRoot, sha256 } from "./check-heic.mjs";

const temp = await mkdtemp(path.join(os.tmpdir(), "miroven-source-"));
const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`);
};
try {
  const source = path.join(repositoryRoot, "web/out/source");
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  if (sha256(await readFile(path.join(source, "miroven-source.tar.gz"))) !== manifest.sha256) throw new Error("Source download checksum mismatch");
  run("tar", ["-xzf", path.join(source, "miroven-source.tar.gz"), "-C", temp], repositoryRoot);
  for (const [name, hash] of Object.entries(manifest.files)) {
    if (sha256(await readFile(path.join(temp, name))) !== hash) throw new Error(`Extracted source mismatch: ${name}`);
  }
  const cwd = path.join(temp, "web");
  const settings = JSON.parse(await readFile(path.join(temp, "BUILD-SETTINGS.json"), "utf8"));
  // Only the explicit public settings documented by the source packager.
  for (const key of ["NEXT_PUBLIC_MIROVEN_API_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_WEBSITE_URL", "SERVICE_WORKER_CACHE_VERSION"]) {
    delete process.env[key];
    if (settings[key] !== undefined) process.env[key] = settings[key];
  }
  run("npm", ["ci", "--prefer-offline", "--no-audit", "--no-fund"], cwd);
  run("npm", ["run", "build"], cwd);
  if (sha256(await readFile(path.join(cwd, "out/source/miroven-source.tar.gz"))) !== manifest.sha256) throw new Error("Repackaged source snapshot differs");
  run("npm", ["run", "heic:verify"], cwd);
  console.log("Downloaded source rebuilds the application and reproduces native codec output.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
