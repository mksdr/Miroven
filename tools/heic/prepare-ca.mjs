import { chmod, readFile, writeFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";

// node:bookworm-slim has Node's embedded roots before ca-certificates is installed.
// Extend these roots for an optional HTTPS inspection proxy; never disable TLS.
export async function prepareCaBundle(destination, proxyCa) {
  let extra = "";
  if (proxyCa) {
    try { extra = await readFile(proxyCa, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await writeFile(destination, `${rootCertificates.join("\n")}\n${extra}`, { mode: 0o644 });
  await chmod(destination, 0o644);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error("Usage: prepare-ca.mjs OUTPUT [PROXY_CA]");
  await prepareCaBundle(process.argv[2], process.argv[3]);
}
