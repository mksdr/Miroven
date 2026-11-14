import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { assessLicense, parseExpression, applyReview, validateReviews } from "../scripts/license-policy.mjs";
import { collectLicenses } from "../scripts/collect-licenses.mjs";
import { checkEntries } from "../scripts/check-licenses.mjs";
import { sha256, validateLicenseDeclaration } from "../scripts/optional-license-evidence.mjs";
import { verifyIntegrity } from "../scripts/archive-optional-licenses.mjs";
import { createHash } from "node:crypto";

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
  it("validates the schema of committed manual review records", async () => {
    const reviews = JSON.parse(await readFile(new URL("../scripts/license-reviews.json", import.meta.url), "utf8"));
    expect(() => validateReviews(reviews)).not.toThrow();
  });
  it("keeps HEIC/runtime reviews visible and requires all other dependencies to pass", async () => {
    const reviews = JSON.parse(await readFile(new URL("../scripts/license-reviews.json", import.meta.url), "utf8"));
    const entries = await collectLicenses();
    const findings: {
      name: string;
      version: string;
      license: string | null;
      location: string;
      installed: boolean;
      status: string;
      reason: string;
    }[] = checkEntries(entries, reviews);
    const unresolved = findings
      .filter((finding) => finding.status !== "pass")
      .map(({ name, version, license, location, status, reason }) => ({ name, version, license, location, status, reason }));
    // These exact pending versions remain visible; upgrades or new warnings must fail.
    expect(unresolved.map(({ name, version, license, location, status }) => ({ name, version, license, location, status })), JSON.stringify(unresolved, null, 2)).toEqual([
      { name: "dlmalloc", version: "2.8.6 (Emscripten 4.0.10)", license: "LicenseRef-Public-Domain", location: "vendor/heic#dlmalloc", status: "review" },
      { name: "heic-to", version: "1.5.2", license: "LGPL-3.0", location: "node_modules/heic-to", status: "review" },
      { name: "libde265", version: "1.0.16", license: "LGPL-3.0-or-later", location: "node_modules/heic-to#libde265", status: "review" },
      { name: "libheif", version: "1.22.2", license: "LGPL-3.0-or-later", location: "node_modules/heic-to#libheif", status: "review" },
      { name: "llvm-runtime", version: "bundled (Emscripten 4.0.10)", license: "Apache-2.0 WITH LLVM-exception", location: "vendor/heic#llvm-runtime", status: "review" },
    ]);
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
  async function archiveFixture(license = "MIT") {
    const root = await fixture();
    const lockPath = path.join(root, "package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    const location = "node_modules/other-platform";
    const info = { ...lock.packages[location], license, resolved: "https://registry.npmjs.org/other-platform/-/other-platform-2.0.0.tgz", integrity: "sha512-test" };
    lock.packages[location] = info;
    await writeFile(lockPath, JSON.stringify(lock));
    const text = "Synthetic original license notice\n";
    const hash = sha256(text);
    const original = `scripts/optional-license-sources/${hash}.txt`;
    await mkdir(path.join(root, "scripts/optional-license-sources"));
    await writeFile(path.join(root, original), text);
    const record = { name: "other-platform", location, ...info, files: [{ file: "LICENSE", sha256: hash }] };
    const manifest = path.join(root, "scripts/optional-license-evidence.json");
    await writeFile(manifest, JSON.stringify([record]));
    return { root, manifest, record, original };
  }
  it("uses exact archived originals offline without pretending the package is installed", async () => {
    const { root, original, record } = await archiveFixture();
    expect(checkEntries(await collectLicenses(root)).find((entry: { name: string }) => entry.name === "other-platform")).toMatchObject({ installed: false, status: "pass", evidence: [original], source: record.resolved });
  });
  it("accepts the exact upstream license declaration and rejects conflicting fields", () => {
    const declaration = { name: "example", version: "1.0.0", license: "MIT" };
    expect(() => validateLicenseDeclaration(Buffer.from(JSON.stringify(declaration)), "example", declaration)).not.toThrow();
    for (const field of ["name", "version", "license"]) {
      expect(() => validateLicenseDeclaration(Buffer.from(JSON.stringify({ ...declaration, [field]: "changed" })), "example", declaration)).toThrow("declaration mismatch");
    }
  });
  it.each(["name", "version", "license", "resolved", "integrity"])("keeps absent originals unverified when archived %s changes", async (field) => {
    const { root, manifest, record } = await archiveFixture();
    await writeFile(manifest, JSON.stringify([{ ...record, [field]: "changed" }]));
    const finding = checkEntries(await collectLicenses(root)).find((entry: { name: string }) => entry.name === "other-platform");
    expect(finding).toMatchObject({ status: "review", installed: false, evidence: [] });
  });
  it("does not turn archived evidence into a compatibility exception", async () => {
    const { root } = await archiveFixture("GPL-2.0-only");
    expect(checkEntries(await collectLicenses(root)).find((entry: { name: string }) => entry.name === "other-platform")).toMatchObject({ status: "incompatible", installed: false });
  });
  it("does not let manual approval hide a missing archived original", async () => {
    const root = await fixture();
    const entries = await collectLicenses(root);
    const other = entries.find((entry: { name: string }) => entry.name === "other-platform");
    const review = { name: other.name, location: other.location, version: other.version, license: other.license, status: "pass", reason: "Synthetic approval", source: "https://example.org/license", reviewedBy: "test", reviewedAt: "2026-11-14" };
    expect(checkEntries(entries, [review]).find((entry: { name: string }) => entry.name === "other-platform")).toMatchObject({ status: "review", evidence: [] });
  });
  it("checks installed metadata rather than replacing it with archived evidence", async () => {
    const { root } = await archiveFixture();
    const directory = path.join(root, "node_modules/other-platform");
    await mkdir(directory);
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "other-platform", version: "2.0.0", license: "ISC" }));
    expect(checkEntries(await collectLicenses(root)).find((entry: { name: string }) => entry.name === "other-platform")).toMatchObject({ status: "review", installed: true, evidence: [] });
  });
  it("fails on corrupt or missing archived originals", async () => {
    const { root, original } = await archiveFixture();
    await writeFile(path.join(root, original), "altered notice");
    await expect(collectLicenses(root)).rejects.toThrow("Invalid optional license original");
    await rm(path.join(root, original));
    await expect(collectLicenses(root)).rejects.toThrow("ENOENT");
  });
  it("rejects downloaded archives that do not match the locked SHA-512", () => {
    const data = Buffer.from("synthetic archive");
    const integrity = `sha512-${createHash("sha512").update(data).digest("base64")}`;
    expect(() => verifyIntegrity(data, integrity)).not.toThrow();
    expect(() => verifyIntegrity(Buffer.from("tampered"), integrity)).toThrow("integrity mismatch");
    expect(() => verifyIntegrity(data, "")).toThrow("integrity mismatch");
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
  it("does not let a manual pass hide a changed compiled codec header", async () => {
    const root = await fixture();
    await writeFile(path.join(root, "scripts/bundled-licenses.json"), JSON.stringify([{ name: "codec", version: "1", parent: "example", parentVersion: "1.0.0", license: "MIT", noticeFile: "LICENSE", markerFile: "codec.js", marker: "codec version 1" }]));
    await writeFile(path.join(root, "node_modules/example/codec.js"), "codec version 2");
    const review = { name: "codec", version: "1", location: "node_modules/example#codec", license: "MIT", status: "pass", reason: "old review", source: "https://example.org", reviewedBy: "test", reviewedAt: "2026-11-03" };
    expect(checkEntries(await collectLicenses(root), [review]).find((entry: { name: string }) => entry.name === "codec")).toMatchObject({ status: "review" });
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
    for (const file of ["check-licenses.mjs", "collect-licenses.mjs", "license-policy.mjs", "check-heic.mjs", "optional-license-evidence.mjs"]) {
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


describe("HEIC LGPL review evidence", () => {
  it("keeps unresolved distribution obligations visible and pins bundled evidence", async () => {
    const root = new URL("../", import.meta.url);
    const reviews = JSON.parse(await readFile(new URL("scripts/license-reviews.json", root), "utf8"));
    const bundled = JSON.parse(await readFile(new URL("scripts/bundled-licenses.json", root), "utf8"));
    const notices = JSON.parse(await readFile(new URL("app/notice/notices.json", root), "utf8"));
    const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
    expect(lock.packages["node_modules/heic-to"].version).toBe("1.5.2");
    for (const [name, version] of [["heic-to", "1.5.2"], ["libheif", "1.22.2"], ["libde265", "1.0.16"]]) {
      const review = reviews.find((item: { name: string }) => item.name === name);
      expect(review).toMatchObject({ version, status: "review" });
      const notice = notices.find((item: { name: string }) => item.name === name);
      expect(notice.version).toBe(version);
      expect(notice.files.some((file: { text: string }) => file.text.includes("GNU LESSER GENERAL PUBLIC LICENSE"))).toBe(true);
      if (name !== "heic-to") {
        expect(bundled.find((item: { name: string }) => item.name === name)).toMatchObject({ version, parentVersion: "1.5.2" });
        for (const kind of ["COPYRIGHT", "COPYING"]) {
          const text = (await readFile(new URL(`scripts/notice-sources/${name}-${kind}.txt`, root), "utf8")).trim();
          expect(notice.files.find((file: { file: string }) => file.file === `${name}/${kind}`).text).toBe(text);
        }
        expect(notice.files.some((file: { text: string }) => file.text.includes("GNU GENERAL PUBLIC LICENSE"))).toBe(true);
      }
    }
  });
});
