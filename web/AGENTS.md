# Web application development

Run commands from `web/`. Check `package.json` for scripts and `../.github/workflows/ci.yml` for CI behavior.

## Implementation

- Preserve the static build and local-only operation when no API URL is configured.
- The Service Worker must not cache API, session, or blob responses.
- Consult the Wiki's `Client-Development.md` for setup, `Image-Processing.md` for images, `Entry-Quotes.md` for quotes, and `Profile-Document.md` for profiles.
- Consult the vault and remote scoped guides for persistence, encryption, authentication, and synchronization changes, including related changes in hooks or the synchronization engine.

## Verification

- For ordinary code changes, run `npm run verify:fast`. Add meaningful regression coverage for behavior changes; reproduce bugs before fixing them when practical.
- For UI/state changes, verify relevant unit tests and Playwright flows. For rendering/static-delivery changes, also check the build and rendered output.
- For broad changes and final application verification, run `npm run verify:full`.
- `verify:full` does not include `api:check` or configure actual API integration. Run these separately when affected.
- For contract changes, run `npm run api:check` against the generated sibling API contract.
- For authentication, synchronization, or account-flow changes, prepare the Wiki's development stack, set `MIROVEN_INTEGRATION_URL`, and run `npm run test:integration`. Follow the Wiki for split-origin configuration.
- Missing integration configuration causes skips. Check integration actually ran, even when CI is green. Use development services and synthetic accounts, never production services.
- Preserve the framework-managed block below and follow the installed Next.js documentation.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
