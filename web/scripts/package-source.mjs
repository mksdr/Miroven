import { readFile, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { repositoryRoot, sha256, verifyHeic } from "./check-heic.mjs";

// Explicit source roots: never traverse the checkout, node_modules, .local or out.
export const sourceDirectories = [".github", "deploy", "docs", "tools/heic", "web/app", "web/public", "web/scripts", "web/tests", "web/vendor/heic"];
export const sourceFiles = ["LICENSE", "README.md", "README.ko.md", "CONTRIBUTING.md", "SECURITY.md", "AGENTS.md", "CHANGELOG.md", "Dockerfile", ".dockerignore", ".gitignore", ".gitattributes", "version.txt", "release-please-config.json", ".release-please-manifest.json", "web/AGENTS.md", "web/CLAUDE.md", "web/.env.example", "web/.gitignore", "web/package.json", "web/package-lock.json", "web/next.config.ts", "web/tsconfig.json", "web/eslint.config.mjs", "web/playwright.config.ts", "web/playwright.offline.config.ts", "web/playwright.performance.config.ts", "web/playwright.updates.config.ts", "web/vitest.config.ts"];
export function allowedSourcePath(name) {
  return !name.split("/").some((part) => part === ".." || part === "node_modules" || part === ".local" || part === ".git" || (part.startsWith(".env") && part !== ".env.example") || /\.(?:pem|key|log)$/i.test(part));
}
export async function collectSource(root) {
  const files = new Map();
  const add = async (name) => {
    if (!allowedSourcePath(name)) throw new Error(`Forbidden source input: ${name}`);
    const info = await lstat(path.join(root, name));
    if (info.isSymbolicLink()) throw new Error(`Source symlink is not permitted: ${name}`);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path.join(root, name))).sort()) await add(`${name}/${entry}`);
    } else if (info.isFile()) files.set(name, { data: await readFile(path.join(root, name)), mode: info.mode & 0o111 ? 0o755 : 0o644 });
    else throw new Error(`Unsupported source input: ${name}`);
  };
  for (const name of [...sourceFiles, ...sourceDirectories]) await add(name);
  return files;
}
// Deterministic POSIX ustar, no tar dependency in ordinary npm/Docker builds.
export function sourceTar(files) {
  const chunks = [];
  for (const [filename, { data, mode }] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const header = Buffer.alloc(512);
    let name = filename, prefix = "";
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf("/", 155);
      prefix = name.slice(0, split); name = name.slice(split + 1);
    }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Source path too long: ${filename}`);
    header.write(name, 0, 100); header.write(prefix, 345, 155);
    const octal = (value, offset, size) => header.write(value.toString(8).padStart(size - 1, "0") + "\0", offset, size);
    octal(mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(data.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}
export async function packageSource(root = repositoryRoot) {
  const manifest = await verifyHeic(root);
  const files = await collectSource(root);
  // Match Next's production .env precedence without distributing the files.
  const require = createRequire(path.join(root, "web/node_modules/next/package.json"));
  const { loadEnvConfig } = require("@next/env");
  loadEnvConfig(path.join(root, "web"), false);
  const settings = {};
  for (const name of ["NEXT_PUBLIC_MIROVEN_API_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_WEBSITE_URL", "SERVICE_WORKER_CACHE_VERSION"]) {
    if (process.env[name] !== undefined) settings[name] = process.env[name];
  }
  files.set("BUILD-SETTINGS.json", { data: Buffer.from(JSON.stringify(settings, null, 2) + "\n"), mode: 0o644 });
  files.set("REBUILD.md", { data: Buffer.from("# Rebuilding this distribution\n\nSee tools/heic/README.md. From web/, install dependencies with npm ci.\nSet the public variables listed in BUILD-SETTINGS.json before npm run build.\nThe source is the actual build input snapshot, including local changes, not a claim of a clean Git commit.\nNative probe patches are test-only. No signing key or proprietary relinker is required.\n"), mode: 0o644 });
  const hashes = Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b, "en")).map(([name, file]) => [name, sha256(file.data)]));
  const archive = sourceTar(files);
  const out = path.join(root, "web/out/source");
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "miroven-source.tar.gz"), archive);
  await writeFile(path.join(out, "SHA256SUMS"), `${sha256(archive)}  miroven-source.tar.gz\n`);
  await writeFile(path.join(out, "manifest.json"), JSON.stringify({ schemaVersion: 1, archive: "miroven-source.tar.gz", sha256: sha256(archive), publicBuildSettings: settings, components: manifest.components, files: hashes }, null, 2) + "\n");
  console.log(`Packaged ${files.size} source files (${archive.length} bytes).`);
  return { files, archive };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageSource();
