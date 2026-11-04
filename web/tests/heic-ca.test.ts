import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
import os from "node:os";
import path from "node:path";
import { prepareCaBundle } from "../../tools/heic/prepare-ca.mjs";

const directories: string[] = [];
async function temporary() {
  const root = await mkdtemp(path.join(os.tmpdir(), "heic-ca-"));
  directories.push(root);
  return root;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("HEIC builder CA bootstrap", () => {
  it("provides readable embedded public roots without an OS CA file or proxy secret", async () => {
    const root = await temporary();
    const output = path.join(root, "ca.pem");
    await prepareCaBundle(output, path.join(root, "absent-secret.pem"));
    const bundle = await readFile(output, "utf8");
    const certificates = bundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
    expect(certificates.length).toBe(rootCertificates.length);
    expect(certificates.length).toBeGreaterThan(100);
    for (const certificate of certificates) expect(() => new X509Certificate(certificate)).not.toThrow();
    if (process.platform !== "win32") expect((await stat(output)).mode & 0o777).toBe(0o644);
  });
  it("adds the optional proxy CA while retaining every public root", async () => {
    const root = await temporary();
    const extra = path.join(root, "proxy.pem");
    const output = path.join(root, "ca.pem");
    const certificate = rootCertificates[0] + "\n";
    await writeFile(extra, certificate);
    await prepareCaBundle(output, extra);
    const bundle = await readFile(output, "utf8");
    expect(bundle).toBe(rootCertificates.join("\n") + "\n" + certificate);
    expect((bundle.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length).toBe(rootCertificates.length + 1);
  });
});
