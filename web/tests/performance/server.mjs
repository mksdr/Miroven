// HTTPS enables production Service Worker behavior without changing application code.
import { createServer } from "node:https";
import { request } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const directory = path.resolve(".local/performance-tls");
mkdirSync(directory, { recursive: true });
const key = path.join(directory, "key.pem");
const cert = path.join(directory, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
  "-subj", "/CN=127.0.0.2", "-keyout", key, "-out", cert], { stdio: "ignore" });
const child = spawn(process.execPath, ["scripts/serve-test.mjs"], {
  env: { ...process.env, PORT: "3102" }, stdio: ["ignore", "pipe", "inherit"],
});
let server;
child.stdout.on("data", (data) => {
  if (server || !data.toString().includes("Test server running")) return;
  server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
    const upstream = request({ hostname: "127.0.0.1", port: 3102,
      path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on("error", () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  server.listen(3101, "127.0.0.2", () => console.log("Performance HTTPS server ready"));
});
child.on("exit", (code) => { server?.close(); process.exit(code ?? 1); });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  server?.close(); child.kill(signal);
});
