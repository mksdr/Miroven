/** Lightweight shared error identities; importing these must not load vault operations. */
export class LegacyBackupDeletionError extends Error {
  constructor() {
    super("이 백업의 삭제 내역은 안전하게 확인할 수 없습니다. 원래 기기에서 최신 앱으로 새 백업을 만들어 주세요. 기존 파일은 보관해 주세요.");
    this.name = "LegacyBackupDeletionError";
  }
}

export class RecoveryPinLockError extends Error {
  readonly code = "PIN_LOCK_CONFIGURED";

  constructor() {
    super("복구 코드를 생성하려면 계정 설정에서 PIN 잠금을 먼저 해제해 주세요. 생성 후 PIN 잠금을 다시 설정할 수 있습니다.");
    this.name = "RecoveryPinLockError";
  }
}
