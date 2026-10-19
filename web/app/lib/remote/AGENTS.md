# API transport and client contracts

Run npm commands from `web/`.

- Consult the Wiki's `API-Authentication.md`, `API-Sync-Protocol.md`, and `Account-and-Sync.md`.
- Preserve cookie credentials, account binding, Origin/CSRF protection, and error handling. Authentication does not unlock a vault.
- Preserve revisions, operation-ID idempotency, opaque cursors, and conflict handling. Coordinate changes with the synchronization engine and vault layer.
- `api.types.ts` is generated from `Miroven-API/contracts/api.d.ts`; do not edit it manually.
- Update API source and generate its contracts first. Then run `npm run api:generate` and `npm run api:check` from `web/`.
- Verify affected callers, transport tests, and actual API integration for changed authentication/synchronization behavior. Report unavailable API checkouts or integration environments.
