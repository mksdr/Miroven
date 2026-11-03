# Offline and update delivery checks / 오프라인·업데이트 검증

Run `npm run build` followed by `npm run test:offline`. Chromium, WebKit and OpenSSL are required. The app journeys use the HTTPS production build; `updates.spec.ts` additionally serves two small synthetic builds on an isolated loopback origin with the actual Service Worker source.

Run `npm run test:updates` for the real Next.js A/B build regression (also included in `npm run verify:full`, and therefore CI). It builds two isolated source copies with the normal production build and CSP/Service Worker finalizers, then serves the outputs on the same HTTPS origin. Chromium and OpenSSL are required. Outputs are kept in the ignored `.local/update-builds/`; the checkout's app source, `.env` files, `.next/` and `out/` are not changed. The fixtures use local-only mode and share installed dependencies.

Only the fixture copies receive an A/B attribute in the lazy Account component. This source change must produce different Account chunk URLs and build-hash caches; the test fails if it does not. After B takes control, the server no longer provides A assets. The test clears the HTTP cache, goes offline, opens the previously unopened A Account, verifies its A chunk came from the Service Worker, exports an encrypted backup, and checks B's Account after an offline reload. A document token and draft assertions also detect an unwanted reload or lost draft. These are two production compilations of the current app with controlled source differences, not historical release or CDN compatibility tests.

Root navigations revalidate with the network first, including HTTP-cache revalidation. Network failures and non-success HTTP responses fall back to the currently installed build. Non-navigation GET requests to `/`, including queries and alternate-representation headers, are left to the browser and never receive cached shell HTML. They can fail offline even while root navigation remains available. Network HTML never overwrites that build's cached HTML: installation must precache the entire new shell and executable asset list before activation. Unhashed shell files also use network first; content-addressed JS/CSS reuse installed caches. API, session and blob responses are never cached.

A newly activated worker does not reload existing documents. Older app caches remain available for their lazy chunks. Cleanup is conservative: the worker snapshots obsolete cache names at activation and removes them only when no other window can depend on them. A worker restart loses that cleanup snapshot, so retained caches can survive until a later activation. Navigation must never delete a newer worker's installing cache. Unknown executable URLs go to the network without being added to a cache; unrelated caches are never read or deleted.

The update regression covers A installation, B navigation while B installation is incomplete, A offline fallback, successful B activation, A draft preservation and lazy import after takeover, B offline reload, and obsolete-cache cleanup after the old tab closes. Existing journeys also verify encrypted journal persistence and account/backup operations offline.

Deploy complete build outputs consistently and keep content-addressed assets available for online documents using older builds. These checks do not simulate a CDN serving HTML and Service Worker files from mismatched deployments. The original PR's startup timings predate this navigation-strategy change; rerun performance measurements before claiming those timings for the updated code.

The photo Worker regression runs in Chromium and iPhone-emulated WebKit. It waits for Service Worker installation/control over HTTPS, reloads, forces Canvas to return PNG, and verifies actual WebP WASM encoding through the cached Worker. Cached Worker responses retain their body, status and CSP/MIME headers but omit the original response URL, preserving the requested URL's `#params` bootstrap configuration in Safari. This does not verify offline WASM availability or physical devices.

## 한국어

사진 Worker 회귀 검사는 Chromium과 iPhone 모의 WebKit에서 실행합니다. HTTPS에서 Service Worker 설치·제어와 새로고침을 완료한 뒤 Canvas가 PNG를 반환하도록 강제하여 실제 WebP WASM 변환을 검증합니다. 캐시된 Worker 응답은 본문·상태·CSP/MIME 헤더를 유지하되 원래 응답 URL 없이 제공하여 Safari에서도 요청 URL의 `#params` 초기화 정보를 보존합니다. WASM 파일의 오프라인 가용성이나 실기기 호환성까지 검증하는 것은 아닙니다.

`npm run build` 후 `npm run test:offline`을 실행합니다. Chromium·WebKit·OpenSSL이 필요합니다. 앱 시나리오는 HTTPS 프로덕션 빌드를 사용하고, `updates.spec.ts`는 별도의 루프백 주소에서 실제 Service Worker 소스와 합성 A/B 빌드를 제공합니다.

