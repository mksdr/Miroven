# Authenticated backup format v2

## Authenticated backup v2 and migration

New exports use `miroven-encrypted-backup`, version `2`. The v1 fields remain, with `authentication: {"algorithm":"hmac-sha256","tag":"<base64>"}` added. HMAC-SHA-256 authenticates the entire root JSON object excluding only its `authentication` property: entries, array order, Outbox deletions, revisions, statuses, export time, cursor, format/version, and vault envelope. Canonical bytes are UTF-8 of compact ECMAScript JSON.stringify with object keys recursively sorted using JavaScript's default string sort; arrays retain their order. JSON whitespace and object property order do not affect verification. This is an integrity layer, not whole-file encryption or proof of freshness.

Derive a 256-bit HMAC key with HKDF-SHA-256 from the raw 32-byte vault key, the envelope's 16-byte recoverySalt, and UTF-8 info `private-journal:backup-auth:v2`. Encode the 32-byte tag as canonical padded standard Base64. The nonextractable derived key is separate from entry and recovery keys; erase the temporary exported vault-key buffer after derivation. Unwrap the vault envelope with the recovery code and verify the complete manifest before normalizing operations or writing any vault data. Continue the existing per-record checks. The recovery code is never written into the file.

Compatibility:

- A v2 backup requires an updated client; v1-only clients reject it. Existing IndexedDB data, entry/sync ciphertext, AAD, and recovery codes are unchanged. No API migration is needed.
- A trusted v1 file without deletion operations can still be imported, including encrypted pending/conflicting upserts and photos. Re-export it from the updated client to create v2. v1 metadata remains unauthenticated; migration cannot retroactively establish its integrity.
- Reject a v1 file containing any pending or conflicting delete before writing data. Keep the file intact. Use the original device with the updated app to export an authenticated backup. If that device is unavailable, retain the original file and use a separately reviewed recovery process; do not remove operations or downgrade the file by hand.
- Stripping the v2 tag and changing its version to v1 cannot enable unsigned deletion import. Legitimate v2 deletions and conflict status round-trip unchanged.

Keep originals until restoration and synchronization are verified.


## 백업 v2 인증과 전환

새 내보내기는 `miroven-encrypted-backup` version `2`를 사용한다. 기존 v1 필드에 `authentication: {"algorithm":"hmac-sha256","tag":"<base64>"}`를 추가한다. HMAC-SHA-256은 root의 `authentication` 속성만 제외한 전체 JSON을 인증한다. 기록·배열 순서·Outbox 삭제·revision·상태·내보낸 시각·커서·형식/버전·금고 봉투를 모두 포함한다. 정규화 바이트는 object key를 JavaScript 기본 문자열 정렬로 재귀 정렬한 compact ECMAScript JSON.stringify 결과의 UTF-8이다. 배열 순서는 유지하며 공백·object 속성 순서 변경은 검증에 영향을 주지 않는다. 파일 전체 암호화나 최신성 증명은 아니다.

32-byte raw Vault Key를 HKDF-SHA-256 입력으로 사용한다. salt는 봉투의 16-byte recoverySalt, info는 UTF-8 `private-journal:backup-auth:v2`, 출력은 256-bit HMAC 키다. 32-byte tag를 padding을 포함하는 표준 canonical Base64로 기록한다. 파생 키는 추출 불가이고 기존 기록·복구 키와 용도를 분리한다. 파생 후 임시 raw Vault Key 버퍼를 지운다. 가져올 때 복구 코드로 금고 봉투를 해제하고 operation 정규화나 금고 저장 전에 전체 manifest 인증을 확인한다. 기존 개별 기록 검증도 유지하며 복구 코드는 파일에 넣지 않는다.

호환성:

- v2 백업은 업데이트된 앱에서 복원한다. v1 전용 앱은 거부한다. 기존 IndexedDB·기록/sync 암호문·AAD·복구 코드는 유지하며 API 마이그레이션은 없다.
- 삭제 operation이 없는 신뢰할 수 있는 v1 파일은 사진과 미전송/충돌 upsert를 포함해 계속 가져올 수 있다. 최신 앱에서 다시 내보내 v2로 전환한다. v1 메타데이터는 인증되지 않으며 전환으로 과거의 무결성을 소급 보증할 수 없다.
- pending 또는 conflict 삭제가 하나라도 포함된 v1 파일은 금고에 쓰기 전에 거부한다. 원본 파일을 보관하고 원래 기기의 최신 앱에서 인증된 백업을 다시 내보낸다. 원래 기기를 사용할 수 없으면 원본을 보존하고 별도로 검토된 복구 절차를 사용한다. operation을 수동 삭제하거나 파일을 downgrade하지 않는다.
- v2 인증 태그를 지우고 버전을 v1로 바꿔도 인증되지 않은 삭제를 가져올 수 없다. 정상 v2 삭제와 충돌 상태는 그대로 왕복 보존한다.

복원·동기화 결과를 확인하기 전까지 원본을 보관한다.

## Wiki publication

`wiki/backup-v2.patch` contains the corresponding English/Korean updates to `Backup-and-Restore` and `Cryptographic-Format`. It is staged here for review with the implementation; publish it to Miroven.wiki after the updated client is released, so live documentation does not describe unmerged behavior.
