import { readFile, writeFile } from "node:fs/promises";
import { headersForPath, parseHeaderRules } from "./header-rules.mjs";
const headers = await readFile(new URL("../out/_headers", import.meta.url), "utf8");
const rules = parseHeaderRules(headers);
const globalHeaders = headersForPath(rules, "/*");
const quote = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$")}"`;
const lines = [`set $miroven_csp ${quote(globalHeaders["content-security-policy"])};`];
for (const rule of rules.filter((rule) => rule.path !== "/*")) {
  const csp = headersForPath(rules, rule.path)["content-security-policy"];
  lines.push(`if ($uri = ${quote(rule.path)}) { set $miroven_csp ${quote(csp)}; }`);
}
for (const [name, value] of Object.entries(globalHeaders)) {
  lines.push(`add_header ${name} ${name === "content-security-policy" ? '"$miroven_csp"' : quote(value)} always;`);
}
await writeFile(new URL("../out/.nginx-headers", import.meta.url), lines.join("\n") + "\n");
