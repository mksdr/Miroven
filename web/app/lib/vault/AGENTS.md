# Vault implementation

Wiki filenames refer to the checkout described in the repository-root guide.

- Consult `Cryptographic-Format.md` and `Backup-and-Restore.md` for encryption, IndexedDB, and backups; consult `Profile-Document.md` for the reserved profile document.
- Preserve AAD, identifiers, encoding, and ciphertext/backup compatibility. Introduce explicit migrations when persisted formats change.
- Keep encrypted records and pending Outbox operations consistent. Preserve conflict content and unsent work during recovery.
- Treat cursors as opaque strings; persist them only after corresponding local changes commit.
- Stage all snapshot pages before final reconciliation. Failure must preserve existing records and pending work.
- Preserve mutation locking, account isolation, and decrypted-cache cleanup.
- Verify relevant tests in `web/tests/`, including legacy compatibility, backup/restore round trips, and failure-path data preservation when affected.
