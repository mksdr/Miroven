import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, cp, rm, mkdir, readdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { repositoryRoot as root, sha256, verifyHeic } from "./check-heic.mjs";
import { collectSource } from "./package-source.mjs";

const mode = process.argv[2];
if (!["rebuild", "verify", "relink"].includes(mode)) throw new Error("Usage: heic.mjs rebuild|verify|relink");
const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} exited ${result.status}`);
};
await verifyHeic(root, { outputs: mode !== "rebuild" });
const vendor = path.join(root, "web/vendor/heic");
const manifest = JSON.parse(await readFile(path.join(vendor, "manifest.json"), "utf8"));
const image = `miroven-heic-${sha256(Buffer.from(JSON.stringify({ builder: manifest.builder, recipe: manifest.recipe, components: manifest.components }))).slice(0, 16)}`;
const args = ["build", "--platform", manifest.builder.platform, "--build-arg", `NODE_IMAGE=${manifest.builder.nodeImage}`, "-f", "tools/heic/Dockerfile", "-t", image];
if (process.env.CODEX_PROXY_CERT) args.push("--secret", `id=proxy_ca,src=${process.env.CODEX_PROXY_CERT}`);
args.push(".");
if (!process.env.HEIC_BUILDER_ROOTFS) run("docker", args);
else console.log("Using an exported builder rootfs (low-storage execution backend).");
const temp = await mkdtemp(path.join(os.tmpdir(), "miroven-heic-"));
try {
  const output = path.join(temp, "codec");
  await mkdir(output);
  const work = path.join(temp, "native-work");
  await mkdir(work);
  const docker = ["run", "--rm", "--network=none", "--platform", manifest.builder.platform];
  const mount = (src, dst, readonly = false) => docker.push("--mount", `type=bind,src=${src},dst=${dst}${readonly ? ",readonly" : ""}`);
  const rootfs = process.env.HEIC_BUILDER_ROOTFS;
  if (rootfs) {
    const runtime = path.join(temp, "runtime");
    await mkdir(runtime);
    for (const name of ["usr", "etc", "emsdk", "opt", "recipe", "inputs", "output", "build", "dev", "proc", "tmp", "root"]) await mkdir(path.join(runtime, name));
    for (const [name, target] of [["bin", "usr/bin"], ["sbin", "usr/sbin"], ["lib", "usr/lib"], ["lib64", "usr/lib64"]]) await symlink(target, path.join(runtime, name));
    mount(runtime, "/runtime");
    for (const name of ["usr", "etc", "emsdk", "opt"]) mount(path.join(rootfs, name), `/runtime/${name}`, true);
    mount(path.join(root, "tools/heic"), "/runtime/recipe", true);
    mount(path.join(vendor, "sources"), "/runtime/inputs", true);
    mount(output, "/runtime/output"); mount(work, "/runtime/build");
    mount("/dev/null", "/runtime/dev/null"); mount("/dev/urandom", "/runtime/dev/urandom", true); mount("/proc", "/runtime/proc", true);
    docker.push("--entrypoint", "/usr/sbin/chroot", manifest.builder.nodeImage, "/runtime", "/usr/bin/env", "EMSDK=/emsdk", "PATH=/emsdk:/emsdk/upstream/emscripten:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", `OUTPUT_UID=${process.getuid?.() ?? 0}`, `OUTPUT_GID=${process.getgid?.() ?? 0}`, "bash", "/recipe/build.sh");
  } else {
    docker.push("-e", `OUTPUT_UID=${process.getuid?.() ?? 0}`, "-e", `OUTPUT_GID=${process.getgid?.() ?? 0}`);
    mount(path.join(root, "tools/heic"), "/recipe", true);
    mount(output, "/output"); mount(work, "/build");
    docker.push(image);
  }
  docker.push(mode === "relink" ? "probe" : "original");
  run("docker", docker);
  const generated = ["heic-to.js", "heic-to.d.ts", "native-sha256.txt", "toolchain.txt"];
  if (mode === "rebuild") {
    for (const name of generated) {
      const data = await readFile(path.join(output, name));
      await writeFile(path.join(vendor, name), data);
      manifest.outputs[name] = sha256(data);
    }
    await writeFile(path.join(vendor, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    await verifyHeic();
  } else if (mode === "verify") {
    for (const name of generated) {
      if (sha256(await readFile(path.join(output, name))) !== manifest.outputs[name]) throw new Error(`Rebuild differs: ${name}`);
    }
    console.log("Native libraries and wrapper match the committed outputs.");
  } else {
    const app = path.join(temp, "application");
    await mkdir(app);
    for (const [name, file] of await collectSource(root)) {
      await mkdir(path.dirname(path.join(app, name)), { recursive: true });
      await writeFile(path.join(app, name), file.data, { mode: file.mode });
    }
    // No writes to the real checkout or its node_modules; no probe bypass in npm build.
    await cp(path.join(root, "web/node_modules"), path.join(app, "web/node_modules"), { recursive: true });
    await cp(path.join(output, "heic-to.js"), path.join(app, "web/vendor/heic/heic-to.js"));
    const cwd = path.join(app, "web");
    run(process.execPath, ["node_modules/next/dist/bin/next", "build"], { cwd });
    for (const script of ["finalize-csp.mjs", "finalize-sw.mjs"]) run(process.execPath, [`scripts/${script}`], { cwd });
    const chunks = path.join(cwd, "out/_next/static/chunks");
    let found = false;
    for (const name of await readdir(chunks)) {
      if (name.endsWith(".js") && (await readFile(path.join(chunks, name), "utf8")).includes("MIROVEN_NATIVE_PROBE")) found = true;
    }
    if (!found) throw new Error("Native probe worker missing from final application");
    run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "tests/e2e/images.spec.ts", "--project=chromium", "--grep", "real example"], { cwd, env: { ...process.env, MIROVEN_HEIC_PROBE: "1" } });
    console.log("Both modified native libraries decoded real HEIC/HEIF in the application.");
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
