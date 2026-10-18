// The generated file uses one global rule and exact page paths.
export function validatePagesHeaders(content) {
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (line.length > 2000) throw new Error(`_headers line ${index + 1} exceeds Cloudflare Pages' 2,000-character limit (${line.length}).`);
  }
  const ruleCount = lines.filter((line) => line && !/^\s|^#/.test(line)).length;
  if (ruleCount > 100) throw new Error(`_headers exceeds Cloudflare Pages' 100-rule limit (${ruleCount}).`);
  return { ruleCount, longestLine: Math.max(...lines.map((line) => line.length)) };
}

export function parseHeaderRules(content) {
  const rules = [];
  let current;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = { path: line.trim(), headers: {} };
      rules.push(current);
    } else {
      const match = line.match(/^\s+([^:]+):\s*(.*)$/);
      if (!current || !match) throw new Error(`Unsupported _headers line: ${line}`);
      current.headers[match[1].toLowerCase()] = match[2];
    }
  }
  return rules;
}

export function headersForPath(rules, pathname) {
  const headers = {};
  for (const rule of rules) {
    if (rule.path !== "/*" && rule.path !== pathname) continue;
    for (const [name, value] of Object.entries(rule.headers)) {
      headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
    }
  }
  return headers;
}
