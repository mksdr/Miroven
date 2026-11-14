# Optional package license evidence

[English](#english) · [한국어](#한국어)

## English

These are unmodified upstream evidence bytes (notices or explicitly marked
license declarations), deduplicated by SHA-256. Their own
copyright and license terms apply. `../optional-license-evidence.json` maps each
original filename and hash to an exact package name, install location, version,
license, npm tarball URL and SHA-512 integrity. `.gitattributes` disables newline
conversion for these files so hashes survive Windows checkouts.

From `web/`, run `node scripts/archive-optional-licenses.mjs` to refresh evidence.
This maintenance command uses the network and system `tar`; it verifies the
locked tarball's SHA-512 and package metadata before reading notices, without
installing packages or running lifecycle scripts. Matching, hash-verified existing
records are reused. Review the resulting diff; the command does not approve
license compatibility. Obsolete records disappear from the manifest; old text
files are not automatically deleted.

Standalone LICENSE/COPYING/NOTICE/COPYRIGHT files come from npm archives. The
sharp-libvips archives ship a `README.md` Licensing table instead of full license
texts: preserve that actual notice and retain the separate conditional-license
manual review. Do not substitute sharp-libvips' Apache-licensed packaging scripts
for its libraries' licenses.

For SWC, Rolldown and UnRS platform bindings, the archives omit originals.
`../optional-license-upstreams.json` records the reviewed release/source relation
and original URLs pinned to full source commits. The manifest marks these as
`upstreamReview`, with each file's `source`. Rolldown's referenced third-party
notice is included. These source originals support the declared package license;
they are not a complete audit of every linked native dependency or distribution
obligation. New versions require new source review; never silently use `main`.

`@tybys/wasm-util@0.10.3` explicitly declares MIT in the upstream `package.json`
at its npm `gitHead` `efb17cc128a30fb16b58127738f09c8871a3f7d1`, matching the
published archive and lockfile. The maintainer confirmed MIT licensing during
review. Archive that declaration as `kind: "license-declaration"` and verify its
name/version/license, in addition to the ordinary inventory and hash checks.
This is a version-specific reviewed declaration, not a standalone MIT license
text or an automatic fallback to arbitrary package metadata. HEIC library and
runtime reviews are unchanged.

The regular checker stays offline. Absent optional packages use these originals
only on an exact inventory match. Missing/stale evidence keeps `review`; missing
or corrupt referenced text fails inspection. Existing compatibility rules and
version-specific manual reviews still decide the result. Installed packages use
their own metadata/notices, and public `/notice` still includes installed packages
only.

## 한국어

이 폴더는 upstream 근거(고지 또는 명시적으로 구분한 라이선스 선언)의 원본 바이트를
SHA-256으로 중복 제거해 보관합니다. 각 원문의
저작권과 라이선스를 유지합니다. `../optional-license-evidence.json`은 원래 파일명·해시를
정확한 패키지명·설치 경로·버전·라이선스·npm 배포 URL·SHA-512 값에 연결합니다.
Windows 체크아웃에서도 해시를 유지하도록 `.gitattributes`에서 줄바꿈 변환을 끕니다.

`web/`에서 `node scripts/archive-optional-licenses.mjs`로 갱신합니다. 이 유지보수 명령만
네트워크와 시스템 `tar`를 사용하며, 잠금 파일의 SHA-512와 배포본 메타데이터를 먼저
검증합니다. 패키지 설치·lifecycle 스크립트 실행은 하지 않습니다. 정확히 일치하고 해시가
검증된 기존 기록은 재사용합니다. 결과 diff를 검토해야 하며 이 명령은 호환성 승인이
아닙니다. 제거된 패키지는 목록에서 제외하지만 이전 원문 파일은 자동 삭제하지 않습니다.

LICENSE·COPYING·NOTICE·COPYRIGHT 원문은 npm 배포본에서 가져옵니다. sharp-libvips는
전체 라이선스 대신 README의 Licensing 표를 동봉하므로 실제 고지를 보존하고 기존
조건부 라이선스 수동 검토도 유지합니다. 빌드 스크립트 저장소의 Apache 라이선스를
라이브러리 라이선스 대신 사용하지 않습니다.

SWC·Rolldown·UnRS 플랫폼 바인딩은 배포본에 원문이 없습니다.
`../optional-license-upstreams.json`에 검토한 릴리스·소스 관계와 전체 커밋 해시로 고정한
원문 URL을 기록합니다. manifest의 `upstreamReview`와 파일별 `source`로 구별하며,
Rolldown이 참조하는 타사 고지도 포함합니다. 이 근거는 패키지의 라이선스 선언을 뒷받침하며
모든 네이티브 의존성·배포 의무를 감사한 것은 아닙니다. 새 버전은 소스를 다시 검토하고
`main` 원문으로 자동 대체하지 않습니다.

`@tybys/wasm-util@0.10.3`은 npm `gitHead`
`efb17cc128a30fb16b58127738f09c8871a3f7d1`의 upstream `package.json`에 MIT를
명시하며 배포본·잠금 파일과 일치합니다. 관리자가 검토 중 MIT임을 확인했습니다.
이 선언을 `kind: "license-declaration"`으로 보관하고 기존 목록·해시 검사와 함께
선언의 패키지명·버전·라이선스를 검증합니다. 해당 버전을 검토한 선언 근거이며 독립적인
MIT 전문이나 임의 메타데이터로의 자동 대체가 아닙니다. HEIC 라이브러리와 런타임 review는
변경하지 않습니다.

일반 검사는 계속 오프라인으로 동작합니다. 미설치 선택적 패키지의 목록 정보가 정확히
일치할 때만 이 원문을 사용합니다. 근거가 없거나 오래되면 review를 유지하고, 참조한 파일의
누락·손상은 검사 실패입니다. 호환성 규칙·버전별 수동 검토는 그대로 적용합니다.
설치된 패키지는 설치본을 검사하며 공개 `/notice`에는 계속 설치된 패키지만 포함합니다.
