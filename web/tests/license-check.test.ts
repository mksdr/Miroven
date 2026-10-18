import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { assessLicense, parseExpression, applyReview, validateReviews } from "../scripts/license-policy.mjs";
import { collectLicenses } from "../scripts/collect-licenses.mjs";
import { checkEntries } from "../scripts/check-licenses.mjs";

describe("AGPL compatibility policy", () => {
  it("selects an available OR branch and requires every AND branch", () => {
    expect(assessLicense("GPL-2.0-only OR MIT")).toMatchObject({ status: "pass", selected: "MIT" });
    expect(assessLicense("MIT AND GPL-2.0-only").status).toBe("incompatible");
    expect(assessLicense("Apache-2.0 AND LGPL-3.0-or-later").status).toBe("review");
    expect(assessLicense("MIT OR Apache-2.0 AND GPL-2.0-only").status).toBe("pass");
    expect(assessLicense("(MIT OR Apache-2.0) AND GPL-2.0-only").status).toBe("incompatible");
  });
  it("does not reject tools as if they were distributed code", () => {
    expect(assessLicense("GPL-2.0-only", "development").status).toBe("review");
    expect(assessLicense("GPL-2.0-only", "bundled").status).toBe("incompatible");
  });
  it("requires review for unknown identifiers, exceptions and malformed expressions", () => {
    for (const expression of ["", "LicenseRef-Custom", "MIT WITH LLVM-exception", "MIT OR", "(MIT", "MIT XOR ISC", "MIT/ISC", "MIT WITH", "MIT WITH OR"]) {
      expect(assessLicense(expression).status, expression).toBe("review");
    }
    expect(() => parseExpression("MIT AND (ISC OR)")).toThrow();
  });
  it("only applies reviews to the exact installed version and license", () => {
    const entry = { name: "example", location: "node_modules/example", version: "1.0.0", license: "LicenseRef-Custom" };
    const review = { ...entry, status: "pass", reason: "Reviewed upstream grant", source: "https://example.org/license", reviewedBy: "Maintainer", reviewedAt: "2026-10-18" };
    validateReviews([review]);
    expect(applyReview(entry, assessLicense(entry.license), [review]).status).toBe("pass");
    expect(applyReview({ ...entry, version: "2.0.0" }, assessLicense("MIT"), [review]).status).toBe("review");
    expect(applyReview({ ...entry, license: "MIT" }, assessLicense("MIT"), [review]).status).toBe("review");
    expect(() => validateReviews([{ ...review, reason: "" }])).toThrow();
    expect(() => validateReviews([review, review])).toThrow();
  });
});

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "miroven-licenses-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts/bundled-licenses.json"), "[]");
  await writeFile(path.join(root, "package.json"), JSON.stringify({ license: "AGPL-3.0-only", dependencies: { example: "1.0.0" } }));
  const packages = { "": { dependencies: { example: "1.0.0" } }, "node_modules/example": { version: "1.0.0", license: "MIT" }, "node_modules/other-platform": { version: "2.0.0", license: "GPL-2.0-only", optional: true } };
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify({ packages }));
  await mkdir(path.join(root, "node_modules/example"), { recursive: true });
  await writeFile(path.join(root, "node_modules/example/package.json"), JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }));
  await writeFile(path.join(root, "node_modules/example/LICENSE"), "Example copyright and license");
  return root;
}
describe("license collection and findings", () => {
  it("checks absent platform packages using lock metadata without claiming to read their notices", async () => {
    const entries = await collectLicenses(await fixture());
    const other = checkEntries(entries).find((entry: { name: string }) => entry.name === "other-platform");
    expect(other).toMatchObject({ installed: false, status: "incompatible", evidence: [] });
  });
  it("fails the inspection on missing required packages and installed version mismatch", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "node_modules/example/package.json"), JSON.stringify({ name: "example", version: "9.0.0" }));
    await expect(collectLicenses(root)).rejects.toThrow("Version mismatch");
    await rm(path.join(root, "node_modules/example/package.json"));
    await expect(collectLicenses(root)).rejects.toThrow("Missing dependency");
  });
  it("keeps conflicting installed metadata visible", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "node_modules/example/package.json"), JSON.stringify({ name: "example", version: "1.0.0", license: "ISC" }));
    expect(checkEntries(await collectLicenses(root)).find((entry: { name: string }) => entry.name === "example")).toMatchObject({ status: "review" });
  });
  it("warns when the reviewed bundled parent version changes", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/bundled-licenses.json"), JSON.stringify([{ name: "codec", version: "1", parent: "example", parentVersion: "0.9.0", license: "MIT", noticeFile: "LICENSE" }]));
    const entry = checkEntries(await collectLicenses(root)).find((entry: { name: string }) => entry.name === "codec");
    expect(entry).toMatchObject({ status: "review", scope: "bundled" });
    expect(entry?.reason).toContain("버전이 변경");
  });
  it("inspects Next's embedded notices separately from its top-level license", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "node_modules/example/package.json"), JSON.stringify({ name: "next", version: "1.0.0", license: "MIT" }));
    const directory = path.join(root, "node_modules/example/dist/compiled/embedded");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "LICENSE"), "An embedded license");
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "embedded", license: "GPL-2.0-only" }));
    const findings = checkEntries(await collectLicenses(root));
    expect(findings.find((entry: { name: string }) => entry.name === "next/embedded")).toMatchObject({ status: "incompatible", scope: "bundled" });
  });
  it("returns zero for warnings and replaces stale reports on inspection failure", async () => {
    const root = await fixture();
    for (const file of ["check-licenses.mjs", "collect-licenses.mjs", "license-policy.mjs"]) {
      await copyFile(new URL(`../scripts/${file}`, import.meta.url), path.join(root, "scripts", file));
    }
    await writeFile(path.join(root, "scripts/license-reviews.json"), "[]");
    const run = () => spawnSync(process.execPath, [path.join(root, "scripts/check-licenses.mjs")], { encoding: "utf8", windowsHide: true });
    expect(run().status).toBe(0);
    const output = path.join(root, "license-reports/report.json");
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ completed: true, summary: { incompatible: 1 } });
    await rm(path.join(root, "node_modules/example/package.json"));
    expect(run().status).toBe(1);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({ completed: false });
  });
});
