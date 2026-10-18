import { createServer } from "node:http";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { headersForPath, parseHeaderRules } from "./header-rules.mjs";

const root = fileURLToPath(new URL("../out", import.meta.url));
const port = Number(process.env.PORT || 3100);
const host = "127.0.0.1";

if (!existsSync(path.join(root, "index.html"))) {
  console.error("Error: out/index.html not found. Please run 'npm run build' before running browser tests.");
  process.exit(1);
}

// Parse headers from out/_headers if available (specifically for Content-Security-Policy and security headers)
const headersPath = path.join(root, "_headers");
const headerRules = existsSync(headersPath) ? parseHeaderRules(readFileSync(headersPath, "utf8")) : [];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  const parsedUrl = new URL(req.url ?? "/", `http://${host}:${port}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);
  let customHeaders = headersForPath(headerRules, pathname);
  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }

  let filePath = path.join(root, pathname);

  // Next may export /guide.html alongside a /guide directory of route data.
  // Match production nginx: prefer the HTML page over that data directory.
  if (!path.extname(filePath) && existsSync(`${filePath}.html`)) {
    filePath = `${filePath}.html`;
  } else if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    const notFoundPath = path.join(root, "404.html");
    if (existsSync(notFoundPath)) {
      customHeaders = headersForPath(headerRules, "/404");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8", ...customHeaders });
      createReadStream(notFoundPath).pipe(res);
      return;
    }
    res.writeHead(404).end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";

  res.writeHead(200, {
    "Content-Type": contentType,
    ...customHeaders,
  });
  createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Test server running at http://${host}:${port}`);
});
