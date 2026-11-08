# HEIC native build and source delivery / HEIC 네이티브 빌드와 소스 제공

## Current implementation / 현재 구현

This change is submitted independently on main c5c1f36. It includes only the
three HEIC `review` records, not the 46 manual records or schema test from the
older license-review branch. Main's existing offline/update/performance settings
are preserved. On this independent base: license inspection reports 490 pass /
104 review / zero incompatible; targeted tests pass 16; fast verification passes
350 tests in 46 files; build, 10 rendered HTML tests and CSP/SW/bundle checks pass.
Earlier native/source/relink measurements below retain their original context;
source archives, native recipe and vendor outputs are unchanged. See the separate
independent-PR section in `docs/heic-validation.json`.

Miroven now loads its **locally vendored CSP module**, built from the three fixed
upstream source archives in `web/vendor/heic/sources/`. It no longer loads npm's
precompiled HEIC binary. `web/vendor/heic/manifest.json` records the original
versions/commits, archive hashes, recipe/patch hashes, generated module hashes and
compiler-runtime notices. This is a modified Miroven build, not an assertion that
upstream published this binary.

The Linux amd64 builder pins Node 24.22.1 by image digest, Emscripten SDK 4.0.10 by
commit and release, and Debian ordinary/security/updates repositories by date.
A small, dated libheif patch boxes a raw image pointer explicitly: this SDK lacks
the three-argument `val.set` overload requested by libheif 1.22.2. The recipe
replaces the generated CommonJS/AMD adapter with an ES-module default export.
Native compile/link execution has no network access and deletes upstream's
precompiled JS inputs first. Both JS variants share rebuilt static archives.

See `tools/heic/README.md` for original rebuild, hash comparison, published-source
rebuild and native modification/relinking commands. The probe changes both native
version functions and reads their return values in the real browser Worker before
decoding HEIC/HEIF. It runs in a separate tree; ordinary builds reject probe output.
All source, modifications, integrity checks and replacement steps are available;
no proprietary relinker or signing key is required.

Ordinary builds validate vendor evidence before Next.js, then package actual
application input files plus library archives, patch, scripts and public build
settings into `out/source/miroven-source.tar.gz`. `/notice` links this download,
its SHA-256 and manifest. Packaging works without Git metadata, including Docker
build contexts. The reviewed file-level list in `web/scripts/source-files.json`
ships in the archive. Ordinary builds check it before Next.js and packaging
checks it again: unlisted local files inside source roots and missing approved
files fail the build. `npm run sources:update` is an explicit maintainer step
using Git-tracked paths; builds never approve new paths automatically. Approved
files still contain their actual local modifications. Environment files, private
local directories, dependencies and build outputs are excluded; symlinks or
secret-named files inside included source roots fail packaging. This path list
does not certify the absence of secrets inside approved files. See the bilingual
approval workflow in `tools/heic/README.md`. Hash-bearing source/output files
have LF checkout rules.
Compiler-generated runtime notices are now supplied too, without replacing the
existing GPL/LGPL notices. Review results for unknown exceptions remain visible.

### Limits / 한계

These changes provide technical evidence for the §4(d)(0) route. They do not
establish §4(d)(1) shared-library replacement; the codec is still embedded in a
Worker string. Compatibility and distribution compliance remain separate findings.
Keep the three manual reviews at **review**, pending maintainer/legal assessment of
§4 notices/terms, source completeness (including treatment of compiler/runtime
sources and application dependencies), any installation-information requirement,
and actual hosting/retention. Generic tools are identified and pinned; full SDK
sources are linked rather than bundled as application/library source.

Keep source downloads accessible alongside their corresponding object files,
including older files retained by a CDN or release host. This repository does not
control production retention, additional hosting terms or atomic deployments.
A successful local build does not prove these external conditions. CI artifacts
expire and are not the source-delivery channel.

