"use client";

type BackupCopy = {
  backupGuard: string;
  checkingBackup: string;
  exportBackup: string;
  emptyDeviceOnly: string;
  backupNeeds: string;
  recoveryCode: string;
  importBackup: string;
};

export function EncryptedBackupContent({
  inputId,
  copy,
  hasLocalEnvelope,
  entryCount,
  busy,
  recoveryInput,
  acceptedFileTypes,
  onExport,
  onRecoveryInputChange,
  onImport,
}: {
  inputId: string;
  copy: BackupCopy;
  hasLocalEnvelope: boolean;
  entryCount: number;
  busy: boolean;
  recoveryInput: string;
  acceptedFileTypes: string;
  onExport: () => void;
  onRecoveryInputChange: (value: string) => void;
  onImport: (file?: File) => void;
}) {
  if (hasLocalEnvelope) {
    return (
      <div className="backup-actions">
        <p>{copy.backupGuard}</p>
        <button type="button" onClick={onExport} disabled={busy}>
          {busy ? copy.checkingBackup : copy.exportBackup}
        </button>
      </div>
    );
  }

  if (entryCount > 0) {
    return <p className="backup-note">{copy.emptyDeviceOnly}</p>;
  }

  const importDisabled = busy || !recoveryInput.trim();
  return (
    <div className="backup-actions">
      <p>{copy.backupNeeds}</p>
      <label htmlFor={`${inputId}-code`}>{copy.recoveryCode}</label>
      <input
        id={`${inputId}-code`}
        value={recoveryInput}
        onChange={(event) => onRecoveryInputChange(event.target.value)}
        placeholder="XXXXX-XXXXX-…-XX"
        autoComplete="off"
        spellCheck={false}
      />
      <label className={`backup-file-button ${importDisabled ? "disabled" : ""}`}>
        {busy ? copy.checkingBackup : copy.importBackup}
        <input
          type="file"
          accept={acceptedFileTypes}
          disabled={importDisabled}
          onChange={(event) => {
            onImport(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}
