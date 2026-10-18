import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectLicenses, readJson, webRoot } from "./collect-licenses.mjs";
import { applyReview, assessLicense, sources, validateReviews } from "./license-policy.mjs";

export function checkEntries(entries, reviews = []) {
  validateReviews(reviews);
  return entries.map((entry) => {
    let assessment = applyReview(entry, assessLicense(entry.license, entry.scope), reviews);
    // Manual reviews cannot conceal changed embedded versions or conflicting metadata.
    if (entry.issues.length) assessment = { ...assessment, status: assessment.status === "incompatible" ? "incompatible" : "review", reason: `${assessment.reason} ${entry.issues.join(" ")}` };
    return { name: entry.name, version: entry.version, license: entry.license || null, scope: entry.scope, location: entry.location, dependencyPath: entry.dependencyPath, installed: entry.installed, evidence: entry.files.map((file) => file.file), ...assessment, action: assessment.status === "pass" ? "개별 라이선스의 고지·배포 조건을 유지하세요." : "원문과 배포 포함 여부를 검토하고, 필요하면 의존성을 교체하거나 버전별 수동 검토 기록을 추가하세요.", source: entry.source ?? sources.licenses };
  });
}
async function main() {
  const output = path.join(webRoot, "license-reports/report.json");
  try {
    const pkg = await readJson(path.join(webRoot, "package.json"));
    if (pkg.license !== "AGPL-3.0-only") throw new Error(`Unsupported project license: ${pkg.license}. Update compatibility rules first.`);
    const reviews = await readJson(path.join(webRoot, "scripts/license-reviews.json"));
    const findings = checkEntries(await collectLicenses(), reviews);
    const summary = { pass: 0, incompatible: 0, review: 0 };
    for (const finding of findings) summary[finding.status]++;
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ completed: true, projectLicense: pkg.license, sources, summary, findings }, null, 2) + "\n");
    console.log(`License check: ${summary.pass} passed, ${summary.incompatible} incompatible warnings, ${summary.review} need review.`);
    for (const finding of findings.filter((item) => item.status !== "pass")) {
      const message = `${finding.status}: ${finding.name}@${finding.version} [${finding.license ?? "missing"}; ${finding.scope}]\n  ${finding.dependencyPath.join(" -> ")}\n  ${finding.location}\n  ${finding.reason}\n  ${finding.action}`;
      console.warn(message);
      if (process.env.GITHUB_ACTIONS === "true") console.warn(`::warning::${message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
    }
    console.log(`Report: ${path.relative(webRoot, output)} (warnings do not block builds)`);
  } catch (error) {
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ completed: false, error: error.message }, null, 2) + "\n");
    console.error(`License checker failed: ${error.message}`);
    process.exitCode = 1;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