실제 Next.js A/B 빌드 회귀 검사는 `npm run test:updates`로 실행합니다. `npm run verify:full`과 CI에도 포함됩니다. 격리된 소스 복사본 두 개를 일반 프로덕션 빌드 및 CSP·Service Worker 후처리로 빌드하고, 같은 HTTPS 주소에서 차례로 제공합니다. Chromium과 OpenSSL이 필요합니다. 산출물은 Git에서 제외되는 `.local/update-builds/`에 보관하며, 원본 앱 소스·`.env` 파일·`.next/`·`out/`은 변경하지 않습니다. 테스트 빌드는 로컬 전용 모드를 사용하고 설치된 의존성을 공유합니다.

테스트 복사본의 지연 로딩 계정 컴포넌트에만 A/B 속성을 추가합니다. 이 소스 변경으로 계정 청크 URL과 빌드 해시 캐시가 달라지지 않으면 검사를 실패시킵니다. B가 제어권을 넘겨받으면 서버는 A 자산을 제공하지 않습니다. HTTP 캐시를 비우고 오프라인으로 전환한 뒤, 아직 열지 않은 A 계정 화면을 처음 열어 A 청크가 Service Worker에서 제공되는지 확인하고 암호화 백업을 내보냅니다. B의 오프라인 새로고침과 계정 화면도 검증합니다. 기존 문서 표식과 초안 검사로 원치 않는 새로고침과 초안 유실을 확인합니다. 현재 앱에 통제된 소스 차이를 준 실제 프로덕션 컴파일 두 개를 검증하며, 과거 릴리스나 CDN 호환성 검사까지 포함하지는 않습니다.

첫 화면 탐색은 HTTP 캐시 재검증을 포함한 Network First 방식입니다. 네트워크 실패나 성공이 아닌 HTTP 응답이면 현재 설치된 빌드로 대체합니다. 쿼리나 다른 응답 표현을 요청하는 헤더가 있는 경우를 포함하여 `/`에 대한 비탐색 GET 요청은 브라우저에 맡기며 캐시된 셸 HTML로 대체하지 않습니다. 따라서 첫 화면 탐색이 가능해도 비탐색 요청은 오프라인에서 실패할 수 있습니다. 온라인 HTML은 설치된 빌드의 캐시를 덮어쓰지 않습니다. 새 빌드의 화면과 실행 자산 전체가 캐시된 뒤에만 활성화합니다. 해시가 없는 셸 파일도 네트워크를 우선하고, 콘텐츠 주소로 구분된 JS/CSS는 설치된 캐시를 재사용합니다. API·세션·블롭 응답은 캐시하지 않습니다.

새 워커가 활성화되어도 기존 화면을 강제로 새로고침하지 않습니다. 기존 탭의 지연 로딩을 위해 이전 앱 캐시를 보존합니다. 활성화 시점에 기록한 이전 캐시만 정리 대상으로 삼고, 이를 사용할 다른 창이 없는 경우에만 삭제합니다. 워커 프로세스가 재시작되면 이 목록이 사라지므로 다음 활성화까지 캐시가 남을 수 있습니다. 탐색 중 더 새로운 워커가 설치 중인 캐시를 삭제하지 않습니다. 캐시에 없는 실행 자산은 네트워크로 전달하고 저장하지 않으며, 다른 앱의 캐시는 조회하거나 삭제하지 않습니다.

회귀 테스트는 A 설치, B 설치 미완료 상태의 최신 B 탐색, 오프라인 A 복귀, B 활성화, 기존 A 탭의 초안과 지연 import 보존, B 오프라인 새로고침, 이전 탭 종료 후 캐시 정리를 검증합니다. 기존 시나리오는 암호화된 일기의 보존과 오프라인 계정·백업 기능도 확인합니다.

완전한 빌드 산출물을 일관되게 배포하고, 이전 온라인 화면이 참조하는 콘텐츠 주소 기반 자산도 제공해야 합니다. 이 검증은 CDN이 서로 다른 배포의 HTML과 Service Worker를 섞어 제공하는 경우까지 모의하지 않습니다. 기존 PR의 시작 성능 수치는 탐색 전략 보완 전 측정값이므로, 최신 코드의 수치로 주장하려면 성능을 다시 측정해야 합니다.
