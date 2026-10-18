# Contributing

[English](#english) · [한국어](#한국어)

## English

Bug reports, documentation improvements, translations, and code contributions are welcome. Use [Issues](https://github.com/mksdr/Miroven/issues) for ordinary bugs and proposals. Discuss substantial changes in an issue before implementation so the scope can be agreed upon.

Include reproduction steps, expected and actual behavior, app version, browser, and operating system. Use synthetic journal data. Review diagnostics before sharing them; never include personal entries, photos, recovery codes, PINs, keys, or session cookies. Report vulnerabilities through [SECURITY.md](SECURITY.md).

For development and checks, follow the [client development guide](https://github.com/mksdr/Miroven/wiki/Client-Development). Keep a pull request focused, explain the resulting behavior, and report the relevant checks you ran and any checks you could not run. Add meaningful regression coverage when behavior changes. Update the Wiki when changing a documented contract and keep English and Korean documentation aligned.

Preserve existing data compatibility. Changes to AAD, database identifiers, encryption formats, or backup formats require an explicit migration and compatibility tests; see the [cryptographic format](https://github.com/mksdr/Miroven/wiki/Cryptographic-Format). Follow [web/AGENTS.md](web/AGENTS.md) when using coding agents.

Keep original copyright and third-party notices. Contributions to this repository follow its [AGPL-3.0-only license](LICENSE).

## 한국어

버그 제보, 문서 개선, 번역, 코드 기여를 환영합니다. 일반적인 버그와 제안은 [Issues](https://github.com/mksdr/Miroven/issues)에 작성하세요. 규모가 큰 변경은 구현 전에 이슈에서 범위를 논의해 주세요.

재현 순서, 예상·실제 동작, 앱 버전, 브라우저, 운영체제를 적어 주세요. 합성 기록으로 재현하고 진단 파일은 공유 전에 확인하세요. 개인 기록·사진·복구 코드·PIN·키·세션 쿠키는 포함하지 마세요. 취약점은 [SECURITY.md](SECURITY.md#한국어)의 비공개 경로로 신고하세요.

개발과 검증은 [개발 안내](https://github.com/mksdr/Miroven/wiki/Client-Development.ko)를 따릅니다. PR은 한 목적에 집중하고 변경 후 동작과 실행한 검사, 실행하지 못한 검사를 설명해 주세요. 동작 변경에는 필요한 회귀 검증을 추가하고, 문서화된 계약을 바꾸면 Wiki와 영어·한국어 문서도 함께 갱신하세요.

기존 데이터 호환성을 보존해야 합니다. AAD·DB 식별자·암호화·백업 형식 변경에는 명시적 마이그레이션과 호환성 검증이 필요합니다. [암호화 명세](https://github.com/mksdr/Miroven/wiki/Cryptographic-Format.ko)를 참고하세요. 코딩 에이전트 사용 시 [web/AGENTS.md](web/AGENTS.md)를 따릅니다.

원저작권과 타사 고지를 유지해 주세요. 이 저장소의 기여에는 [AGPL-3.0-only](LICENSE)가 적용됩니다.
