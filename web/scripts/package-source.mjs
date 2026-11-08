import { readFile, readdir, lstat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repositoryRoot, sha256, verifyHeic } from "./check-heic.mjs";

// These roots bound the reviewed file list; they do not approve their contents.
export const sourceDirectories = [".github", "deploy", "docs", "tools/heic", "web/app", "web/public", "web/scripts", "web/tests", "web/vendor/heic"];
export const sourceFiles = ["LICENSE", "README.md", "README.ko.md", "CONTRIBUTING.md", "SECURITY.md", "AGENTS.md", "CHANGELOG.md", "Dockerfile", ".dockerignore", ".gitignore", ".gitattributes", "version.txt", "release-please-config.json", ".release-please-manifest.json", "web/AGENTS.md", "web/CLAUDE.md", "web/.env.example", "web/.gitignore", "web/package.json", "web/package-lock.json", "web/next.config.ts", "web/tsconfig.json", "web/eslint.config.mjs", "web/playwright.config.ts", "web/playwright.offline.config.ts", "web/playwright.performance.config.ts", "web/playwright.updates.config.ts", "web/vitest.config.ts"];
export const sourceFileList = "web/scripts/source-files.json";
const inSourceRoots = (name) => sourceFiles.includes(name) || sourceDirectories.some((directory) => name.startsWith(`${directory}/`));
export function allowedSourcePath(name) {
  return typeof name === "string" && !/[\\:\0]/.test(name) && !name.split("/").some((part) => !part || part === "." || part === ".." || part === "node_modules" || part === ".local" || part === ".git" || (part.startsWith(".env") && part !== ".env.example") || /\.(?:pem|key|log)$/i.test(part));
}
export function validateSourceFiles(list) {
  if (list?.schemaVersion !== 1 || !Array.isArray(list.files)) throw new Error("Invalid source file list");
  const approved = new Set();
  for (const name of list.files) {
    if (!allowedSourcePath(name) || !inSourceRoots(name)) throw new Error(`Forbidden source file list entry: ${name}`);
    if (approved.has(name)) throw new Error(`Duplicate source file list entry: ${name}`);
    approved.add(name);
  }
  for (const name of [...sourceFiles, sourceFileList]) {
    if (!approved.has(name)) throw new Error(`Required source file list entry missing: ${name}`);
  }
  return approved;
}
// Updating is an explicit review step, never part of an ordinary build. Git-ignored
// and other untracked local files cannot become candidates through this command.
export async function updateSourceFiles(root = repositoryRoot) {
  const { stdout } = await promisify(execFile)("git", ["-C", root, "ls-files", "--cached", "-z"], { maxBuffer: 16 * 1024 * 1024 });
  const files = [...new Set([...stdout.split("\0").filter((name) => name && inSourceRoots(name)), sourceFileList])].sort();
  const list = { schemaVersion: 1, files };
  validateSourceFiles(list);
  await writeFile(path.join(root, sourceFileList), JSON.stringify(list, null, 2) + "\n");
  console.log(`Updated ${sourceFileList} from Git-tracked paths. Review the diff before distributing.`);
}
export async function collectSource(root) {
  const files = new Map();
  // Check ancestors too: lstat of web/app alone would follow a symlink at web/.
  const checkedDirectories = new Set();
  const checkParents = async (name) => {
    for (let parent = path.posix.dirname(name); parent !== "."; parent = path.posix.dirname(parent)) {
      if (checkedDirectories.has(parent)) continue;
      const info = await lstat(path.join(root, parent));
      if (info.isSymbolicLink()) throw new Error(`Source symlink is not permitted: ${parent}`);
      if (!info.isDirectory()) throw new Error(`Source parent is not a directory: ${parent}`);
      checkedDirectories.add(parent);
    }
  };
  await checkParents(sourceFileList);
  const listInfo = await lstat(path.join(root, sourceFileList));
  if (listInfo.isSymbolicLink()) throw new Error(`Source symlink is not permitted: ${sourceFileList}`);
  if (!listInfo.isFile()) throw new Error(`Source file list is not a regular file: ${sourceFileList}`);
  const approved = validateSourceFiles(JSON.parse(await readFile(path.join(root, sourceFileList), "utf8")));
  const add = async (name) => {
    if (!allowedSourcePath(name)) throw new Error(`Forbidden source input: ${name}`);
    const info = await lstat(path.join(root, name));
    if (info.isSymbolicLink()) throw new Error(`Source symlink is not permitted: ${name}`);
    if (info.isDirectory()) {
      for (const entry of (await readdir(path.join(root, name))).sort()) await add(`${name}/${entry}`);
    } else if (info.isFile()) {
      if (!approved.has(name)) throw new Error(`Unapproved source input: ${name}. Review tracked source changes and run npm run sources:update from web/.`);
      files.set(name, { data: await readFile(path.join(root, name)), mode: (info.mode & 0o111) || name.endsWith(".sh") ? 0o755 : 0o644 });
    }
    else throw new Error(`Unsupported source input: ${name}`);
  };
  for (const name of [...sourceFiles, ...sourceDirectories]) {
    await checkParents(name);
    await add(name);
  }
  for (const name of approved) {
    if (!files.has(name)) throw new Error(`Approved source input missing: ${name}`);
  }
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--update-file-list")) await updateSourceFiles();
  else if (process.argv.includes("--check-file-list")) {
    const files = await collectSource(repositoryRoot);
    console.log(`Verified ${files.size} approved source inputs without Git metadata.`);
  } else await packageSource();
}
