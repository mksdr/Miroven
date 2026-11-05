# Miroven HEIC vendor build

This directory contains a **Miroven-built**, modified distribution of:

* heic-to 1.5.2 — LGPL v3 (upstream metadata: LGPL-3.0)
* libheif 1.22.2 — LGPL v3 or later
* libde265 1.0.16 — LGPL v3 or later

These components retain their original licenses; they are not relicensed by
Miroven's root AGPL license. Fixed source archives, their provenance and all
artifact/recipe hashes are in `manifest.json` and `sources/`. Library copyright
and complete LGPL/GPL texts are preserved by the existing notice system in
`web/scripts/notice-sources/` and `/notice`; heic-to/LICENSE is also in its source
archive. The compiler runtime notices are listed separately in the manifest.

`tools/heic/README.md` at the repository root describes rebuilding and replacing
these files. The dated patch and module adapter are Miroven modifications; the
native decoder algorithms are unchanged. No native probe marker belongs in this
directory. Technical checks do not constitute legal compliance certification.

한국어: 원래 라이선스를 유지하는 자체 빌드 배포본입니다. 소스·패치·재결합 안내는
저장소 루트의 `tools/heic/README.md`, 고지 원문은 기존 `/notice` 체계를 참조하세요.
