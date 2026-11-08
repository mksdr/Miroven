# Rebuilding the HEIC libraries / HEIC 라이브러리 재빌드

The manifest in `web/vendor/heic/manifest.json` pins the sources, builder images,
recipe and generated CSP module. This is a Miroven build of the upstream libraries,
not the upstream npm binary. Original licenses remain applicable.

From `web/` with Node, Python 3, Docker and Linux amd64 containers available:

```
npm ci
npm run heic:rebuild
npm run heic:verify
npm run heic:verify:relink
```

Rebuild intentionally updates vendor outputs and their recorded hashes. Verify
uses a temporary output and never updates the baseline. Relink uses temporary
native source modifications and a separate application tree, builds it and runs
the Chromium real HEIC/HEIF tests. Install Chromium with `npx playwright install
--with-deps chromium` before the browser test. Do not ship probe output.

Native compilation runs without network access. Builder creation downloads
locked npm build tools; Docker fetches digest-pinned images. Generic SDK/tool
sources: https://github.com/emscripten-core/emsdk/tree/4.0.10 and
https://github.com/emscripten-core/emscripten/tree/4.0.10 . Node sources:
https://nodejs.org/download/release/v24.22.1/ . These are general-purpose tools,
not substitutes for the library sources included here. No private key is needed.

For an HTTPS inspection proxy, preserve normal proxy settings. The optional
`CODEX_PROXY_CERT` environment variable supplies a public CA to the npm install
through a BuildKit secret; it is not copied into the image or source bundle.

The source download on `/notice` includes application inputs, library archives,
this recipe, patches (if any), lockfiles and public build settings. Extract the
application archive, run `cd web && npm ci && npm run build` for the supplied
vendor build; the commands above regenerate or replace it from native source.
Do not substitute another release's libraries without updating its manifest,
notices, output hashes and the matching source distribution.

한국어: 일반 앱 빌드는 Docker 없이 보관된 코덱을 검증해 사용합니다. 위 전용 명령은
고정된 소스에서 C/C++ 라이브러리와 래퍼를 다시 생성합니다. verify는 결과를 덮어쓰지
않으며 relink는 임시 복사본에서 두 네이티브 라이브러리를 수정하여 시험합니다.
소스 다운로드를 배포물과 함께 보존하고 실제 호스팅에서도 접근 가능한지 확인하세요.
재빌드 성공은 LGPL의 모든 법적 의무 충족 판정이 아닙니다.

## Approving source files / 소스 파일 승인

`web/scripts/source-files.json` lists every approved distribution input. Before
Next.js runs, `npm run sources:check` fails on unlisted files inside the source
roots, missing approved inputs, forbidden names or symlinks. The packager checks
again before writing the archive. Private/generated roots remain excluded.

When adding, removing or renaming source files, stage only the intended public
paths with `git add -- <paths>`, then run `npm run sources:update` from `web/`.
Review the resulting file-list diff before distributing. The update command uses
Git-tracked paths, never untracked or ignored files. Builds do not regenerate the
list. Move private files outside source roots; do not approve them to pass a build.

The list is included in the source archive, so Docker contexts and extracted
downloads need no `.git` directory. Approved files retain their actual current
contents, including local edits; the list is a path approval, not a clean-commit
or secret-content certification. Rebuilding after adding a file to an extracted
download requires explicitly reviewing and editing its list, or using a Git
checkout and the update command.

한국어: `web/scripts/source-files.json`으로 배포할 파일 경로를 명시적으로 관리합니다.
`npm run sources:check`는 Next.js 실행 전에 소스 디렉터리의 미등록 파일·누락된 승인
파일·금지된 이름·심볼릭 링크를 차단하며 패키징 시에도 다시 검사합니다. 파일 추가·삭제·
이름 변경 시 공개할 경로만 `git add -- <경로>`로 stage한 뒤 `web/`에서
`npm run sources:update`를 실행하고 목록 차이를 검토하세요. 미추적·무시된 파일은
갱신 후보에 포함하지 않으며 일반 빌드는 목록을 자동 갱신하지 않습니다. 개인 파일은
승인하여 빌드를 통과시키지 말고 소스 디렉터리 밖으로 옮기세요.
목록 자체를 소스 아카이브에 포함하므로 Docker·다운로드 재빌드는 Git 없이 동작합니다.
승인된 파일의 실제 수정 내용은 보존하지만 내용의 비밀정보 여부까지 인증하지는 않습니다.
다운로드한 소스에 새 파일을 추가하려면 목록을 명시적으로 검토·수정하거나 Git checkout에서
갱신 명령을 사용하세요.

