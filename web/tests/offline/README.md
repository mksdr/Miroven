# Offline and update delivery checks / 오프라인·업데이트 검증

Run `npm run build` followed by `npm run test:offline`. Chromium is required. The app journeys use the HTTPS production build; `updates.spec.ts` additionally serves two small synthetic builds on an isolated loopback origin with the actual Service Worker source.

Root navigations revalidate with the network first, including HTTP-cache revalidation. Network failures and non-success HTTP responses fall back to the currently installed build. Network HTML never overwrites that build's cached HTML: installation must precache the entire new shell and executable asset list before activation. Unhashed shell files also use network first; content-addressed JS/CSS reuse installed caches. API, session and blob responses are never cached.

A newly activated worker does not reload existing documents. Older app caches remain available for their lazy chunks. Cleanup is conservative: the worker snapshots obsolete cache names at activation and removes them only when no other window can depend on them. A worker restart loses that cleanup snapshot, so retained caches can survive until a later activation. Navigation must never delete a newer worker's installing cache. Unknown executable URLs go to the network without being added to a cache; unrelated caches are never read or deleted.

The update regression covers A installation, B navigation while B installation is incomplete, A offline fallback, successful B activation, A draft preservation and lazy import after takeover, B offline reload, and obsolete-cache cleanup after the old tab closes. Existing journeys also verify encrypted journal persistence and account/backup operations offline.

Deploy complete build outputs consistently and keep content-addressed assets available for online documents using older builds. These checks do not simulate a CDN serving HTML and Service Worker files from mismatched deployments. The original PR's startup timings predate this navigation-strategy change; rerun performance measurements before claiming those timings for the updated code.

## 한국어

`npm run build` 후 `npm run test:offline`을 실행합니다. Chromium이 필요합니다. 앱 시나리오는 HTTPS 프로덕션 빌드를 사용하고, `updates.spec.ts`는 별도의 루프백 주소에서 실제 Service Worker 소스와 합성 A/B 빌드를 제공합니다.

첫 화면 탐색은 HTTP 캐시 재검증을 포함한 Network First 방식입니다. 네트워크 실패나 성공이 아닌 HTTP 응답이면 현재 설치된 빌드로 대체합니다. 온라인 HTML은 설치된 빌드의 캐시를 덮어쓰지 않습니다. 새 빌드의 화면과 실행 자산 전체가 캐시된 뒤에만 활성화합니다. 해시가 없는 셸 파일도 네트워크를 우선하고, 콘텐츠 주소로 구분된 JS/CSS는 설치된 캐시를 재사용합니다. API·세션·블롭 응답은 캐시하지 않습니다.

새 워커가 활성화되어도 기존 화면을 강제로 새로고침하지 않습니다. 기존 탭의 지연 로딩을 위해 이전 앱 캐시를 보존합니다. 활성화 시점에 기록한 이전 캐시만 정리 대상으로 삼고, 이를 사용할 다른 창이 없는 경우에만 삭제합니다. 워커 프로세스가 재시작되면 이 목록이 사라지므로 다음 활성화까지 캐시가 남을 수 있습니다. 탐색 중 더 새로운 워커가 설치 중인 캐시를 삭제하지 않습니다. 캐시에 없는 실행 자산은 네트워크로 전달하고 저장하지 않으며, 다른 앱의 캐시는 조회하거나 삭제하지 않습니다.

회귀 테스트는 A 설치, B 설치 미완료 상태의 최신 B 탐색, 오프라인 A 복귀, B 활성화, 기존 A 탭의 초안과 지연 import 보존, B 오프라인 새로고침, 이전 탭 종료 후 캐시 정리를 검증합니다. 기존 시나리오는 암호화된 일기의 보존과 오프라인 계정·백업 기능도 확인합니다.

완전한 빌드 산출물을 일관되게 배포하고, 이전 온라인 화면이 참조하는 콘텐츠 주소 기반 자산도 제공해야 합니다. 이 검증은 CDN이 서로 다른 배포의 HTML과 Service Worker를 섞어 제공하는 경우까지 모의하지 않습니다. 기존 PR의 시작 성능 수치는 탐색 전략 보완 전 측정값이므로, 최신 코드의 수치로 주장하려면 성능을 다시 측정해야 합니다.
