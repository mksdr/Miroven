# Miroven development guide

## Scope and workflow

- Miroven is a local-first personal journal client. Application code and npm commands live in `web/`.
- The sibling `../Miroven-API/` provides authentication, encrypted synchronization, and blob storage. `../Miroven-Web/` is the public website.
- Keep changes focused, preserve existing work, and avoid unrelated refactors or dependency updates.
- For cross-cutting changes, identify affected contracts and verification steps first. Record material decisions, remaining work, and observed results in the task plan.
- Follow scoped guides in `web/AGENTS.md`, `web/app/lib/vault/AGENTS.md`, and `web/app/lib/remote/AGENTS.md`. Consult them also when changes elsewhere affect their guarantees.

## Technical documentation

- **You may use Miroven.wiki as technical documentation.** The local checkout is `../Miroven Wiki/Miroven.wiki/`; the online version is <https://github.com/mksdr/Miroven/wiki>.
- These paths are relative to this repository root. Use the online Wiki if the local checkout is unavailable.
- Read only relevant pages: `Architecture.md` for boundaries, `Client-Development.md` for setup/checks, and `Security-Model.md` for security. Scoped guides reference additional topics.
- Update corresponding English and Korean Wiki pages when documented behavior or contracts change. Explain documentation/code discrepancies and assess compatibility before changing either.

## Shared guarantees

- Encrypt/decrypt journal content and photos on the device. Never send plaintext content, PINs, recovery codes, or keys to the API or diagnostic logs.
- Authentication and vault unlocking are separate. Preserve account/API-specific vault isolation and clear decrypted caches on lock/logout.
- Changes to AAD, database identifiers, encryption, or backup formats require explicit migrations and compatibility checks.
- Preserve pending synchronization work and conflict data. Failed synchronization must not destroy local data.

## Data and reporting

- Use synthetic data. Preserve existing `.env` files and local data; do not delete databases, volumes, or vaults as routine cleanup.
- Follow `CONTRIBUTING.md`, `SECURITY.md`, licenses, and third-party notices. Keep secrets and personal data out of artifacts, logs, and commits.
- Report commands, passes, failures, skips, and environment limitations separately. Skips are not passes. For cross-repository integration, record both tested commits and relevant uncommitted changes.