## Small vfs Docker environments

Some `vfs` daemons duplicate the entire SDK image for each container. If that
exceeds local disk capacity, export the **same Dockerfile's** root filesystem
using Docker's `--output type=local,dest=/absolute/path` exporter and set
`HEIC_BUILDER_ROOTFS=/absolute/path` for the HEIC commands. This explicit backend
binds its usr/etc/emsdk/opt read-only into a small container and compiles with no
network. It still checks SDK/Node versions and the same output hashes; it does
not select another SDK. Do not point it at an untrusted filesystem. CI uses the
normal image backend. The build recipe is mounted read-only at execution time.

The SDK's Node copy is removed; `EM_NODE_JS` selects the pinned Node 24 binary.
The dated Debian snapshot includes both ordinary and security/updates archives.
`libheif-emscripten-4.0.10.patch` explicitly boxes the image pointer before
`val.set`: libheif 1.22.2 requests a three-argument overload absent from this SDK.
This modified LGPL header is marked with the modification date. No decoder
algorithm is changed. The emitted module gets an ES module default export for
heic-to; all adaptations are visible in the recipe and source download.
The recipe disables upstream documentation/test executables and reuses the same
native static archives for the two JS linker variants. Decoder testing happens
against the final browser artifact; it does not require distributing test binaries.
The ES module adapter replaces Emscripten's CommonJS/AMD export tail; it does
not keep both module systems in the browser worker. Original upstream codec
inputs are deleted before rebuilding, preventing an unnoticed binary fallback.

## Your own modified library / 직접 수정한 라이브러리

For a libheif change, extract `web/vendor/heic/sources/libheif.tar.gz` into an empty
folder, edit the C/C++ source and repack that folder's contents at the archive
root (do not add another top-level directory). Update that component's SHA-256 in
`manifest.json`, then run `npm run heic:rebuild` and `npm run build` from `web/`.
For libde265, preserve the release archive's `libde265-1.0.16/` top-level directory.
Keep copyright notices and mark your changes. If you change the recipe or add a
patch, record its hash in the manifest as well. The integrity checks and their
source are supplied for modification; they are not a signature/key restriction.
The browser probe command demonstrates both native libraries being changed and
recombined, without updating or contaminating the committed vendor baseline.

한국어: libheif 소스 아카이브를 빈 폴더에 풀어 C/C++ 코드를 수정한 뒤 원래
최상위 구조로 다시 묶고 명세의 SHA-256을 갱신합니다. libde265는 원래의
`libde265-1.0.16/` 폴더를 유지하세요. 이어서 `heic:rebuild`, `build`를 실행합니다.
레시피·패치도 바꾸면 해당 해시를 갱신하고 저작권 고지와 수정 사실을 보존하세요.
무결성 검사는 비공개 서명키를 요구하지 않으며 검사 코드도 함께 제공됩니다.

## Delivery and retention / 배포 및 보존

Keep `out/source/` with the JavaScript files as one deployment. The source ZIP/tar
from GitHub's automatic repository download does not include these generated
per-build application settings; use the source tarball linked from `/notice`.
Retain matching source downloads whenever older object files remain available
through release hosting/CDNs. The repository has no production hosting workflow
and cannot establish the host's retention or deployment terms. A source download
and successful rebuild are technical evidence for §4(d)(0), not a legal verdict.

한국어: JavaScript와 `out/source/`를 같은 배포 단위로 제공하세요. 과거 배포물이
CDN·릴리스 서버에 남아 있는 동안 대응 소스도 보존해야 합니다. 운영 호스팅의
보존·접근 정책과 추가 배포 조건은 이 저장소의 자동화만으로 확인할 수 없습니다.

### CA bootstrap / CA 초기화

The slim Node image has embedded public roots but may not yet have the OS CA
bundle. `prepare-ca.mjs` writes a readable temporary bundle from those public roots
plus the optional proxy CA **before** APT HTTPS runs. APT, Git, Python and npm use
that bundle during installation; TLS verification stays enabled. The temporary
bundle is removed from the resulting image. The helper is covered by the recipe
manifest, so changes to it require an explicit hash update.

한국어: 슬림 이미지의 OS 인증서 설치 전에는 Node 내장 공개 루트와 선택적 프록시 CA를
합친 임시 번들을 사용합니다. TLS 검증을 유지하며 설치 후 임시 번들은 제거합니다.