한국어: 고정된 C/C++ 소스와 공개 패치에서 코덱을 생성해 실제 앱에 사용하고,
일반 빌드가 소스·레시피·출력 무결성을 검사합니다. 배포물에는 애플리케이션 입력,
라이브러리 원본·패치·재빌드 자료와 공개 설정을 묶어 `/notice`에서 제공합니다.
`web/scripts/source-files.json`에 승인된 파일 경로를 관리하고 소스에 동봉합니다.
일반 빌드는 Next.js 실행 전과 패키징 시에 소스 디렉터리의 미등록 파일과 승인 파일의
누락을 차단합니다. `npm run sources:update`로 Git 추적 경로에서 후보를 명시적으로
갱신·검토하며, 빌드가 자동 승인하지 않습니다. 승인 파일의 실제 수정 내용은 보존하지만
내용의 비밀정보 부재까지 인증하지는 않습니다. Docker·다운로드 재빌드에는 Git이 필요하지
않습니다. 승인 절차는 `tools/heic/README.md`의 영·한 안내를 따릅니다.
네이티브 두 라이브러리를 수정하는 재결합 시험도 별도 복사본에서 수행합니다.
이는 제4조(d)(0)에 관한 기술적 근거이며 법률적 준수 판정은 아닙니다. 실제 호스팅의
소스 접근·보존, 배포 조건과 소스 범위 등은 별도 확인이 필요해 `review`를 유지합니다.

### Validation evidence / 검증 근거

Recorded output hashes and tool versions are committed with the vendor module.
`docs/heic-validation.json` records the measured results and limits. Fresh native
and wrapper output comparison passed; source-only application/native rebuilding
and source repackaging hash equality passed; both modified native version functions
were observed by the real browser Worker and both HEIC/HEIF cases passed. Original
vendor browser cases also passed (2/2). The original worktree fast verification passed 331 tests
in 43 files, targeted evidence tests passed 17, rendered HTML passed 10, and
CSP/Service Worker/bundle checks passed. Original license inspection returned 511 pass,
83 review and zero incompatible findings; zero exit status is not compliance approval.
Final documentation, author-notice and regression-test-only edits are repackaged
with the same native inputs, recipe and vendor outputs after that experiment.
Local `verify:full` is not run for this implementation, at the user's request;
GitHub's existing full-verification job is unchanged. The separate HEIC job adds
original/source/relink checks and uploads evidence, without release-write access.

The official SDK image could not be installed within this environment's storage
limit. A smaller builder with the same fixed SDK was successfully built. Starting
its full writable container also exceeded the vfs filesystem limit. Local native
execution therefore uses the documented read-only exported-rootfs backend with
the exact SDK/tool files and network disabled. The standard image runtime backend
must be verified in GitHub CI; local rootfs results must not be described as that
backend having passed. An initial SDK/API error and a read-only cache initialization
error were fixed rather than suppressed. Local Wiki edits are supplied separately
in `docs/wiki-heic-delivery.patch` (and committed locally in `Miroven.wiki` prior to push). On 2026-11-05, `tools/heic/build.sh` pinned `EMCC_CORES=1 BINARYEN_CORES=1` to eliminate host-CPU-count chunk splitting in Emscripten's `wasm2js` JS optimizer, regenerated `web/vendor/heic/*`, and verified `heic:verify`, `heic:verify:source`, and `heic:verify:relink` end-to-end on the standard Docker `linux/amd64` container runtime.

<details>
<summary>Historical baseline investigation before the native delivery pipeline</summary>

# Historical baseline review

# HEIC LGPL distribution review / HEIC LGPL 배포 검토

Review date: 2026-11-03. Technical evidence, not a legal opinion or compliance certification.

## Scope and decision / 범위 및 판단

Inspected main c5c1f36 and PR #30 head d73edfb666c4a211270f033e0a3672e4378fd3c3 (local `pr-30`, initially clean).
GitHub API reports open, not merged.
PR adds manual license reviews and schema coverage; it does not supply codec source
or a relinking workflow. Keep heic-to, libheif and libde265 at **review**.
AGPL compatibility is not proof of LGPL distribution compliance.

Sources inspected (tag → resolved commit):

| Component | Tag | Commit |
| --- | --- | --- |
| heic-to | v1.5.2 | f37af866f9aa6212ddc84b67a279c9f2386aba4f |
| libheif | v1.22.2 | 763bc8bb87788d64d39ece623ceed988de12dc5b |
| libde265 | v1.0.16 | 7ba65889d3d6d8a0d99b5360b028243ba843be3a |

Repositories: https://github.com/hoppergee/heic-to ,
https://github.com/strukturag/libheif , https://github.com/strukturag/libde265 .
The npm lock pins heic-to 1.5.2 and its integrity. Version headers are upstream
assertions, not independently established provenance of every compiled instruction.

## Terms / 적용 조건

Official references requested:
https://www.gnu.org/licenses/lgpl-3.0.en.html ,
https://www.gnu.org/licenses/gpl-3.0.en.html ,
https://www.gnu.org/licenses/license-compatibility.html .
All returned HTTP 503 in this environment (plain text GPL/LGPL endpoints also
failed). Do not represent the compatibility page as successfully retrieved.
Reviewed the LGPL text in heic-to/LICENSE and LGPL plus GPL texts in the two
upstream COPYING files instead. The libheif and libde265 public C headers grant
LGPL version 3 or later. heic-to metadata says LGPL-3.0, with version 3 LICENSE;
no later-version grant was established. Use LGPLv3 for this review.

