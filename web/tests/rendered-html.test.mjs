import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { headersForPath, parseHeaderRules, validatePagesHeaders } from "../scripts/header-rules.mjs";

const outDirectory = fileURLToPath(new URL("../out", import.meta.url));
nextEnv.loadEnvConfig(fileURLToPath(new URL("../", import.meta.url)), false);
const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL || "https://miroven-app.mksdr.bid";
const appOrigin = new URL(/^https?:\/\//i.test(configuredOrigin) ? configuredOrigin : `https://${configuredOrigin}`).origin;
const originPattern = appOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("exported CSP permits only hashed inline scripts and styles without unsafe-inline", () => {
  const headers = fs.readFileSync(path.join(outDirectory, "_headers"), "utf8");
  assert.doesNotMatch(headers, /\r/, "generated headers should use consistent LF line endings");
  validatePagesHeaders(headers);
  const csp = headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m)?.[1] ?? "";
  const scriptSources = csp.match(/(?:^|;\s*)script-src\s+([^;]*)/i)?.[1] ?? "";
  assert.ok(scriptSources, "the exported headers should define script-src");
  assert.doesNotMatch(scriptSources, /'unsafe-inline'/i);
  assert.doesNotMatch(scriptSources, /'unsafe-eval'/i);
  assert.match(scriptSources, /'wasm-unsafe-eval'/i);

  const styleSources = csp.match(/(?:^|;\s*)style-src\s+([^;]*)/i)?.[1] ?? "";
  assert.ok(styleSources, "the exported headers should define style-src");
  assert.doesNotMatch(styleSources, /'unsafe-inline'/i);

  const htmlFiles = fs.readdirSync(outDirectory)
    .filter((name) => name.endsWith(".html"))
    .map((name) => path.join(outDirectory, name));
  assert.ok(htmlFiles.length > 0, "the static export should contain HTML files");

  for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(htmlFile, "utf8");
    const route = path.basename(htmlFile) === "index.html" ? "/" : `/${path.basename(htmlFile, ".html")}`;
    const rules = parseHeaderRules(headers);
    const pageRule = rules.find((rule) => rule.path === route);
    assert.ok(pageRule, `${route} should have its own CSP`);
    const policies = headersForPath(rules, route)["content-security-policy"].split(", ");
    assert.equal(policies.length, 2, `${route} should inherit the fallback and page policies`);
    const pageScripts = pageRule.headers["content-security-policy"].match(/script-src\s+([^;]*)/i)[1];
    assert.equal((pageScripts.match(/'sha256-[^']+'/g) ?? []).length,
      new Set([...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter(([, attributes, content]) => !/\bsrc\s*=/i.test(attributes) && content)
        .map(([, , content]) => createHash("sha256").update(content).digest("base64"))).size,
      `${route} must only allow its own inline script hashes`);

    // Static HTML must not have inline style attributes
    const inlineStyleAttr = html.match(/<[a-z0-9-]+\b[^>]*\sstyle\s*=\s*["'][^"']*["'][^>]*>/i);
    assert.equal(
      inlineStyleAttr,
      null,
      `HTML file ${path.basename(htmlFile)} should not contain inline style attributes: ${inlineStyleAttr?.[0]}`
    );

    const inlineScripts = html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
    for (const [, attributes, content] of inlineScripts) {
      if (/\bsrc\s*=/i.test(attributes) || content.length === 0) continue;
      const digest = createHash("sha256").update(content, "utf8").digest("base64");
      for (const policy of policies) assert.ok(policy.includes(`'sha256-${digest}'`), `${route}: every policy must allow the script`);
      assert.match(scriptSources, new RegExp(`(?:^|\\s)'sha256-${digest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'(?:\\s|$)`));
    }

    const inlineStyles = html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi);
    for (const [, , content] of inlineStyles) {
      if (content.length === 0) continue;
      const digest = createHash("sha256").update(content, "utf8").digest("base64");
      for (const policy of policies) assert.ok(policy.includes(`'sha256-${digest}'`), `${route}: every policy must allow the style`);
      assert.match(styleSources, new RegExp(`(?:^|\\s)'sha256-${digest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'(?:\\s|$)`));
    }
  }
});

