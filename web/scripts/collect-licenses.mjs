import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const webRoot = fileURLToPath(new URL("../", import.meta.url));
export const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));
const noticePattern = /^(licen[sc]e|copying|notice|copyright)([.-]|$)/i;
export async function licenseFiles(directory, recursive = false) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isFile() && noticePattern.test(entry.name)) results.push({ file: entry.name, text: (await readFile(filename, "utf8")).trim() });
    else if (entry.isDirectory() && recursive && entry.name !== "node_modules") {
      for (const notice of await licenseFiles(filename, true)) results.push({ ...notice, file: `${entry.name}/${notice.file}` });
    }
  }
  return results.sort((a, b) => a.file.localeCompare(b.file, "en"));
}
async function optionalJson(filename) {
  try { return await readJson(filename); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function dependencyPaths(packages) {
  const paths = new Map([["", []]]);
  const queue = [""];
  for (let index = 0; index < queue.length; index++) {
    const location = queue[index];
    const info = packages[location];
    const dependencies = { ...info.dependencies, ...info.optionalDependencies, ...info.peerDependencies, ...(location === "" ? info.devDependencies : {}) };
    for (const name of Object.keys(dependencies)) {
      let base = location;
      let target;
      while (base && base !== ".") {
        const candidate = `${base}/node_modules/${name}`;
        if (packages[candidate]) { target = candidate; break; }
        base = path.posix.dirname(base);
      }
      target ??= packages[`node_modules/${name}`] ? `node_modules/${name}` : null;
      if (target && !paths.has(target)) {
        paths.set(target, [...paths.get(location), `${name}@${packages[target].version}`]);
        queue.push(target);
      }
    }
  }
  return paths;
}

export async function collectLicenses(root = webRoot) {
  const lock = await readJson(path.join(root, "package-lock.json"));
  const pkg = await readJson(path.join(root, "package.json"));
  if (!lock.packages?.[""]) throw new Error("Unsupported or missing lockfile package inventory");
  for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
    if (JSON.stringify(Object.entries(pkg[kind] ?? {}).sort()) !== JSON.stringify(Object.entries(lock.packages[""][kind] ?? {}).sort())) throw new Error(`package.json and lockfile differ: ${kind}. Run npm install / npm ci.`);
  }
  const entries = [];
  const paths = dependencyPaths(lock.packages);
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location) continue;
    const directory = path.join(root, location);
    const installed = await optionalJson(path.join(directory, "package.json"));
    if (!installed && !info.optional) throw new Error(`Missing dependency: ${location}. Run npm ci.`);
    if (installed && installed.version !== info.version) throw new Error(`Version mismatch: ${location}`);
    const name = installed?.name ?? location.split("node_modules/").at(-1);
    const files = installed ? await licenseFiles(directory) : [];
    const bundledNotices = [];
    for (const subdirectory of !installed ? [] : name === "next" ? ["dist/compiled"] : name === "@jsquash/webp" ? ["codec"] : []) {
      for (const notice of await licenseFiles(path.join(directory, subdirectory), true)) bundledNotices.push({ ...notice, file: `${subdirectory}/${notice.file}` });
    }
    const author = typeof installed?.author === "string" ? installed.author : installed?.author?.name ?? "";
    const issues = [];
    if (!installed) issues.push("현재 플랫폼에 설치되지 않은 선택적 의존성으로 원문을 확인하지 못했습니다.");
    if (installed?.license && info.license && installed.license !== info.license) issues.push("설치된 패키지와 잠금 파일의 라이선스 표기가 다릅니다.");
    const dependencyPath = paths.get(location) ?? [location];
    entries.push({ name, version: info.version, license: installed?.license ?? info.license ?? "", author, development: !!info.dev, scope: info.dev ? "development" : "runtime", location, dependencyPath, installed: !!installed, files, bundledNotices, issues });
    // Bundled notices are independent findings, not covered by Next's MIT license.
    for (const notice of bundledNotices.filter(() => name === "next")) {
      const bundledDirectory = path.posix.dirname(notice.file);
      const metadata = await optionalJson(path.join(directory, bundledDirectory, "package.json"));
      entries.push({ name: `${name}/${metadata?.name ?? bundledDirectory.replace("dist/compiled/", "")}`, version: `${metadata?.version ?? "bundled"} (next@${info.version})`, license: metadata?.license ?? "", author: "", development: !!info.dev, scope: info.dev ? "development" : "bundled", location: `${location}/${notice.file}`, dependencyPath: [...dependencyPath, bundledDirectory], installed: true, files: [notice], bundledNotices: [], issues: [] });
    }
  }
  const bundled = await readJson(path.join(root, "scripts/bundled-licenses.json"));
  for (const item of bundled) {
    const parents = entries.filter((entry) => entry.name === item.parent && entry.installed);
    if (!parents.length) throw new Error(`Bundled license parent missing: ${item.parent}`);
    for (const parent of parents) {
      const issues = [];
      if (parent.version !== item.parentVersion) issues.push(`내장 코드 검토 기준 ${item.parent}@${item.parentVersion}에서 버전이 변경되었습니다.`);
      if (item.markerFile) {
        const marker = (await readFile(path.join(root, parent.location, item.markerFile), "utf8")).slice(0, 500);
        if (!marker.includes(item.marker)) issues.push("내장 코덱의 버전 헤더가 검토 기록과 다릅니다.");
      }
      const files = item.noticeFile ? [{ file: item.noticeFile, text: (await readFile(path.join(root, parent.location, item.noticeFile), "utf8")).trim() }] : await Promise.all(["COPYRIGHT", "COPYING"].map(async (kind) => ({ file: `${item.name}/${kind}`, text: (await readFile(path.join(root, `scripts/notice-sources/${item.name}-${kind}.txt`), "utf8")).trim() })));
      entries.push({ name: item.name, version: item.version, license: item.license, author: item.author ?? "", development: parent.development, scope: "bundled", location: `${parent.location}#${item.name}`, dependencyPath: [...parent.dependencyPath, `${item.name}@${item.version}`], installed: true, files, bundledNotices: [], issues, source: item.source });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, "en") || a.location.localeCompare(b.location, "en"));
}
