import { readFile, writeFile } from "node:fs/promises";
const headers = await readFile(new URL("../out/_headers", import.meta.url), "utf8");
const lines = headers.split(/\r?\n/).filter(line => /^\s+[^:]+:/.test(line));
await writeFile(new URL("../out/.nginx-headers", import.meta.url), lines.map(line => {
  const [, key, value] = line.match(/^\s+([^:]+):\s*(.*)$/);
  return `add_header ${key} "${value.replaceAll('"', '\\"')}" always;`;
}).join("\n") + "\n");
