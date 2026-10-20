import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { parse } from "parse5";
import { validatePagesHeaders } from "./header-rules.mjs";

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

function collectCspElements(html) {
  const elements = [];
  const document = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true });
  function visit(node) {
    if (node.tagName === "script" || node.tagName === "style") {
      // Hash the text the browser sees, including HTML newline/null normalization.
      const content = (node.childNodes ?? [])
        .filter((child) => child.nodeName === "#text")
        .map((child) => child.value).join("");
      elements.push({ ...node, content });
    }
    // Template content is inert and lives in a separate document fragment.
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(document);
  return elements;
}

function collectInlineHashes(elements, tagName) {
  const hashes = [];
  for (const { tagName: name, attrs, content } of elements) {
    if (name !== tagName || (name === "script" && attrs.some((attr) => attr.name === "src"))) continue;
    if (content.length === 0) continue;
    const digest = createHash("sha256").update(content, "utf8").digest("base64");
    hashes.push(`'sha256-${digest}'`);
  }
  return hashes;
}

function extractableScripts(page) {
  return page.elements.filter((element) => element.tagName === "script"
    && element.namespaceURI === "http://www.w3.org/1999/xhtml"
    && element.attrs.length === 0 && element.content.length > 0
    && element.sourceCodeLocation?.startTag && element.sourceCodeLocation?.endTag)
    .sort((a, b) => a.sourceCodeLocation.startOffset - b.sourceCodeLocation.startOffset);
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

// Always generate from the source template, so repeated runs are deterministic.
const headers = (await readFile(path.join(webDirectory, "public", "_headers"), "utf8")).replace(/\r\n/g, "\n");
const cspLinePattern = /^([\t ]*Content-Security-Policy:[\t ]*)([^\r\n]+)$/m;
const match = headers.match(cspLinePattern);
if (!match) throw new Error(`${headersPath} is missing Content-Security-Policy.`);
if (/script-src\s+[^;]*'unsafe-inline'/i.test(match[2])) {
  throw new Error("script-src must not contain 'unsafe-inline'.");
}
if (/style-src\s+[^;]*'unsafe-inline'/i.test(match[2])) {
  throw new Error("style-src must not contain 'unsafe-inline'.");
}

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
const baseCsp = match[2].replace(/connect-src\s+[^;]*/i, `connect-src ${connectSources}`);
const unique = (hashes) => [...new Set(hashes)].sort();
function policyFor(pages) {
  let csp = replaceScriptSources(baseCsp, unique(pages.flatMap((page) => collectInlineHashes(page.elements, "script"))));
  csp = replaceStyleSources(csp, unique(pages.flatMap((page) => collectInlineHashes(page.elements, "style"))));
  return csp;
}
const cspLine = (csp) => `  Content-Security-Policy: ${csp}`;
const pages = [];
for (const htmlPath of htmlFiles.sort()) {
  const html = await readFile(htmlPath, "utf8");
  pages.push({ htmlPath, html, elements: collectCspElements(html) });
}

// Keep the fallback policy within Pages' limit too. It covers static assets and
// custom 404 responses at arbitrary URLs. Exact page rules below further restrict
// hashes; Cloudflare joins overlapping CSP headers into intersecting policies.
while (cspLine(policyFor(pages)).length > 2000) {
  const candidate = pages
    .filter((page) => extractableScripts(page).length > 0)
    .sort((a, b) => collectInlineHashes(b.elements, "script").length - collectInlineHashes(a.elements, "script").length)[0];
  if (!candidate) throw new Error("CSP exceeds Cloudflare Pages' 2,000-character line limit even after extracting scripts.");
  if (checkOnly) throw new Error("CSP requires script extraction. Run npm run build.");
  const scriptsDirectory = path.join(outDirectory, "_next", "static", "csp");
  await mkdir(scriptsDirectory, { recursive: true });
  const assets = [];
  // Only extract classic scripts without attributes. Preserve their position and
  // parser-blocking execution order; JSON-LD and module scripts remain untouched.
  let cursor = 0;
  const chunks = [];
  for (const { content, sourceCodeLocation } of extractableScripts(candidate)) {
    const digest = createHash("sha256").update(content, "utf8").digest("hex");
    assets.push({ digest, content });
    chunks.push(candidate.html.slice(cursor, sourceCodeLocation.startOffset),
      `<script src="/_next/static/csp/${digest}.js"></script>`);
    cursor = sourceCodeLocation.endOffset;
  }
  chunks.push(candidate.html.slice(cursor));
  candidate.html = chunks.join("");
  candidate.elements = collectCspElements(candidate.html);
  for (const { digest, content } of assets) {
    await writeFile(path.join(scriptsDirectory, `${digest}.js`), content, "utf8");
  }
  await writeFile(candidate.htmlPath, candidate.html, "utf8");
}

let finalizedHeaders = headers.replace(cspLinePattern, cspLine(policyFor(pages))).trimEnd();
for (const page of pages) {
  const relativePath = path.relative(outDirectory, page.htmlPath).split(path.sep).join("/");
  const route = relativePath === "index.html" ? "/" : `/${relativePath.replace(/(?:\/index)?\.html$/, "")}`;
  const aliases = new Set([route, `/${relativePath}`]);
  if (route !== "/") aliases.add(`${route}/`);
  for (const alias of aliases) finalizedHeaders += `\n\n${alias}\n${cspLine(policyFor([page]))}`;
}
finalizedHeaders += "\n";
const { ruleCount, longestLine } = validatePagesHeaders(finalizedHeaders);
for (const page of pages) {
  for (const element of page.elements.filter((element) => element.tagName === "script")) {
    const src = element.attrs.find((attr) => attr.name === "src")?.value;
    const digest = src?.match(/^\/_next\/static\/csp\/([a-f0-9]{64})\.js$/)?.[1];
    if (!digest) continue;
    const content = await readFile(path.join(outDirectory, "_next", "static", "csp", `${digest}.js`));
    if (createHash("sha256").update(content).digest("hex") !== digest) {
      throw new Error(`Extracted CSP script ${digest}.js does not match its content hash. Run npm run build.`);
    }
  }
}

if (checkOnly) {
  if (await readFile(headersPath, "utf8") !== finalizedHeaders) {
    throw new Error("Exported CSP hashes do not match the inline scripts/styles. Run npm run build.");
  }
  console.log(`Verified page CSPs for ${pages.length} HTML files; ${ruleCount} rules; longest line: ${longestLine} characters.`);
} else {
  await writeFile(headersPath, finalizedHeaders, "utf8");
  console.log(`Generated page CSPs for ${pages.length} HTML files; ${ruleCount} rules; longest line: ${longestLine} characters.`);
}
