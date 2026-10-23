# Contributing

[English](#english) · [한국어](#한국어)

## English

Bug reports, documentation improvements, translations, and code contributions are welcome. Use [Issues](https://github.com/mksdr/Miroven/issues) for ordinary bugs and proposals. Discuss substantial changes in an issue before implementation so the scope can be agreed upon.

Include reproduction steps, expected and actual behavior, app version, browser, and operating system. Use synthetic journal data. Review diagnostics before sharing them; never include personal entries, photos, recovery codes, PINs, keys, or session cookies. Report vulnerabilities through [SECURITY.md](SECURITY.md).

For development and checks, follow the [client development guide](https://github.com/mksdr/Miroven/wiki/Client-Development). Keep a pull request focused, explain the resulting behavior, and report the relevant checks you ran and any checks you could not run. Add meaningful regression coverage when behavior changes. Update the Wiki when changing a documented contract and keep English and Korean documentation aligned.

Preserve existing data compatibility. Changes to AAD, database identifiers, encryption formats, or backup formats require an explicit migration and compatibility tests; see the [cryptographic format](https://github.com/mksdr/Miroven/wiki/Cryptographic-Format). Follow [web/AGENTS.md](web/AGENTS.md) when using coding agents.

Keep original copyright and third-party notices. Contributions to this repository follow its [AGPL-3.0-only license](LICENSE).

### Commit conventions

Use Conventional Commits for PR titles and final commits on `main`:

```text
type(optional-scope): summary
type(optional-scope)!: breaking summary
```

Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
Use lowercase types; scope is optional and uses lowercase letters/digits, dots, underscores, hyphens or slashes. English summaries and about 72 characters are recommended; Korean text is accepted and length is not a gate. One purpose per PR. Work-in-progress commits inside a PR are unrestricted; squash merge using the PR title. Direct commits to `main` follow the same format; branch protection must enforce PR use if direct pushes should be blocked. Existing history/tags are preserved. Format reverts as `revert: ...`.

Examples: `fix(sync): preserve pending uploads`, `feat(auth): add signup policy guidance`, `chore(deps-dev): update test tools`. Scopes are suggestions, not a fixed allowlist.

Explain incompatible changes and migration/compatibility checks in the PR and commit body; include `BREAKING CHANGE: ...` when needed so the squash message retains the explanation. A marker never replaces migrations, contract checks, or data compatibility tests. Never include secrets or personal data.

Versions, CHANGELOG, tags and GitHub Releases are managed through Release Please. Follow [the release guide](.github/RELEASING.md#english) for version policy, first-run baselines, activation and recovery. Do not manually bump versions for ordinary feature/fix PRs.

## 한국어

버그 제보, 문서 개선, 번역, 코드 기여를 환영합니다. 일반적인 버그와 제안은 [Issues](https://github.com/mksdr/Miroven/issues)에 작성하세요. 규모가 큰 변경은 구현 전에 이슈에서 범위를 논의해 주세요.

재현 순서, 예상·실제 동작, 앱 버전, 브라우저, 운영체제를 적어 주세요. 합성 기록으로 재현하고 진단 파일은 공유 전에 확인하세요. 개인 기록·사진·복구 코드·PIN·키·세션 쿠키는 포함하지 마세요. 취약점은 [SECURITY.md](SECURITY.md#한국어)의 비공개 경로로 신고하세요.

개발과 검증은 [개발 안내](https://github.com/mksdr/Miroven/wiki/Client-Development.ko)를 따릅니다. PR은 한 목적에 집중하고 변경 후 동작과 실행한 검사, 실행하지 못한 검사를 설명해 주세요. 동작 변경에는 필요한 회귀 검증을 추가하고, 문서화된 계약을 바꾸면 Wiki와 영어·한국어 문서도 함께 갱신하세요.

기존 데이터 호환성을 보존해야 합니다. AAD·DB 식별자·암호화·백업 형식 변경에는 명시적 마이그레이션과 호환성 검증이 필요합니다. [암호화 명세](https://github.com/mksdr/Miroven/wiki/Cryptographic-Format.ko)를 참고하세요. 코딩 에이전트 사용 시 [web/AGENTS.md](web/AGENTS.md)를 따릅니다.

원저작권과 타사 고지를 유지해 주세요. 이 저장소의 기여에는 [AGPL-3.0-only](LICENSE)가 적용됩니다.

### 커밋 규칙

PR 제목과 `main`에 남는 최종 커밋은 `type(선택적-scope): 요약` 형식을 사용합니다. 호환성 파괴는 `type(scope)!: 요약`으로 표시합니다.

허용 type은 `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`입니다. type은 소문자로 쓰고 scope는 선택 사항이며 소문자·숫자·점·밑줄·하이픈·슬래시를 허용합니다. 영어 제목과 약 72자를 권장하되 한국어를 허용하고 길이를 강제하지 않습니다. PR은 한 목적에 집중하고 PR 제목으로 squash 병합합니다. 작업 중 커밋은 자유롭게 작성할 수 있습니다. 직접 커밋도 같은 규칙을 따르며 직접 push 차단은 브랜치 보호에서 설정합니다. 기존 이력·태그는 보존하고 되돌리기는 `revert: ...`로 작성합니다.

예: `fix(sync): preserve pending uploads`, `feat(auth): add signup policy guidance`, `chore(deps-dev): update test tools`. scope 예시는 고정 허용 목록이 아닙니다.

호환성을 깨는 변경에는 영향·전환 방법·검증을 설명하고 필요한 경우 본문에 `BREAKING CHANGE: ...`를 남깁니다. squash 메시지에도 설명을 보존합니다. 이 표시는 마이그레이션·계약·데이터 호환성 검증을 대신하지 않습니다. 비밀정보와 개인 데이터는 포함하지 않습니다.

버전·CHANGELOG·태그·GitHub Release는 Release Please로 관리합니다. 버전 정책·초기 기준·활성화·복구는 [릴리스 안내](.github/RELEASING.md#한국어)를 따릅니다. 일반 기능·수정 PR에서 버전을 직접 올리지 않습니다.
