# PIN key lifetime

## PIN key lifetime and existing vaults

PIN unlock is scoped to one document context. Reloads, new tabs, navigation, and browser-process restarts require the PIN again. Pagehide (including bfcache entry) revokes the current context; returning from bfcache rechecks the locked state. Manual/idle locks and PIN changes revoke memory sessions and clear decrypted views in participating tabs through BroadcastChannel, with storage-event notification as a fallback. No key or PIN is sent through either channel. If both messaging mechanisms are unavailable, other tabs cannot be notified immediately and must lock independently. Unlocking one tab does not unlock another. A pending slow PIN derivation cannot restore a session revoked while it was running.

Migration does not change IndexedDB version/store names, encrypted records, AAD, PIN envelope, PBKDF2 parameters, recovery codes, or backup format. The centralized key reader ignores a legacy persistent `primary` key whenever a PIN envelope exists. Existing plaintext-capable legacy keys are retained until the first correct PIN proves that they match the envelope, then removed before creating the memory session. This avoids silently deleting the only usable key in an inconsistent legacy vault. Until that first verified migration, the legacy key still exists on disk; complete a PIN unlock after updating. If keys do not match, fail closed and preserve the original browser data and recovery code for recovery rather than deleting either key.

Close/reload all old-version tabs after updating: old JavaScript cannot be retroactively revoked and may still use the old persistence path. The updated app never uses a legacy stored key to bypass PIN entry. PIN removal requires the correct PIN and atomically stores the verified key while deleting the PIN envelope, preserving local-only operation across restarts. Recovery/import refuses to install a persistent key underneath an existing PIN; remove the PIN first on an empty vault. Backup export uses the memory key while unlocked. Existing encrypted entries, drafts, recent searches, photos, Outbox work, and conflicts remain intact.

The PIN is still a convenience lock with limited offline entropy. This change does not defend against a compromised client/browser, XSS, OS memory inspection, or someone accessing an already unlocked tab.


## PIN 해제 키의 수명과 기존 금고

PIN 해제는 현재 문서 컨텍스트에만 적용한다. 새로고침·새 탭·다른 페이지 이동·브라우저 프로세스 재시작 후에는 PIN을 다시 입력한다. pagehide(bfcache 진입 포함)에서 현재 메모리 세션을 폐기하고 bfcache 복귀 시 잠금 상태를 다시 확인한다. 수동/유휴 잠금 및 PIN 변경은 BroadcastChannel, 불가능하면 storage 이벤트로 다른 참여 탭의 메모리와 복호화 화면을 정리한다. 키와 PIN은 전송하지 않는다. 두 알림 방식이 모두 불가능하면 다른 탭에 즉시 알릴 수 없으므로 각 탭이 별도로 잠겨야 한다. 한 탭을 열어도 다른 탭은 열리지 않으며, 진행 중인 느린 PIN 파생 작업은 이미 폐기한 세션을 복구할 수 없다.

IndexedDB 버전·store 이름·암호문·AAD·PIN 봉투·PBKDF2 매개변수·복구 코드·백업 형식은 유지한다. 중앙 키 접근자는 PIN 봉투가 있으면 구버전의 영구 `primary` 키를 무시한다. 기존 키는 올바른 PIN으로 봉투와 일치하는 것을 확인한 첫 해제 시 삭제하고 메모리 세션을 만든다. 불일치한 기존 금고에서 마지막 사용 가능한 키를 조용히 잃지 않기 위한 절차다. 첫 검증 전까지 구버전 키는 디스크에 남으므로 업데이트 후 PIN 해제를 한 번 완료한다. 키가 다르면 금고를 열지 않고 원본 브라우저 데이터와 복구 코드를 보존하여 복구하도록 안내하며 키를 삭제하지 않는다.

업데이트 후 구버전 탭을 모두 닫거나 다시 불러온다. 이미 실행 중인 구버전 JavaScript의 키 사용·저장을 소급 차단할 수는 없다. 업데이트된 앱은 구버전 저장 키로 PIN 입력을 우회하지 않는다. PIN 제거에는 올바른 PIN을 요구하며, 검증된 키의 영구 저장과 PIN 봉투 제거를 한 트랜잭션으로 처리해 PIN 없는 로컬 전용 금고를 재시작 후에도 사용할 수 있다. 복구/백업 가져오기는 기존 PIN 아래에 영구 키를 설치하지 않으며 빈 금고의 PIN을 먼저 제거해야 한다. 백업 내보내기는 해제된 메모리 키를 사용한다. 기록·초안·최근 검색어·사진·미전송 Outbox·충돌 데이터는 보존한다.

PIN은 여전히 오프라인 엔트로피가 제한된 편의 잠금이다. 변조된 클라이언트·브라우저, XSS, OS 메모리 검사, 이미 열린 탭에 대한 접근을 방어하는 변경은 아니다.

## Wiki publication

`wiki/pin-key-lifetime.patch` contains the corresponding English/Korean Cryptographic-Format and Security-Model updates for review and publication with the release; live Wiki pages are unchanged.
