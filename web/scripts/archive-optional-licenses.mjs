import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archivedOptionalNotices, sha256, validateLicenseDeclaration } from "./optional-license-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
export function verifyIntegrity(data, integrity) {
  if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(integrity ?? "") || `sha512-${createHash("sha512").update(data).digest("base64")}` !== integrity) throw new Error("Tarball integrity mismatch or unsupported integrity");
}
function tar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Cannot read npm archive: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
async function main() {
  const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
  const upstreams = JSON.parse(await readFile(path.join(root, "scripts/optional-license-upstreams.json"), "utf8"));
  let previous = [];
  try { previous = JSON.parse(await readFile(path.join(root, "scripts/optional-license-evidence.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const directory = path.join(root, "scripts/optional-license-sources");
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "miroven-optional-licenses-"));
  const records = [];
  try {
    for (const [location, info] of Object.entries(lock.packages).filter(([location, info]) => location && info.optional)) {
      const name = location.split("node_modules/").at(-1);
      if ((await archivedOptionalNotices(root, location, info, previous)).length) {
        records.push(previous.find((record) => record.location === location));
        continue;
      }
      if (!info.resolved?.startsWith("https://registry.npmjs.org/")) throw new Error(`Unsupported tarball source: ${location}`);
      const response = await fetch(info.resolved, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Download failed: ${info.resolved} (${response.status})`);
      const data = Buffer.from(await response.arrayBuffer());
      verifyIntegrity(data, info.integrity);
      const archive = path.join(temporary, "package.tgz");
      await writeFile(archive, data);
      const metadata = JSON.parse(tar(["-xOzf", archive, "package/package.json"]));
      if (metadata.name !== name || metadata.version !== info.version || metadata.license !== info.license) throw new Error(`Archive metadata mismatch: ${location}`);
      // Match the collector's top-level notice scope; never extract binaries or
      // execute lifecycle scripts. Keep all shipped top-level notice files.
      const listing = tar(["-tzf", archive]).split("\n");
      const members = listing.filter((file) => /^package\/(licen[sc]e|copying|notice|copyright)([.-][^/]*)?$/i.test(file)).sort();
      // sharp-libvips ships its original third-party licensing table in README,
      // rather than a standalone LICENSE. Preserve the whole file, not a
      // substituted builder-repository license (which is Apache, not LGPL).
      if (!members.length && listing.includes("package/README.md") && /^## Licensing\s*$/m.test(tar(["-xOzf", archive, "package/README.md"]))) members.push("package/README.md");
      const files = [];
      for (const member of members) {
        const text = tar(["-xOzf", archive, member]);
        if (!text.trim()) throw new Error(`Empty original: ${location}/${member}`);
        const hash = sha256(text);
        await writeFile(path.join(directory, `${hash}.txt`), text);
        files.push({ file: member.slice("package/".length), sha256: hash });
      }
      const upstream = upstreams.find((item) => (item.name ? name === item.name : name.startsWith(item.namePrefix)) && item.version === info.version && item.license === info.license);
      if (!files.length && upstream) {
        for (const source of upstream.sources) {
          if (!/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//.test(source)) throw new Error(`Unpinned upstream: ${source}`);
          const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error(`Upstream original unavailable: ${source}`);
          const data = Buffer.from(await response.arrayBuffer());
          if (upstream.kind === "license-declaration") validateLicenseDeclaration(data, name, info);
          const hash = sha256(data);
          await writeFile(path.join(directory, `${hash}.txt`), data);
          files.push({ file: source.split("/").at(-1), sha256: hash, source, ...(upstream.kind ? { kind: upstream.kind } : {}) });
        }
      }
      if (!files.length) {
        console.warn(`No original notices; keep review: ${name}@${info.version}`);
        continue;
      }
      records.push({ name, location, version: info.version, license: info.license, resolved: info.resolved, integrity: info.integrity, files, ...(files.some((file) => file.source) ? { upstreamReview: upstream } : {}) });
      console.log(`Archived ${name}@${info.version}: ${files.map((file) => file.file).join(", ")}`);
    }
    await writeFile(path.join(root, "scripts/optional-license-evidence.json"), JSON.stringify(records, null, 2) + "\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
