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
  it("validates the schema of committed manual review records", async () => {
    const reviews = JSON.parse(await readFile(new URL("../scripts/license-reviews.json", import.meta.url), "utf8"));
    expect(() => validateReviews(reviews)).not.toThrow();
  });
  it("keeps HEIC and pending compiler runtime reviews visible and requires other installed dependencies to pass", async () => {
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
      .filter((finding) => finding.installed && finding.status !== "pass")
      .map(({ name, version, license, location, status, reason }) => ({ name, version, license, location, status, reason }));
    // Only these exact HEIC and compiler runtime versions remain pending; upgrades or new warnings must fail.
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
    for (const file of ["check-licenses.mjs", "collect-licenses.mjs", "license-policy.mjs", "check-heic.mjs"]) {
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
    const evidence = await readFile(new URL("../docs/lgpl-heic-review.md", root), "utf8");
    expect(evidence).toContain("emconfigure: command not found");
    expect(evidence).toContain("c189220a7a1e87559758a48ab4700e55629fb23a4cb57489e1e8970be1b9d018");
  });
});
