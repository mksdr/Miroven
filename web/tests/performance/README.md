# Startup and typing baseline / 초기 실행·입력 기준 측정

This suite measures the **existing production static export**, without changing product behavior or exposing a benchmark route. It is opt-in and separate from ordinary functional tests. Run from `web/`:

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run perf
# Reuse an already completed, local-only build:
npm run perf:built
# Harness smoke check only; not a publishable baseline:
MIROVEN_PERF_RUNS=1 npm run perf:built
```

Requires OpenSSL and free ports 3101/3102. The disposable HTTPS certificate lives under ignored `.local/performance-tls/`. Certificate errors are ignored **only in this test browser**. The origin `https://127.0.0.2:3101` intentionally avoids the application's localhost Service Worker opt-out. No production endpoint or existing browser profile is used. API configuration must be unset when building; do not point this suite at an external deployment.

## Method

- Pixel 5 emulation, Korean locale, Chromium, CPU slowdown 4x, 1.6 Mbps download / 0.75 Mbps upload / 150 ms latency. Emulation is a comparison tool, not a physical-device result. Keep host load stable; do not run builds or other browser suites concurrently.
- Three scenarios: cold first visit with empty storage; warm return with 100 entries and a draft; warm return with 1,000 entries, 50 tiny PNG attachments, and a draft. Entries contain about 900 characters. Tiny images exercise attachment presence, **not realistic photo memory or decoding cost**.
- Each of the ten samples gets its own context. Return samples first load the app, finish Service Worker installation, navigate away to stop app effects, and seed synthetic encrypted records using the application's v3 encryptor. Fixture setup is outside the timed navigation. Return samples preserve HTTP/SW caches and IndexedDB, but start a new document with no in-memory plaintext cache.
- Readiness is navigation start to the first animation frame with an enabled composer. The suite also confirms the save button enables after typing. This metric does not include the time a person needs to type or the subsequent disk write. Draft restoration is measured separately, and return input waits for the draft to avoid deliberately racing restoration.
- Input latency runs from a trusted printable keydown timestamp to a double `requestAnimationFrame` following the textarea input event. It includes a paint opportunity and scheduling overhead: **it is not field INP or a pixel-level presentation measurement**. Two bursts use 35 ms spacing, separated by 510 ms to cross the 500 ms autosave debounce. The second burst samples the autosave boundary; it does not prove every key overlaps an active disk write.
- Long tasks and JS/CSS resource sizes are captured until the final input burst settles. The static test server does not compress assets; transferred bytes are not representative of a gzip/Brotli production host. Existing `check:bundle` measures uncompressed initial HTML-linked assets independently.
- The extra eleventh run per scenario records a Chromium CPU profile and is excluded from timing statistics. On returning contexts it also reloads offline and verifies the feed and restored draft remain usable. Profiler overhead must never be mixed into baseline samples.
- p50/p95 use nearest-rank percentiles. Input percentiles pool key samples across the ten runs. Navigation p95 with ten samples is effectively the maximum; retain individual values and repeat on the same host before interpreting small differences.

## Outputs and interpretation

Ignored `test-results/performance/` contains per-scenario `measurements.json`, separate `cpu-profile.json`, and aggregate `summary.json`. Profiles open in Chrome DevTools' Performance panel. JSON contains timings, asset URLs and environment metadata, never keys or journal text. Playwright traces/screenshots/videos are disabled. Failure diagnostics may show synthetic fixture text.

Record the commit, working-tree changes, lockfile hash, Node/browser versions, build settings, host constraints, and failed/skipped checks alongside any published result. `perf:built` requires a fresh matching export; `perf` rebuilds it. Do not compare different commits using stale `out/` output. The suite intentionally has no arbitrary timing pass/fail threshold until the baseline and target are agreed. Independent offline failures are included in `summary.json`; the report command then exits nonzero even though all timing samples have been collected. A green Playwright timing test count does not mean the offline checks passed.

제품 코드 변경 전 기준 측정 단계입니다. `npm run perf`로 정적 빌드 후 각 시나리오를 10회 측정합니다. 결과와 별도 CPU 프로파일은 `test-results/performance/`에 저장하며, 이를 바탕으로 병목 1~2개와 합격 수치를 확정합니다. 저사양 모바일과 네트워크는 모의 환경이며 실제 iPhone/Safari 성능을 의미하지 않습니다. 오프라인 재방문은 별도 기능 검증입니다. 사진은 작은 합성 PNG이므로 실제 사진 처리 성능에 관한 결론을 내리지 않습니다.
