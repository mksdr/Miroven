import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const webDirectory = fileURLToPath(new URL("../", import.meta.url));
nextEnv.loadEnvConfig(webDirectory, false);
const outDirectory = path.join(webDirectory, "out");
const headersPath = path.join(outDirectory, "_headers");
const checkOnly = process.argv.includes("--check");

async function listHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listHtmlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".html") ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}

function collectInlineScriptHashes(html) {
  const hashes = [];
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const [, attributes, content] = match;
    if (/\bsrc\s*=/i.test(attributes) || content.length === 0) continue;
    const digest = createHash("sha256").update(content, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function collectInlineStyleHashes(html) {
  const hashes = [];
  const stylePattern = /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi;
  for (const match of html.matchAll(stylePattern)) {
    const [, , content] = match;
    if (content.length === 0) continue;
    const digest = createHash("sha256").update(content, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function replaceScriptSources(csp, hashes) {
  // Permit the local WebP WASM codec without enabling JavaScript eval.
  const replacement = `script-src 'self' 'wasm-unsafe-eval'${hashes.length ? ` ${hashes.join(" ")}` : ""}`;
  if (!/(?:^|;\s*)script-src\s+[^;]*/i.test(csp)) {
    throw new Error("Content-Security-Policy is missing script-src.");
  }
  return csp.replace(/script-src\s+[^;]*/i, replacement);
}

function replaceStyleSources(csp, hashes) {
  const replacement = `style-src 'self'${hashes.length ? ` ${hashes.join(" ")}` : ""}`;
  if (!/(?:^|;\s*)style-src\s+[^;]*/i.test(csp)) {
    throw new Error("Content-Security-Policy is missing style-src.");
  }
  return csp.replace(/style-src\s+[^;]*/i, replacement);
}

const htmlFiles = await listHtmlFiles(outDirectory);
if (htmlFiles.length === 0) throw new Error("No exported HTML files found. Run next build first.");

const scriptHashes = new Set();
const styleHashes = new Set();
for (const htmlPath of htmlFiles) {
  const html = await readFile(htmlPath, "utf8");
  for (const hash of collectInlineScriptHashes(html)) scriptHashes.add(hash);
  for (const hash of collectInlineStyleHashes(html)) styleHashes.add(hash);
}
const sortedScriptHashes = [...scriptHashes].sort();
const sortedStyleHashes = [...styleHashes].sort();

const headers = await readFile(headersPath, "utf8");
const cspLinePattern = /^(\s*Content-Security-Policy:\s*)(.+)$/m;
const match = headers.match(cspLinePattern);
if (!match) throw new Error(`${headersPath} is missing Content-Security-Policy.`);
if (/script-src\s+[^;]*'unsafe-inline'/i.test(match[2])) {
  throw new Error("script-src must not contain 'unsafe-inline'.");
}
if (/style-src\s+[^;]*'unsafe-inline'/i.test(match[2])) {
  throw new Error("style-src must not contain 'unsafe-inline'.");
}

let finalizedCsp = replaceScriptSources(match[2], sortedScriptHashes);
finalizedCsp = replaceStyleSources(finalizedCsp, sortedStyleHashes);
const apiBase = process.env.NEXT_PUBLIC_MIROVEN_API_URL;
let connectSources = "'self'";
if (apiBase && !apiBase.startsWith("/")) {
  const api = new URL(apiBase);
  if (api.username || api.password || api.search || api.hash
    || !["http:", "https:"].includes(api.protocol)
    || (api.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(api.hostname))) {
    throw new Error("API URL must use HTTPS or a loopback development host.");
  }
  connectSources += ` ${api.origin}`;
}
if (apiBase?.startsWith("//")) throw new Error("Use an explicit HTTPS API URL.");
finalizedCsp = finalizedCsp.replace(/connect-src\s+[^;]*/i, `connect-src ${connectSources}`);
const finalizedHeaders = headers.replace(cspLinePattern, `${match[1]}${finalizedCsp}`);

if (checkOnly) {
  if (headers !== finalizedHeaders) {
    throw new Error("Exported CSP hashes do not match the inline scripts/styles. Run npm run build.");
  }
  console.log(`CSP covers ${sortedScriptHashes.length} unique inline scripts and ${sortedStyleHashes.length} unique inline styles across ${htmlFiles.length} HTML files.`);
} else {
  await writeFile(headersPath, finalizedHeaders, "utf8");
  console.log(`Added ${sortedScriptHashes.length} script hashes and ${sortedStyleHashes.length} style hashes for ${htmlFiles.length} exported HTML files.`);
}
