import fs from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve("out");
const entryHtml = path.join(outputDirectory, "index.html");
const MAX_INITIAL_ASSET_BYTES = 800 * 1024;
// Includes four-photo controls plus 3 KiB for quote cards and composer previews.
const MAX_INITIAL_CSS_BYTES = 42 * 1024;

if (!fs.existsSync(entryHtml)) {
  console.error("Bundle budget requires a completed static build. Run npm run build first.");
  process.exit(1);
}

const html = fs.readFileSync(entryHtml, "utf8");
const assetPattern = /(?:src|href)="([^"]+\.(?:js|css))"/g;
const assetPaths = new Set([...html.matchAll(assetPattern)].map((match) => match[1]));

let totalBytes = 0;
let cssBytes = 0;
const measuredAssets = [];

for (const assetPath of assetPaths) {
  const localPath = path.join(outputDirectory, assetPath.replace(/^\//, ""));
  if (!fs.existsSync(localPath)) continue;
  const bytes = fs.statSync(localPath).size;
  totalBytes += bytes;
  if (assetPath.endsWith(".css")) cssBytes += bytes;
  measuredAssets.push({ assetPath, bytes });
}

measuredAssets.sort((left, right) => right.bytes - left.bytes);
console.log(`Initial JS/CSS: ${(totalBytes / 1024).toFixed(1)} KiB`);
console.log(`Initial CSS: ${(cssBytes / 1024).toFixed(1)} KiB`);
for (const asset of measuredAssets.slice(0, 5)) {
  console.log(`  ${(asset.bytes / 1024).toFixed(1)} KiB  ${asset.assetPath}`);
}

const failures = [];
if (totalBytes > MAX_INITIAL_ASSET_BYTES) {
  failures.push(
    `initial JS/CSS exceeded ${(MAX_INITIAL_ASSET_BYTES / 1024).toFixed(0)} KiB`,
  );
}
if (cssBytes > MAX_INITIAL_CSS_BYTES) {
  failures.push(`initial CSS exceeded ${(MAX_INITIAL_CSS_BYTES / 1024).toFixed(0)} KiB`);
}

if (failures.length > 0) {
  console.error(`Bundle budget failed: ${failures.join("; ")}`);
  process.exit(1);
}

console.log("Bundle budget passed.");
