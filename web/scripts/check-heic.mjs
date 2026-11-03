import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
export async function verifyHeic(root = repositoryRoot, { outputs = true } = {}) {
  const vendor = path.join(root, "web/vendor/heic");
  const manifest = JSON.parse(await readFile(path.join(vendor, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.components?.length !== 3) throw new Error("Invalid HEIC source manifest");
  if (manifest.builder?.platform !== "linux/amd64" || manifest.builder.emsdkVersion !== "4.0.10" || !/^node:24\.22\.1-bookworm-slim@sha256:[a-f0-9]{64}$/.test(manifest.builder.nodeImage)) throw new Error("HEIC builder version/platform drift");
  const dockerfile = await readFile(path.join(root, "tools/heic/Dockerfile"), "utf8");
  if (!/^[a-f0-9]{40}$/.test(manifest.builder.emsdkCommit) || !dockerfile.includes(manifest.builder.emsdkCommit) || !dockerfile.includes(manifest.builder.debianSnapshot)) throw new Error("HEIC builder provenance drift");
  const expected = { "heic-to": "1.5.2", libheif: "1.22.2", libde265: "1.0.16" };
  const lock = JSON.parse(await readFile(path.join(root, "web/package-lock.json"), "utf8"));
  if (lock.packages["node_modules/heic-to"].version !== expected["heic-to"]) throw new Error("HEIC npm version drift");
  const check = async (base, name, hash) => {
    if (!/^[a-zA-Z0-9_./-]+$/.test(name) || name.split("/").includes("..") || path.isAbsolute(name) || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid HEIC evidence path/hash");
    if (sha256(await readFile(path.join(base, name))) !== hash) throw new Error(`HEIC evidence hash mismatch: ${name}`);
  };
  const seen = new Set();
  for (const item of manifest.components) {
    if (!expected[item.name] || seen.has(item.name) || item.version !== expected[item.name] || item.license !== (item.name === "heic-to" ? "LGPL-3.0" : "LGPL-3.0-or-later") || !/^[a-f0-9]{40}$/.test(item.commit)) throw new Error("HEIC component version/provenance drift");
    seen.add(item.name);
    await check(vendor, item.archive, item.sha256);
  }
  for (const required of ["tools/heic/Dockerfile", "tools/heic/build.sh", "tools/heic/libheif-emscripten-4.0.10.patch"]) {
    await check(root, required, manifest.recipe[required]);
  }
  if (outputs) for (const required of ["heic-to.js", "heic-to.d.ts", "native-sha256.txt", "toolchain.txt"]) {
    await check(vendor, required, manifest.outputs[required]);
  }
  for (const name of ["emscripten-runtime", "musl", "llvm-runtime", "dlmalloc"]) {
    const notice = manifest.runtimeNotices?.find((item) => item.name === name);
    if (!notice?.files?.length) throw new Error(`Missing compiler runtime notice: ${name}`);
    for (const file of notice.files) await check(path.join(root, "web"), file.file, file.sha256);
  }
  const bundled = JSON.parse(await readFile(path.join(root, "web/scripts/bundled-licenses.json"), "utf8"));
  for (const name of ["libheif", "libde265"]) {
    if (!bundled.some((item) => item.name === name && item.version === expected[name] && item.parentVersion === expected["heic-to"])) throw new Error("HEIC bundled license version drift");
  }
  if (outputs && (await readFile(path.join(vendor, "heic-to.js"), "utf8")).includes("miroven-probe-")) throw new Error("Probe codec cannot be distributed");
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyHeic();
  console.log("HEIC source, recipe and vendor hashes verified.");
}
