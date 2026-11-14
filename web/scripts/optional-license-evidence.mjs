import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export function validateLicenseDeclaration(data, name, info) {
  const declaration = JSON.parse(data.toString("utf8"));
  if (declaration.name !== name || declaration.version !== info.version || declaration.license !== info.license) throw new Error(`Upstream license declaration mismatch: ${name}`);
}

// Archived originals are evidence, not compatibility approvals. A dependency
// upgrade must supply new evidence and still satisfy the ordinary policy/review.
export async function archivedOptionalNotices(root, location, info, records) {
  const record = records.find((item) => item.location === location);
  const name = location.split("node_modules/").at(-1);
  if (!record || !info.integrity || ["version", "license", "resolved", "integrity"].some((key) => record[key] !== info[key]) || record.name !== name || !record.files?.length) return [];
  const files = [];
  for (const file of record.files) {
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`Invalid optional license hash: ${location}`);
    const original = `scripts/optional-license-sources/${file.sha256}.txt`;
    const data = await readFile(path.join(root, original));
    if (sha256(data) !== file.sha256 || !data.toString("utf8").trim()) throw new Error(`Invalid optional license original: ${location}/${file.file}`);
    if (file.kind === "license-declaration") validateLicenseDeclaration(data, name, info);
    files.push({ file: original, text: data.toString("utf8").trim(), ...(file.source ? { source: file.source } : {}), ...(file.kind ? { kind: file.kind } : {}) });
  }
  return files;
}
