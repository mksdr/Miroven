# Miroven

[English](README.md) · **한국어**

기록과 사진을 기기에서 암호화하는 로컬 우선 개인 저널입니다. 로그인 없이 시작하고, 여러 기기에서 이어 쓰고 싶을 때 Miroven-API에 연결해 암호문을 동기화할 수 있습니다.

## 주요 기능

- 기록 작성·수정·검색과 기록당 최대 4장의 사진 첨부
- 기기 내 암호화 저장, PIN 잠금, 암호화 파일 백업과 복구
- 선택적 이메일 코드 로그인과 암호문 동기화, 충돌 시 보존할 내용 선택
- 이전 기록 인용과 암호화된 개인 프로필
- 한국어·영어 화면, 테마와 글자 크기 설정

## 시작하기

Node.js 22.13 이상과 npm이 필요합니다. CI와 Docker 빌드는 Node.js 24.22.1을 사용합니다. 저장소 루트에서 실행합니다.

```sh
cd web
npm ci
npm run dev
```

`NEXT_PUBLIC_MIROVEN_API_URL`을 설정하지 않으면 로컬 전용으로 동작합니다. 빌드 설정은 [환경 변수 예제](web/.env.example)를 참고하세요.

| 목적 | 안내 |
| --- | --- |
| 앱 사용법 | 실행한 앱의 `/guide` |
| 개발 환경과 검증 | [개발 안내](https://github.com/mksdr/Miroven/wiki/Client-Development.ko) |
| 정적 앱 자체 호스팅 | [자체 호스팅](https://github.com/mksdr/Miroven/wiki/Self-Hosting.ko) |
| 구조·암호화·호환성 | [통합 Wiki](https://github.com/mksdr/Miroven/wiki/Home.ko) |
| 문제 제보·기여 | [기여 안내](CONTRIBUTING.md#한국어) |
| 보안 취약점 신고 | [보안 안내](SECURITY.md#한국어) |

## 기록 보관과 보안

이메일 로그인과 금고 해제는 별개입니다. 다른 기기에서 금고를 열려면 복구 코드가 필요합니다. 브라우저 저장소는 영구 보관을 보장하지 않으므로 암호화 백업 파일과 복구 코드를 서로 다른 안전한 곳에 보관하세요.

서버에는 이메일·시각·암호문 크기 등 메타데이터가 보입니다. 암호화는 변조된 앱, XSS, 잠금 해제된 기기에 대한 접근을 막지 못합니다. [보안 경계와 알려진 제한](https://github.com/mksdr/Miroven/wiki/Security-Model.ko)을 확인하세요.

## 관련 프로젝트

- **Miroven**: 이 저장소의 저널 클라이언트
- **Miroven-API**: 선택적 인증·암호문 동기화·파일 저장 서버
- **Miroven-Web**: 제품 소개·도움말·공식 서비스 정책을 제공하는 홈페이지

기술 문서는 [mksdr/Miroven Wiki](https://github.com/mksdr/Miroven/wiki)에 통합합니다. 공식 호스팅 서비스의 주소와 운영 정책은 서비스 공개 시 별도로 안내합니다.

## 라이선스

[GNU AGPL-3.0-only](LICENSE). 타사 의존성과 코덱에는 각 라이선스가 적용되며, 앱의 `/notice`에서 고지를 확인할 수 있습니다.