test("Cloudflare header validation enforces line and rule limits", () => {
  assert.doesNotThrow(() => validatePagesHeaders(`/*\n  X-Test: ${"a".repeat(1990)}`));
  assert.throws(() => validatePagesHeaders(`/*\n  X-Test: ${"a".repeat(1991)}`), /2,000-character/);
  assert.doesNotThrow(() => validatePagesHeaders(Array.from({ length: 100 }, (_, i) => `/page-${i}\n  X-Test: ok`).join("\n")));
  assert.throws(() => validatePagesHeaders(Array.from({ length: 101 }, (_, i) => `/page-${i}\n  X-Test: ok`).join("\n")), /100-rule/);
});

test("large license page extracts scripts into content-addressed static assets", () => {
  const html = fs.readFileSync(path.join(outDirectory, "notice.html"), "utf8");
  const assets = [...html.matchAll(/<script src="(\/_next\/static\/csp\/([a-f0-9]{64})\.js)"><\/script>/g)];
  assert.ok(assets.length > 0, "the license page should extract scripts to keep CSP short");
  for (const [, url, digest] of assets) {
    const content = fs.readFileSync(path.join(outDirectory, url));
    assert.equal(createHash("sha256").update(content).digest("hex"), digest);
  }
});

test("server-renders the Miroven journal shell", async (context) => {
  const port = 32000 + (process.pid % 1000);
  const server = http.createServer((req, res) => {
    const reqPath = (req.url ?? "/").split("?")[0];
    let filePath = path.join(outDirectory, reqPath === "/" ? "index.html" : reqPath);
    if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) {
      filePath = `${filePath}.html`;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes = {
        ".html": "text/html; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".txt": "text/plain; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
      };
      const contentType = mimeTypes[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Miroven<\/title>/i);
  assert.match(html, new RegExp(`<link\\s+rel="canonical"\\s+href="${originPattern}"\\s*/?>`, "i"));
  assert.match(html, /<h1\s+class="sr-only">Miroven - 나만 볼 수 있는 암호화 저널<\/h1>/i);
  const jsonLdSource = html.match(
    /<script\s+type="application\/ld\+json">([^<]+)<\/script>/i,
  )?.[1];
  assert.ok(jsonLdSource, "the home page should include JSON-LD structured data");
  const jsonLd = JSON.parse(jsonLdSource);
  assert.equal(jsonLd["@context"], "https://schema.org");
  assert.deepEqual(
    jsonLd["@graph"].map((entry) => entry["@type"]),
    ["WebSite", "WebApplication"],
  );
  assert.equal(jsonLd["@graph"][0].url, `${appOrigin}/`);
  assert.equal(jsonLd["@graph"][1].isPartOf["@id"], `${appOrigin}/#website`);
  const rasterIconTag = html.match(/<link\b[^>]*>/gi)?.find(
    (tag) => /rel="icon"/i.test(tag) && /href="\/favicon-48x48\.png"/i.test(tag),
  );
  assert.ok(rasterIconTag, "the home page should register the raster favicon");
  assert.match(rasterIconTag, /sizes="48x48"/i);
  assert.match(rasterIconTag, /type="image\/png"/i);

  const faviconPath = path.join(outDirectory, "favicon-48x48.png");
  assert.ok(fs.existsSync(faviconPath), "the static export should contain the raster favicon");
  const favicon = fs.readFileSync(faviconPath);
  assert.deepEqual([...favicon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(favicon.readUInt32BE(16), 48);
  assert.equal(favicon.readUInt32BE(20), 48);
  assert.match(html, /내 저널/);
  assert.match(html, /나만 볼 수 있는 타임라인/);
  assert.match(html, /암호화됨/);
  assert.match(html, /표시 설정/);
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]+)"\s*\/?>/i)?.[1] ?? "";
  assert.match(viewport, /(?:^|,\s*)width=device-width(?:,|$)/i);
  assert.match(viewport, /(?:^|,\s*)initial-scale=1(?:,|$)/i);
  assert.doesNotMatch(viewport, /maximum-scale/i);
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no/i);
  const postButton = html.match(/<button class="post-button"[^>]*>/i)?.[0] ?? "";
  assert.ok(postButton, "the journal post button should be server-rendered");
  assert.doesNotMatch(postButton, /\bdisabled\b/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("does not export the informational pages moved to the website", () => {
  for (const route of ["about", "privacy", "tos"]) {
    assert.ok(!fs.existsSync(path.join(outDirectory, `${route}.html`)));
    assert.ok(!fs.existsSync(path.join(outDirectory, route)));
  }
});

test("exports an optimized Open Graph PNG", () => {
  const ogImagePath = path.join(outDirectory, "og.png");
  assert.ok(fs.existsSync(ogImagePath), "the static export should contain og.png");
  assert.ok(
    fs.statSync(ogImagePath).size <= 300 * 1024,
    "og.png should not exceed 300 KiB",
  );

  const ogImage = fs.readFileSync(ogImagePath);
  assert.deepEqual([...ogImage.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(ogImage.readUInt32BE(16), 1536);
  assert.equal(ogImage.readUInt32BE(20), 1024);
});

test("exports 404 page with clean title and noindex", () => {
  const notFoundPath = path.join(outDirectory, "404.html");
  assert.ok(fs.existsSync(notFoundPath), "the static export should include /404");

  const html = fs.readFileSync(notFoundPath, "utf8");
  assert.match(html, /<title>404: 페이지를 찾을 수 없습니다 · Miroven<\/title>/i);
  assert.doesNotMatch(html, /Miroven · Miroven/);
  assert.match(html, /<meta\s+name="robots"\s+content="noindex,\s*nofollow"\s*\/?>/i);
});

test("exported Service Worker defines automated build cache name matching static artifacts", () => {
  const swPath = path.join(outDirectory, "sw.js");
  assert.ok(fs.existsSync(swPath), "the static export should contain sw.js");

  const content = fs.readFileSync(swPath, "utf8");
  const match = content.match(/const\s+CACHE_NAME\s*=\s*["']([^"']+)["'];/);
  assert.ok(match, "out/sw.js must define CACHE_NAME");
  const cacheName = match[1];

  assert.match(
    cacheName,
    /^miroven-shell-v\d+\.\d+\.\d+-[a-f0-9]{10}$/,
    `cache name "${cacheName}" must follow miroven-shell-v<version>-<hash> format`,
  );
  assert.doesNotMatch(cacheName, /miroven-shell-dev/);
  assert.doesNotMatch(cacheName, /miroven-shell-v4$/);

  // Must include clean-up of old caches
  assert.match(content, /caches\.delete/);
  assert.match(content, /key\s*!==\s*CACHE_NAME/);
});

test("exports sitemap.xml and links it from robots.txt", () => {
  const sitemapPath = path.join(outDirectory, "sitemap.xml");
  assert.ok(fs.existsSync(sitemapPath), "the static export should contain sitemap.xml");

  const sitemapContent = fs.readFileSync(sitemapPath, "utf8");
  assert.match(sitemapContent, /<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/i);
  for (const route of ["", "/guide"]) {
    assert.match(sitemapContent, new RegExp(`<loc>${originPattern}${route}/?</loc>`, "i"));
  }
  assert.equal([...sitemapContent.matchAll(/<loc>/g)].length, 2);
  assert.match(sitemapContent, /<changefreq>daily<\/changefreq>/i);
  assert.match(sitemapContent, /<priority>1(?:\.0)?<\/priority>/i);

  const robotsPath = path.join(outDirectory, "robots.txt");
  assert.ok(fs.existsSync(robotsPath), "the static export should contain robots.txt");
  const robotsContent = fs.readFileSync(robotsPath, "utf8");
  assert.match(robotsContent, new RegExp(`^Sitemap:\\s*${originPattern}/sitemap\\.xml$`, "m"));
});
