# Test fixtures

[English](#english) · [한국어](#한국어)

## English

### HEIF image

`example.heic` is the [libheif example image](https://github.com/strukturag/libheif/blob/master/examples/example.heic), retrieved on 2026-09-05. It is used only in automated tests and is not served as an app asset.

SHA-256: `7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2`.

Browser checks also rename the container to `.HEIF` and add a valid ISO BMFF `free` box to exceed 2 MiB. Preserve the upstream [license and notices](https://github.com/strukturag/libheif/blob/master/COPYING).

### Encrypted backup compatibility

`legacy-backup-v1.json` is synthetic data created on 2026-09-13. Its text and recovery code are test-only, not real user data or production credentials. Its fixed ciphertext checks backup v1, entry crypto v3, recovery code, and AAD compatibility. Do not rename fixture identifiers because of a product rename or release. See the [cryptographic format](https://github.com/mksdr/Miroven/wiki/Cryptographic-Format).

`backup-v2.json` reuses that synthetic v1 fixture and test-only recovery code with version 2 and a whole-manifest authentication tag computed independently using Python cryptography HKDF/AESGCM and Python hmac. It verifies the cross-implementation HKDF info, salt, canonical JSON, and tag encoding. No user data or production keys are included.

## 한국어

## HEIF 사진

`example.heic`은 [libheif의 공개 예제](https://github.com/strukturag/libheif/blob/master/examples/example.heic)이며 2026-09-05에 가져왔습니다. 자동 테스트에서만 사용하고 앱 정적 파일로 제공하지 않습니다.

SHA-256: `7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2`.

HEIF 브라우저 테스트는 같은 컨테이너의 이름을 .HEIF로 바꾸고 유효한 ISO BMFF free 박스를 추가해 2 MiB를 넘기는 경우도 검사합니다. 원본의 [라이선스와 고지](https://github.com/strukturag/libheif/blob/master/COPYING)를 따릅니다.

## 암호화 백업 호환 데이터

`legacy-backup-v1.json`은 2026-09-13에 만든 합성 데이터입니다. 본문과 복구 코드는 테스트 전용이며 사용자 데이터나 운영 인증정보가 아닙니다.

고정된 암호문으로 백업 v1·기록 암호화 v3·복구 코드·AAD 호환성을 검증합니다. 이름 변경을 이유로 fixture나 암호화 식별자를 바꾸지 않습니다. [암호화 명세](https://github.com/mksdr/Miroven/wiki/Cryptographic-Format.ko)를 참고합니다.

`backup-v2.json`은 동일한 합성 v1 fixture와 테스트 전용 복구 코드를 사용한다. 버전 2와 전체 manifest 인증 태그는 Python cryptography의 HKDF/AESGCM 및 Python hmac으로 독립 계산했다. HKDF info·salt·JSON 정규화·tag 인코딩의 구현 간 호환성을 확인하며 사용자 데이터나 운영 키는 포함하지 않는다.
