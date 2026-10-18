import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { collectLicenses, webRoot } from "./collect-licenses.mjs";

// Preserve the public page's grouping; internal checks examine bundles separately.
const notices = (await collectLicenses()).filter((entry) => entry.installed && !entry.location.includes("/dist/compiled/") && entry.name !== "libwebp").map((entry) => ({
  name: entry.name, version: entry.version, license: entry.license || "원문 참조", author: entry.author,
  development: entry.development, files: [...entry.files, ...entry.bundledNotices],
})).sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
await mkdir(path.join(webRoot, "app/notice"), { recursive: true });
await writeFile(path.join(webRoot, "app/notice/notices.json"), JSON.stringify(notices, null, 2) + "\n");
await writeFile(path.join(webRoot, "app/notice/project-license.json"), JSON.stringify(await readFile(path.join(webRoot, "../LICENSE"), "utf8")) + "\n");
console.log(`Collected notices for ${notices.length} installed packages.`);