LGPLv3 incorporates GPLv3. GPLv3 §13 and AGPLv3 §13 permit combination while
retaining the applicable terms for the respective parts; LGPLv3 §2(b) addresses
conveying modified library versions under GPLv3. This does not itself discharge
§4 obligations. No special linking exception for this delivered combination was
established. Upstream COPYING also describes MIT sample/wrapper portions; that
is not an exception for the LGPL C/C++ libraries. Additional codecs/build flags
must be inventoried if enabled; codec patents are not resolved by this review.

For a Combined Work, §4 requires terms allowing modification of library portions
and reverse engineering for debugging those modifications, prominent library/use
notices (§4(a)), GPL and LGPL copies (§4(b)), and notices if execution displays
copyright notices (§4(c)). Assess these for the actual distribution and any added
terms. Miroven's AGPL source license permits modification, but deployment terms
were not independently inspected.

* §4(d)(0): convey Minimal Corresponding Source under this license and
  Corresponding Application Code in a form and on terms permitting recombination
  or relinking with a modified Linked Version, using GPL §6 source-conveyance means.
  This includes relevant build scripts, interface definitions and non-system
  dependencies; an npm compiled JS file is not preferred C/C++ source.
* §4(d)(1): a suitable shared-library mechanism must use a runtime copy already
  present on the user's system and work with interface-compatible modified versions.
  A separate Next chunk or dynamic import alone establishes neither condition.
* §4(e): Installation Information applies only where GPL §6 would require it,
  and only as needed for installing/running the recombined work. An ordinary web
  download has not been shown to be a transaction transferring a User Product;
  re-evaluate packaged/device distribution. No installation-key requirement was found.

GPL §6(d) can permit equivalent source access from another server with clear
adjacent directions and maintained availability. An upstream tag link alone is
not evidence of exact Corresponding Source, availability for the required period,
or an effective replacement workflow. Repository disclosure is useful application
source, not by itself the source offer for every deployed binary.

## Actual structure and notices / 배포 구조와 고지

`web/app/lib/image.ts` uses `heic-decoder.ts` as a fallback; the latter imports
`heic-to/csp`. heic-to/esbuild.mjs bundles src/worker.js and
src/lib/libheif-without-unsafe-eval.js, inserts the result as WORKER_FILE_CONTENT
in src/index.js. loadWorker creates a Blob URL and Worker from that string.
The generated codec is JS containing the compiled codec implementation (including
an emulated WebAssembly object); no separately replaceable native library was
established. Native libheif build script links static libde265 and libheif archives.

Production `npm run build` succeeded. `out/_next/static/chunks/19b0w6n3zofaf.js`
(2,995,295 bytes in this run) contains `HEIF image not found` and the bundled
Worker implementation. Chunk names are not stable identifiers. The browser does
not load a user-provided libheif/libde265 shared object in this path.

Existing committed notices.json includes heic-to LICENSE (8,177 chars), both
codec COPYRIGHT headers and COPYING texts (44,338 / 44,365 chars). Those COPYING
texts include GPL and LGPL. No duplicate license copies were added. The collector
reads matching notice-sources files and generate-notices preserves their contents.
The generated static notice page exists. The notice renderer does **not** render
bundled-licenses.json `source` URLs; earlier reviews incorrectly asserted source
attribution there. Names/headers identify libraries, but source access instructions
and exact build materials still need a verified distribution arrangement.

## Rebuild experiment / 재빌드 시험

Commands below describe an isolated scratch checkout, not production modifications.
Node v24.19.0. `npm ci` in Miroven/web and upstream heic-to succeeded.

1. Clone the three repositories, checkout the commits above.
2. In heic-to: `npm ci && npm run build`.
   Rebuilt dist/csp/heic-to.js and installed npm file both SHA-256:
   `c189220a7a1e87559758a48ab4700e55629fb23a4cb57489e1e8970be1b9d018`.
   This reproduces the JS wrapper using the upstream **precompiled** codec input.
3. Prepend `globalThis.__MIROVEN_LGPL_RELINK_PROBE__ = "2026-11-03";`
   to src/worker.js; `npm run build`. This harmless identifier is in LGPL wrapper
   source, not a modification/recompilation of libheif or libde265 C/C++ code.
