# Bundled codec notices

[English](#english) · [한국어](#한국어)

## English

`heic-to@1.5.2` identifies libheif 1.22.2 and libde265 1.0.16 in
`src/lib/libheif.js`. These dependencies are embedded rather than listed in npm's dependency graph.

The unmodified license files and copyright headers were retrieved from their matching upstream tags:

- https://github.com/strukturag/libheif/blob/v1.22.2/COPYING
- https://github.com/strukturag/libheif/blob/v1.22.2/libheif/api/libheif/heif.h (first comment)
- https://github.com/strukturag/libde265/blob/v1.0.16/COPYING
- https://github.com/strukturag/libde265/blob/v1.0.16/libde265/de265.h (first comment)

When updating heic-to, check the embedded versions and refresh these notices and
the versions in `../bundled-licenses.json`.

Run `npm ci` then `npm run notices:generate` after dependency changes. The generated
JSON files are committed so the notice page needs no filesystem or network access
at runtime. Optional packages absent from the current platform are excluded.
Package metadata supplies the license identifier and author when no notice file
is shipped; the page explicitly identifies that case.

## 한국어

이 폴더는 `heic-to@1.5.2`에 내장된 libheif 1.22.2와 libde265 1.0.16의 라이선스 원문과 저작권 헤더를 보관합니다. 위의 상위 태그에서 수정 없이 가져왔으며, 이 의존성은 npm 의존성 목록만으로 확인할 수 없습니다.

heic-to를 갱신할 때 내장 버전과 원문을 확인하고 이 폴더 및 `../bundled-licenses.json`을 함께 갱신하세요. 의존성 변경 후 `npm ci`, `npm run notices:generate`를 실행합니다. 생성 JSON은 고지 화면이 실행 중 파일시스템·네트워크 없이 동작하도록 소스에 포함하며, 현재 플랫폼에 설치되지 않은 선택적 패키지는 제외합니다. 원문이 없는 패키지는 메타데이터만 사용한 사실을 고지하고 저작권 원문을 만들어내지 않습니다.
