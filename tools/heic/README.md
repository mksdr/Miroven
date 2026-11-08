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

After `npm run build`, `npm run heic:verify:source` rebuilds the downloaded
application source, compares its repackaged archive and reproduces native output.
The HEIC Actions workflow runs these native experiments on manual dispatch.

For an HTTPS inspection proxy, preserve normal proxy settings. The optional
`CODEX_PROXY_CERT` environment variable supplies a public CA to the npm install
through a BuildKit secret; it is not copied into the image or source bundle.

The source download on `/notice` includes application inputs, library archives,
this recipe, patches (if any), lockfiles and public build settings. Extract the
application archive, restore `BUILD-SETTINGS.json` into the build environment,
then run `cd web && npm ci && npm run build` for the supplied vendor build; the commands above regenerate or replace it from native source.
Do not substitute another release's libraries without updating its manifest,
notices, output hashes and the matching source distribution.

한국어: 일반 앱 빌드는 Docker 없이 보관된 코덱을 검증해 사용합니다. 위 전용 명령은
고정된 소스에서 C/C++ 라이브러리와 래퍼를 다시 생성합니다. verify는 결과를 덮어쓰지
않으며 relink는 임시 복사본에서 두 네이티브 라이브러리를 수정하여 시험합니다.
소스 다운로드를 배포물과 함께 보존하고 실제 호스팅에서도 접근 가능한지 확인하세요.
재빌드 성공은 LGPL의 모든 법적 의무 충족 판정이 아닙니다.

## Source collection / 소스 수집

The packager automatically collects declared source directories and required root
files, including local edits and untracked inputs. No Git metadata or file approval
list is needed. Keep private material outside those directories; private/generated
roots are excluded and secret-named files or symlinks in source roots are rejected.
`BUILD-SETTINGS.json` records the public variables to restore before rebuilding.

한국어: 소스 디렉터리와 필수 루트 파일의 실제 내용을 자동 수집하며 미추적 입력도
포함합니다. 파일별 승인이나 Git은 필요하지 않습니다. 개인 자료는 대상 디렉터리 밖에
보관하세요. 공개 설정은 `BUILD-SETTINGS.json`에서 빌드 환경으로 복원합니다.

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

Further technical background and the optional low-storage builder backend are in
[client development](https://github.com/mksdr/Miroven/wiki/Client-Development)
and [dependency licenses](https://github.com/mksdr/Miroven/wiki/Dependency-Licenses).
한국어 안내: [개발](https://github.com/mksdr/Miroven/wiki/Client-Development.ko) ·
[라이선스](https://github.com/mksdr/Miroven/wiki/Dependency-Licenses.ko).
The rebuild and replacement steps above are self-contained in this download.
