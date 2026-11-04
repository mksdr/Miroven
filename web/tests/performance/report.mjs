import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve("test-results/performance");
const percentile = (values, p) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.ceil(p * sorted.length) - 1] * 10) / 10 : null;
};
const summary = [];
for (const directory of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const file = path.join(root, directory.name, "measurements.json");
  let data;
  try { data = JSON.parse(readFileSync(file, "utf8")); } catch { continue; }
  const values = (get) => data.samples.map(get);
  const input = (phase) => data.samples.flatMap((sample) => sample.input.filter((input) => input.phase === phase).map((input) => input.latencyMs));
  summary.push({ scenario: data.scenario, environment: data.environment, offlineCheck: data.offlineCheck,
    readyMs: { p50: percentile(values((s) => s.readyMs), .5), p95: percentile(values((s) => s.readyMs), .95) },
    draftRestoredMs: data.scenario.count ? { p50: percentile(values((s) => s.draftRestoredMs), .5), p95: percentile(values((s) => s.draftRestoredMs), .95) } : null,
    initialInputMs: { p50: percentile(input("initial"), .5), p95: percentile(input("initial"), .95) },
    autosaveBoundaryInputMs: { p50: percentile(input("autosave-boundary"), .5), p95: percentile(input("autosave-boundary"), .95) },
    longTaskCountP50: percentile(values((s) => s.longTasks.length), .5),
    maxLongTaskMs: Math.max(...data.samples.flatMap((s) => s.longTasks.map((task) => task.durationMs))),
    jsCssTransferBytesP50: percentile(values((s) => s.assets.reduce((sum, asset) => sum + asset.transferBytes, 0)), .5),
  });
}
if (summary.length !== 3) throw new Error("Expected all three completed scenarios; partial results are not a baseline");
writeFileSync(path.join(root, "summary.json"), JSON.stringify(summary, null, 2));
console.table(summary.map((s) => ({ scenario: s.scenario.name, readyP50: s.readyMs.p50,
  readyP95: s.readyMs.p95, inputP95: s.initialInputMs.p95, autosaveInputP95: s.autosaveBoundaryInputMs.p95,
  transferKiB: Math.round(s.jsCssTransferBytesP50 / 1024) })));

if (summary.some((s) => s.offlineCheck.status === "failed")) {
  console.error("Baseline collected; offline functional checks FAILED. See summary.json.");
  process.exitCode = 1;
}