4. Save Miroven's installed dist/csp/heic-to.js outside the repository, copy the
   modified dist file over it and run Miroven `npm run build`. The probe was found in
   `out/_next/static/chunks/1il2tqlai_a20.js`; modified Miroven build succeeded. Restore the original installed file and rebuild before distribution.
   `npm ci` overwrites this local substitution; never rely on it as a release step.
5. Attempt native build from a separate empty directory:
   `LIBDE265_VERSION=1.0.16 USE_WASM=0 USE_UNSAFE_EVAL=0 CORES=2 ../libheif/build-emscripten.sh ../libheif`.
   Download of libde265 release archive succeeded; failed at line 60:
   `emconfigure: command not found`. No Emscripten SDK was installed.

The full native chain is **not validated**. libheif's script defaults libde265 to
1.0.15, so 1.0.16 must be explicitly selected. It needs Emscripten (emconfigure,
emcmake, emmake, emcc and EMSDK llvm-nm), CMake, make and autotools as applicable.
The header does not pin the Emscripten SDK or establish all build flags/patches.
Do not infer exact native reproduction from the wrapper hash match. Browser HEIC/HEIF
decoding of the modified wrapper artifact passed (see verification log); this
does not validate a modified native codec.

## Required release work / 배포 전 추가 작업

1. Establish exact native sources, patches and toolchain used for both JS codec
   variants with upstream; pin SDK and all flags. Archive source, scripts and
   required non-system dependencies under their original licenses. Record checksums.
2. Rebuild unmodified libheif/libde265; make an identifiable harmless native change,
   rebuild the CSP codec, then heic-to and Miroven. Verify a real HEIC fixture in a
   browser and retained marker. Publish instructions and material sufficient for
   recipients to repeat this without private tooling. Wrapper-only success is insufficient.
3. Choose a GPL §6-compliant source delivery method for each static release,
   including corresponding application code. Host/retain exact source bundles or
   maintain equivalent accessible source with explicit directions next to binary
   access; add verified links to /notice and release delivery. Check deployment
   terms, §4 notices and any applicable installation information with legal review.
4. Only then reconsider `pass`, with release-specific evidence. Current changes
   reduce misleading assertions; they do not certify or complete LGPL compliance.

한국어 결론: 세 라이브러리는 AGPLv3와 호환 가능하나 현재 배포 의무 충족을 충분히
입증할 수 없습니다. 래퍼 재빌드와 고지는 확인했지만 네이티브 코덱 재빌드·수정·재결합,
정확한 소스/도구 제공 및 지속적 접근 보장이 남아 있습니다. `review`를 유지합니다.


The bundled inventory now checks the version header of the actual CSP codec input
(`libheif-without-unsafe-eval.js`) rather than only the unused non-CSP sibling.
Existing issue handling prevents a manual pass from masking version drift.

## Verification log / 검증 기록

* `npm run check:licenses`: exit 0, 509 pass / 0 incompatible / 81 review.
  Warnings are intentionally non-blocking; 81 includes platform-optional metadata
  issues as well as the three unresolved HEIC reviews. This is not a compliance pass.
* `npx vitest run tests/license-check.test.ts`: 13 tests passed after final edits.
* `npm run verify:fast`: lint, secret scan and 42 unit files / 327 tests passed.
* Original and probe `npm run build`: both succeeded. Original installed package
  restored (SHA-256 above); original final output contains no probe.
* `out/notice.html` contains all three library names and both GPL/LGPL headings.
* `npm run verify:full`: ran through unit tests, build, CSP, service worker,
  secret/bundle checks and rendered HTML tests; browser stage encountered missing
  Playwright executables. Full verification must not be reported as passing.

* Full browser stage finished: 120 failed (missing browser executables), 16 skipped
  (integration configuration absent). Chromium was subsequently installed.
* After installation, `npx playwright test tests/e2e/images.spec.ts --project chromium
  --grep 'real example'` passed both real HEIC and HEIF cases on the original build
  and again on the probe wrapper build (2/2 each). The probe was not a native-code
  modification. Firefox/WebKit and the entire browser suite were not rerun.
* Probe installed file was restored and the final production build rerun.

최종 병합 권고: 원래 PR의 세 `pass` 판정은 근거가 부족합니다. 이 보완은 미검증
사항을 드러내는 개선으로 검토할 수 있지만 LGPL 배포 의무 해결 완료로 병합하거나
배포 승인 근거로 사용하지 마세요. 위 배포 전 추가 작업을 완료한 뒤 재판정해야 합니다.

</details>
