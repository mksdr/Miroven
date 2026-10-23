# Releases

[English](#english) · [한국어](#한국어)

## English

### Release policy

The repository is one release unit, including root Docker/deployment changes. Release Please reads Conventional Commits on `main`, opens/updates a release PR, and updates `version.txt`, the manifest and package metadata together. Merge the release PR only after the required checks pass. Automatic release-PR merging is initially disabled; enable it separately only after proving required checks and migration/compatibility review work. A release PR merge creates the version tag; it does not publish npm/PyPI packages.

- `fix`, `perf`, `revert`: patch; `feat`: minor; any breaking marker: major.
- `docs`, `test`, `build`, `ci`, `refactor`, ordinary `chore`: no standalone release.
- Dependabot uses `chore(deps)` / `chore(deps-dev)`. An update needing immediate delivery must describe the actual fix using `fix(deps): ...`; routine tooling updates wait for another releasable change.
- The same bump policy applies before 1.0: breaking changes are explicit major releases. Product versions do not change API routes, wire/crypto/backup formats, or migration identifiers automatically.
- Keep the client/API versions independent. Cross-repository releases record tested commits, uncommitted changes, compatibility range and migration evidence in the PR/release notes.

### Activate on GitHub

Repository configuration is separate from committed files. Before merging the automation:

1. Create a GitHub App installed on the intended repository only (or both Miroven repositories). Grant repository **Contents: read/write**, **Pull requests: read/write**, **Issues: read/write**; no organization or administration permission is needed.
2. In each repository, set Actions variable `RELEASE_APP_ID` and Actions secret `RELEASE_APP_PRIVATE_KEY`. Enter the key through GitHub's secret UI; never commit it, paste it into an issue, or print it. The workflow requests a token scoped to the current repository. Do not substitute `GITHUB_TOKEN`: its bot PRs/tags do not trigger the required follow-up workflows.
3. Allow squash merging and use **PR title and description** for the default squash message. Disable merge/rebase methods if all final commits must comply. Keep `BREAKING CHANGE` explanations in the final message.
4. Run the new **Commit and release policy** check, then require it together with existing application, dependency-review and code-scanning gates in the `main` ruleset. Require the branch to be current (or an equivalent merge queue policy), prevent direct pushes, and do not give the release App a bypass of required checks.
5. Protect stable `v*` tags against deletion/movement; permit the release App to create them. Keep automatic PR merging disabled for the first release.
6. Merge the automation, run **Release Please** on `main`, and inspect its first PR. Missing App configuration intentionally fails with an actionable error. An all-chore history may correctly produce no release PR.

New action references are pinned to verified commit SHAs. Major/runtime action upgrades remain manual reviews.

### Validation and first release

Run from the repository root with Python 3.12 (standard library only):

```sh
python -m unittest discover -s .github/scripts -p 'test_*.py'
python .github/scripts/release_policy.py
# On a checked-out release tag:
python .github/scripts/release_policy.py --tag vX.Y.Z
```

The workflow also validates PR titles using the event JSON file, without interpolating titles into shell code. Scope is optional, Korean descriptions are accepted, and no local Git hook is required. Version mismatches block the policy check. For API tags, the existing image-publishing workflow also checks versions before publishing.

On a non-production test repository/branch, verify fix/minor/breaking/no-release cases, a root-only Docker change, release-PR updates after another commit, bot PR CI, tag workflow execution, and rerunning publication. Do not use a local unit-test result as evidence that GitHub App permissions, branch rules or registry publishing work.

Review pre-automation nonconventional commits manually in the first release PR; they cannot be reliably classified from their titles. Preserve historical tags and do not backfill speculative release notes. After the first automated release, remove the no-longer-needed `bootstrap-sha` in a normal PR.

### Recovery

If release generation fails, correct configuration/permissions and rerun **Release Please** on `main`. Before retrying a merged release PR, inspect its `autorelease: pending/tagged` labels and existing tag/release. Do not delete a published tag or change its target. If a published version is wrong, ship a new corrective version. If a release needs a different version, use the documented Release Please `Release-As` override in a reviewed PR rather than editing only one version file.

The client application, API integration, image builds, production SMTP/TLS/storage and physical-device behavior still need their normal checks; message/metadata tests do not establish them.

### Client baseline and delivery

Initial version: **1.2.0**. Bootstrap starts after squash commit `a31e50ca62c52c06048aa533bf3b873a6318a4c9` on main. The preserved `v1.2.0` tag points to `585d428e051eb71fbfac581731381fad1c59d31e` on the old release branch, not an ancestor of main. Their trees differ only in CI Playwright retry handling. The latest-published-release API returned 404 during implementation; no replacement historical Release is created.

Release Please updates the package and lockfile root versions in `web/`; diagnostics and Service Worker builds already read the package version. It publishes a source GitHub Release at the release PR's merge commit. It does not create an environment-specific static ZIP, Docker image, or production deployment. Build static exports from the exact tag with the intended public API/app/website URLs; do not distribute an unexplained build with another environment's settings. Existing external hosting triggers are outside this repository and must be reviewed before connecting production deployment.

## 한국어

### 릴리스 정책

루트 Docker·배포 변경까지 저장소 전체를 하나의 릴리스로 관리합니다. Release Please가 `main`의 Conventional Commits를 분석하고 릴리스 PR을 생성·갱신하며 `version.txt`·manifest·패키지 메타데이터를 함께 변경합니다. 필수 검사를 통과한 뒤 릴리스 PR을 병합하면 태그가 만들어집니다. npm/PyPI 배포는 추가하지 않습니다. 초기에는 릴리스 PR 자동 병합을 끄고, 필수 검사와 마이그레이션·호환성 검토가 검증된 후 별도로 활성화합니다.

- `fix`·`perf`·`revert`는 patch, `feat`는 minor, 호환성 파괴 표시는 major입니다.
- `docs`·`test`·`build`·`ci`·`refactor`·일반 `chore`만으로는 릴리스하지 않습니다.
- Dependabot은 `chore(deps)`·`chore(deps-dev)`를 사용합니다. 즉시 배포할 수정은 실제 문제를 설명하는 `fix(deps): ...`로 병합하고 일반 도구 갱신은 다음 릴리스에 포함합니다.
- 1.0 미만에도 같은 증가 규칙을 적용합니다. 제품 버전 증가는 API 경로·통신·암호화·백업 형식이나 마이그레이션 식별자를 자동 변경하지 않습니다.
- 클라이언트와 API는 독립 버전입니다. 연동 릴리스에는 테스트한 두 커밋, 관련 미커밋 변경, 호환 범위와 마이그레이션 검증을 PR·릴리스 설명에 남깁니다.

### GitHub 활성화

저장소 설정은 커밋된 파일과 별개입니다. 자동화 PR을 병합하기 전에 다음을 준비합니다.

1. 대상 저장소에만 설치한 GitHub App을 만듭니다. 두 Miroven 저장소를 함께 선택해도 됩니다. 저장소 Contents·Pull requests·Issues에 읽기/쓰기를 부여하며 조직·관리자 권한은 필요하지 않습니다.
2. 각 저장소에 Actions 변수 `RELEASE_APP_ID`와 secret `RELEASE_APP_PRIVATE_KEY`를 설정합니다. 키는 GitHub secret 화면에서 입력하고 커밋·이슈·로그에 남기지 않습니다. 워크플로는 현재 저장소 범위의 토큰을 요청합니다. 기본 `GITHUB_TOKEN`으로 대체하면 봇 PR·태그에 필요한 후속 워크플로가 실행되지 않습니다.
3. squash 병합과 기본 메시지 **PR title and description**을 설정합니다. 최종 커밋 전체를 통일하려면 merge/rebase 병합을 끕니다. 최종 메시지에 `BREAKING CHANGE` 설명을 보존합니다.
4. **Commit and release policy**를 실행한 다음 기존 앱·의존성·코드 스캔 검사와 함께 `main` ruleset의 필수 검사로 지정합니다. 최신 브랜치 검사 또는 동등한 merge queue 정책을 적용하고 직접 push를 막습니다. 릴리스 App에도 필수 검사 우회를 허용하지 않습니다.
5. 안정 버전 `v*` 태그의 삭제·이동을 보호하고 릴리스 App의 새 태그 생성을 허용합니다. 첫 릴리스는 PR 자동 병합을 끕니다.
6. 설정 PR을 병합하고 `main`에서 **Release Please**를 실행해 첫 PR을 확인합니다. App 설정이 없으면 해결 안내와 함께 실패합니다. `chore`만 있으면 릴리스 PR이 생기지 않는 것이 정상입니다.

새 Action은 확인한 커밋 SHA로 고정합니다. major·런타임 업그레이드는 수동 검토합니다.

### 검증과 첫 릴리스

저장소 루트에서 Python 3.12로 실행합니다. 표준 라이브러리만 사용합니다.

```sh
python -m unittest discover -s .github/scripts -p 'test_*.py'
python .github/scripts/release_policy.py
python .github/scripts/release_policy.py --tag vX.Y.Z
```

마지막 명령은 해당 태그를 checkout한 상태에서 사용합니다. PR 제목은 이벤트 JSON 파일로 읽으며 셸 코드에 삽입하지 않습니다. scope는 선택 사항이고 한국어 요약을 허용하며 로컬 Git hook은 필수가 아닙니다. 버전 불일치는 검사를 실패시킵니다. API 이미지 발행 작업도 태그 버전을 별도로 검사합니다.

운영과 분리한 테스트 저장소·브랜치에서 patch/minor/major/릴리스 없음, 루트 Docker 단독 변경, 후속 커밋에 따른 릴리스 PR 갱신, 봇 PR CI, 태그 워크플로, 발행 재실행을 검증합니다. 로컬 단위 테스트는 App 권한·브랜치 규칙·레지스트리 발행의 증거가 아닙니다.

도입 전 일반 문장형 커밋은 제목만으로 분류할 수 없으므로 첫 릴리스 PR에서 누락을 수동 검토합니다. 기존 태그를 보존하고 추측한 과거 릴리스 노트를 만들지 않습니다. 첫 자동 릴리스 후 불필요해진 `bootstrap-sha`는 일반 PR에서 제거합니다.

### 실패 복구

릴리스 생성 실패는 권한·설정을 고친 뒤 `main`에서 **Release Please**를 재실행합니다. 병합된 릴리스 PR을 재시도하기 전 `autorelease: pending/tagged` 라벨과 기존 태그·Release를 확인합니다. 공개된 태그를 삭제·이동하지 않고 잘못된 공개 버전은 새 버전으로 수정합니다. 다음 버전 조정은 검토한 PR의 Release Please `Release-As` 지시를 사용하고 일부 버전 파일만 수정하지 않습니다.

앱·실제 API 연동·이미지 빌드·운영 SMTP/TLS/스토리지·실기기 검증은 기존 절차대로 필요합니다. 메시지·메타데이터 테스트가 이를 대신하지 않습니다.

### 클라이언트 초기 기준과 배포

초기 버전은 **1.2.0**, 비교 기준은 main의 squash 커밋 `a31e50ca62c52c06048aa533bf3b873a6318a4c9`입니다. 기존 `v1.2.0` 태그는 main의 조상이 아닌 과거 릴리스 브랜치의 `585d428e051eb71fbfac581731381fad1c59d31e`를 가리킵니다. 두 트리는 CI Playwright 재시도 처리만 다릅니다. 구현 당시 최신 공개 릴리스 API는 404였으며 과거 Release를 새로 만들지 않습니다.

`web/`의 패키지·lock 루트 버전을 갱신합니다. 진단 정보와 Service Worker 빌드는 기존처럼 패키지 버전을 읽습니다. 릴리스 PR 병합 커밋에 소스 GitHub Release를 발행합니다. 환경별 정적 ZIP·Docker 이미지·운영 배포는 추가하지 않습니다. 정적 파일은 정확한 태그에서 의도한 API·앱·웹사이트 공개 URL로 빌드하고 설정이 불분명한 다른 환경의 빌드를 배포하지 않습니다. 외부 호스팅 트리거는 저장소 밖 설정이므로 운영 배포 연결 전에 확인해야 합니다.
