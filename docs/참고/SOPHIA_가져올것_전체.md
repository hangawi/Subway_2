# SOPHIA에서 가져올 것 — 전체 점검

> 2026-10-08, SOPHIA main `145d996` 기준. **10/9 점검으로 `f07014b`, 10/12 점검으로 `7e92f09`, 10/13 점검으로 `1e274c7`, 10/14 작업 중 `cda9662`까지 반영** (저녁 식사 기능 추가, 공통 엔진은 그대로). 소스 파일 284개(시험 제외)를 하나씩 확인했다.
> 공통 엔진(`pure_engine/`, `decision-contract.ts`)은 우리가 가져온 `f2f5081` 이후 바뀐 곳이 없다.
> ✅ 원래 목록에 있던 것 / 🆕 이번 점검에서 새로 찾은 것 / ❌ 가져오지 않는 것

---

## 1. 판단 엔진·규칙

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | 공통 엔진 | `pure_engine/` | 매장·메뉴 판단 | 10/7 (완료) |
| ✅ | 엔진 입출력 규칙 | `packages/contracts/src/decision-contract.ts` | 〃 | 10/7 (완료) |
| ✅ | 어댑터 등록부 | `domains/registry.ts` | 어댑터 2개 등록 | 10/13 |
| ✅ | 영업시간 판단 | `domains/scheduling/opening-hours.ts` | 매장 영업 중인지 | 10/12 ✅ |
| 🆕 | 말 → 행동 계획 | `domains/scheduling/words-plans.ts` | "빵은 위트로" → 옵션 수정 계획 (보여 주기 전에 코드가 맞춤) | 10/14 |
| 🆕 | 대화 속 조건 알아채기 | `domains/scheduling/talk-conditions.ts` | 말 속에서 예산·알레르기 알아채는 방식 본보기 | 10/14 |
| 🆕 | 지원 안 하는 요청 막기 | `runtime/edge_registry/local-text-adapter.ts` | "배달해 줘" 같은 안 되는 요청을 된다고 치지 않음 | 10/14 |
| 🆕 | 먼저 알리기 | `domains/scheduling/proactive-notices.ts` | "11시 지나면 아침 메뉴 끝나요" 같은 안내 본보기 | 10/29 (선택) |

## 2. 외부 데이터 연결

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | 카카오 로컬 | `services/providers/kakao-local-provider.ts` | 주변 써브웨이·주소 → 좌표 | 10/12 ✅ |
| ✅ | Google Places | `services/providers/google-places-provider.ts` | 영업시간 | 10/12 ✅ |
| ✅ | ODsay + 하루 사용량 | `services/providers/odsay-transit-provider.ts`, `daily-quota.ts` | 대중교통 시간 | 10/12 ✅ |
| ✅ | 카카오모빌리티 | `services/providers/kakao-mobility-provider.ts` | 차 시간 | 10/12 ✅ |
| ❌ | 연결 묶음·가짜 연결 | `services/providers/registry.ts`, `place-providers.ts`, `mock-adapters.ts` | 연결 관리 | 안 가져옴 (10/12): `place-providers.ts`는 등산로·공연 등 안 쓰는 연결까지 딸려 옴 → 연결을 직접 만듦(`scripts/check-live.ts`). 가짜 연결은 시험용 장소 데이터로. `registry.ts`는 AI 연결과 함께 10/14 |
| 🆕 | **공통 연결 도구** | `services/providers/place-data-provider.ts` | 위 연결들이 모두 쓰는 요청·실패·시각 기록 함수. **이것 없이는 위 연결이 안 돌아감** | 10/12 ✅ |
| ✅ | 장소 규칙 | `packages/contracts/src/place-contract.ts`, `provider-contract.ts` | 매장 데이터 형식 | `place-contract` 10/12 ✅, `provider-contract`는 AI 연결과 함께 10/14 |
| ✅ | 서울 시각 | `apps/client-pwa/src/seoul-time.ts` | 아침·점심·저녁 | 10/12 ✅ |
| 🆕 | 시험용 장소 데이터 | `packages/test-support/scripted-places.ts` | 키 없이 매장 찾기 시험 ("시험용 자료"로 표시) | 10/12 ✅ |
| 🆕 10/9 | **TMAP 도보 경로** | `services/providers/tmap-walk-provider.ts` (키 `SOPHIA_TMAP_API_KEY`, 하루 한도 `SOPHIA_TMAP_DAILY_LIMIT`) | 매장까지 **걸어서 몇 분**을 실제 길로 (직선 거리 추정 대신). 키 없으면 직선 거리로 | 10/12 ✅ (서버에도 키 없음 → 직선 거리 추정) |
| 🆕 10/9 | ODsay 시간표 확인 | `services/providers/odsay-schedule.ts`, `packages/contracts/src/transit-contract.ts` | (선택) 대중교통 시간을 시간표로 확인 | 10/12 ✅ |
| 🆕 10/9 | 식당 찾기 반경 넓히기 방식 | `services/group/dinner-venue-search.ts` | 근처 매장이 적을 때만 반경 넓히기, 지어낸 매장 0 | 10/12 ✅ (본보기로 참고만) |
| 🔄 10/9 | 바뀐 연결 코드 | `google-places-provider.ts`(가격대·채식·예약 가능 정보 추가), `kakao-local-provider.ts`, `odsay-transit-provider.ts`, `place-data-provider.ts`, `place-contract.ts`, `scripted-places.ts` | 10/12에 **10/8 이후 최신판으로** 가져오기 | 10/12 ✅ |
| ❓ | 기상청 날씨 | `services/providers/kma-weather-provider.ts` | (선택) 비 오면 가까운 매장 우선 | 10/30 (선택) |

## 3. AI

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | AI 라우터·대기열·사용량 | `runtime/ai_router/` | A100 먼저, 안 되면 OpenAI | 10/14 |
| ✅ | AI 연결 | `services/providers/openai-responses-provider.ts`, `ollama-chat-provider.ts`, `services/ai/config.ts` | gemma·gpt-5-mini | 10/14 |
| ✅ | 해석 서비스·API | `services/ai/interpret-service.ts`, `apps/server/src/interpret-http.ts` | 말 → 조건 | 10/14 |
| 🆕 | **해석 흐름 전체** | `runtime/core/interpret-utterance.ts`, `context-selector.ts`, `action-resolver.ts` | 필요한 앞 대화만 고르기 → AI → 형식 검사 → 행동으로 맞추기 | 10/14 |
| ✅ | 해석·행동 규칙 | `packages/contracts/src/ai-contract.ts`, `interpretation-contract.ts`, `action-contract.ts` | "AI는 말만 옮김" | 10/14 |
| 🔄 10/9 | 바뀐 해석 코드 | `runtime/core/interpret-utterance.ts`, `services/ai/interpret-service.ts`, `interpretation-contract.ts`, `action-contract.ts`, `interpret-api-contract.ts`, `services/client/interpret-api.ts` | 10/14에 **최신판으로** 가져오기 | 10/14 |
| 🆕 10/9 | **식사 조건 형식** | `packages/contracts/src/dinner-conditions.ts` (인원·예산(1인/합계)·식이 조건) | 써브웨이 해석 형식(예산·식이 조건) 본보기, 8단계 여러 명(10/22에 9단계 → 8단계)의 "1인/합계 예산" 본보기 | 10/14 (본보기) |
| 🆕 10/9 | 식사 조건 점검 원칙 | `domains/scheduling/dinner-food-conditions.ts` | "가격대·채식 표시는 힌트일 뿐, 알레르기 증거가 아님" — 써브웨이 알레르기 표시 원칙과 같음 | 10/13 (본보기) |
| 🆕 10/9 | 식사 문장 시험 도구 | `scripts/ai-dinner-eval.ts` | 문장 시험(29번) 본보기 | 10/27 |
| 🆕 | 해석 API 규칙·화면 쪽 연결 | `packages/contracts/src/interpret-api-contract.ts`, `services/client/interpret-api.ts` | 화면 → 서버 해석 요청 | 10/14 |
| ✅ | 대화 기억 | `services/client/conversation-memory.ts`, `conversation-memory-ui.ts` | "아까 거기서 소스만 바꿔" | 10/14 |
| ✅ | 사용 기록 | `services/ai/usage-jsonl-sink.ts` | AI 사용량 | 10/14 |
| 🆕 | **시험용 AI (네트워크 없음)** | `packages/test-support/scripted-interpreter.ts` | AI 없이 대화 시험 | 10/14 |
| 🆕 | **문장 시험 도구** | `scripts/ai-eval.ts`, `scripts/fixtures/c-eval-samples.ts`, `scripts/ai-smoke.ts` | 문장 100개 정확도·응답 시간 (로드맵 29번) | 10/14 (도구), 10/27 (시험) |
| ✅ | 말 받아쓰기 | `services/providers/openai-transcription-provider.ts`, `services/ai/media-service.ts` | (선택) 말로 주문 | 10/14 |
| 🆕 | 말·사진 API | `apps/server/src/media-http.ts`, `services/client/media-api.ts`, `packages/contracts/src/media-contract.ts` | 말로 주문할 때 녹음 보내기 | 10/14 (말 입력을 넣으면) |

> 🔄 10/14: 3절 AI는 13개 가져옴(`vendor/sophia`). 해석 흐름·4절 화면은 일정 기능에 묶여 써브웨이용을 새로 씀(`src/conversation/`, `src/web/`). 처리 표: 10/14 할일 1절. 🆕 `cda9662`(iPhone 홈 화면 앱 손보기, `page-gestures.ts`)는 10/19 실기기에서 확인.

## 4. 화면

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | 앱 틀 | `apps/client-pwa/src/main.ts`, `sw.ts`, `styles.css`, `index.html` | 화면 바탕 | 10/14 |
| 🆕 | **앱 빌드** | `scripts/build.ts` | 화면 묶기·폰트(Pretendard) 나눠 싣기 | 10/14 |
| 🆕 | 앱 아이콘·설치 정보 | `apps/client-pwa/public/manifest.webmanifest`, `icons/` | 홈 화면 설치 (써브웨이용으로 바꿈) | 10/14 |
| 🆕 | 앱 버전 맞추기 | `packages/contracts/src/client-version.ts`, `sw-policy.ts`, `services/client/client-version.ts` | 예전 버전 앱이 잘못 쓰는 것 막기 | 10/14 |
| ✅ | 설치·업데이트·카톡 열기 | `runtime/execution/` | 홈 화면 설치, 카톡 링크 | 10/14 |
| ✅ | 추천 카드 | `apps/client-pwa/src/place-candidate-ui.ts`, `time-candidate-ui.ts` | 매장·메뉴 카드 | 10/14 |
| 🆕 | **[설명] 버튼** | `apps/client-pwa/src/info-ui.ts` | 카드 옆 [왜?] — 무엇을 보냈고 왜 골랐는지 | 10/14 |
| 🆕 | **글·말로 하는 행동** | `apps/client-pwa/src/words-actions-ui.ts` | 말로 옵션 수정 → 확인 → 적용 (버튼과 같은 동작) | 10/14 |
| ✅ | 말·사진·글 버튼, 생각 중 | `sophia-fab-ui.ts`, `sophia-fab-target.ts`, `media-input-ui.ts`, `ai-thinking.ts` | 말로 조건 넣기 | 10/14 |
| 🆕 | 쓰던 글 지키기 | `apps/client-pwa/src/drafts.ts`, `panel-ui.ts` | 입력 중인 글이 화면 바뀌어도 안 사라짐 | 10/14 |
| 🆕 | 설정 화면 | `apps/client-pwa/src/settings-ui.ts` | 동의 끄기·내 기록 지우기 | 10/19 |
| ✅ | 오프라인·보내기 대기 | `services/client/outbox.ts`, `outbox-ui.ts`, `packages/contracts/src/outbox-contract.ts` | 끊겨도 화면 유지 | 10/15 |
| 🆕 | **기기 저장소** | `services/client/local-edge-vault.ts`, `packages/contracts/src/client-storage-schema.ts` | **주문 기록 휴대폰 저장** (10/19 판은 로그인 없음, 9단계 SOPHIA 연동에서 계정으로) | 10/15 |
| 🆕 | 기다리는 작업 알림 | `apps/client-pwa/src/identity-events.ts` | AI 요청 중 화면 이동 막기 | 10/14 |
| 🆕 10/9 | **한 번에 한 단계 화면** | `apps/client-pwa/src/task-section-ui.ts` | 시간·위치 → 매장 → 메뉴 → 옵션을 한 단계씩, 돌아와도 입력 유지 | 10/14 |
| 🆕 10/9 | 설치 첫 안내 | `apps/client-pwa/src/install-welcome-ui.ts` | 처음 들어왔을 때 홈 화면 설치 안내 한 번 | 10/14 |
| 🆕 10/12 | 빈 화면 표시 | `apps/client-pwa/src/empty-state-ui.ts` | "근처에 써브웨이가 없어요"·"조건에 맞는 메뉴가 없어요" 같은 빈 상태 | 10/14 |
| 🆕 10/12 | 요약 → 한 작업 열기 | `apps/client-pwa/src/task-entry-ui.ts` | 단계 요약에서 한 단계를 열고, 입력은 유지 | 10/14 |
| 🆕 10/12 | iPhone 키보드 위 입력칸 | `apps/client-pwa/src/chat-viewport.ts` | 말·글로 조건 넣을 때 iPhone 키보드에 입력칸이 안 가려지게 | 10/14 |
| 🔄 10/12 | 바뀐 화면 공통 | `main.ts`, `styles.css`, `sw.ts`, `install-welcome-ui.ts`, `panel-ui.ts`, `sophia-fab-ui.ts`, `media-input-ui.ts`, `scripts/build.ts`, `scripts/e2e-server.ts` | 10/14에 최신판으로 | 10/14 |
| ✅ | 동의 화면·문구 | `consent-ui.ts`, `consent-copy.ts` | 위치·알레르기·주문 기록 동의 | 10/15 |
| 🆕 10/9 | 처음 동의 묶음 | `apps/client-pwa/src/signup-consents.ts` (+ 바뀐 `consent-ui.ts`·`consent-copy.ts`) | 처음 쓸 때 지금 쓸 수 있는 기능만 동의받기 | 10/15 |
| 🔄 10/12 | 바뀐 동의·저장 | `consent-ui.ts`, `consent-copy.ts`, `signup-consents.ts`, `services/client/local-edge-vault.ts`, `outbox-ui.ts` | 10/15에 최신판으로 | 10/15 |
| 🆕 | **개인정보 처리방침 본보기** | `apps/client-pwa/public/privacy.html` | 써브웨이용 처리방침의 바탕 | 10/19 |
| 🆕 | 디자인 규칙 | SOPHIA 저장소 `CLAUDE.md`, `sophia/docs/design/` (버튼 수 등) | 화면을 SOPHIA와 같은 느낌으로 | 10/14 |

## 5. 주문·결제 (SOPHIA 예약 구조) — 10단계, 무기한 연기

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | 승인 → 실행 → 결과 확인 | `services/group/reservation-service.ts` | 주문서 승인 → 전달 | 무기한 연기 |
| ✅ | 실행 연결 (MANUAL) | `services/providers/reservation-adapter.ts` | 주문서 복사·전화로 넘기고 기록 | 무기한 연기 |
| ✅ | 규칙·승인 확인·화면 | `reservation-contract.ts`, `action-contract.ts`, `state/emotion/execution-approval.ts`, `reservation-ui.ts` | 승인 없이는 실행 안 함 | 무기한 연기 |
| 🆕 | **시험용 예약 API** | `packages/test-support/scripted-reservations.ts` | 주문 연결 시험 ("시험용"으로 표시) | 무기한 연기 |

## 6. 서버·DB·운영

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | 서버 | `apps/server/src/server.ts`, `main.ts`, `client-address.ts` | 써브웨이 서버 | 10/13 |
| ✅ | DB | `db/postgres/database.ts`, `migrate.ts` | 주문·기록 | 10/13 |
| 🆕 | **DB 단계 관리** | `db/postgres/migrations/`(방식), `scripts/migrate-postgres.ts`, `scripts/check-migrations.ts` | DB 바꿀 때 순서·버전 검사 | 10/13 |
| 🆕 | **시험용 DB** | `packages/test-support/identity-database.ts` | 진짜 DB 없이 SQL 시험 (PostgreSQL WASM) | 10/13 |
| ✅ | Docker·배포·DB 배포 | `Dockerfile`, `.github/workflows/deploy.yml`, `migrate.yml` | push하면 배포 | 10/13 |
| 🆕 | **nginx 설정 본보기** | `infrastructure/proxy/sophia-location.conf.example` | `subway.metasolveai.com` → 4174 연결 | 10/13 |
| 🆕 | 스테이징 설정 | `infrastructure/compose/staging.compose.yml`, `staging.env.example` | 운영 전 시험 서버 | 10/13 (필요하면) |
| ✅ | 연결 점검 | `check-connections.yml`, `scripts/check-connections.ts`, `services/operations/connection-check.ts` | 카카오·Google·AI 확인 | 10/13 |
| ✅ | 구조 검사 | `scripts/architecture-check.ts` | 엔진 규칙 위반 막기 | 10/13 |
| 🆕 | 계약 검사 | `scripts/check-contracts.ts` | 입출력 규칙이 서로 맞는지 | 10/13 |
| 🆕 10/12 | **배포 확인 단계** | `.github/workflows/deploy.yml`의 "Verify live commit and readiness" (`/health`·`/ready`·`/version.json`의 커밋이 배포한 커밋과 같은지 12번까지 확인) | 써브웨이 자동 배포 끝에 같은 확인 | 10/13 |
| ✅ | 권리 요청·계정 삭제 | `services/identity/rights-service.ts`, `services/operations/account-deletion.ts` | 내 정보 보기·지우기 | 10/19 |
| 🆕 | 권리 요청 운영 처리 | `services/operations/rights-admin.ts`, `scripts/rights-admin.ts` | 운영자가 요청 처리 | 10/19 |
| 🆕 | 서버 점검 | `infrastructure/audit/server_s2_audit.py` | 디스크·컨테이너 상태 점검 | 10/19 |
| 🆕 | 백업 본보기 | `infrastructure/backup/sqlite-snapshot.py` + 김민지 20일차 백업 방식 | 서버 DB 백업 | 10/19 |

> 🔄 10/13: 6절 서버·배포는 SOPHIA 방식으로 **써브웨이용을 새로 씀** (`src/server/`, `Dockerfile`, `deploy/`, `.github/workflows/`, `scripts/check-connections.ts`·`architecture-check.ts`). DB 관련(`database.ts`·`migrate*`·시험용 DB)은 10/20, `client-address.ts`·스테이징·계약 검사는 보류 (이유: 10/13 할일 1절).

## 7. 시험

| | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|---|
| ✅ | 엔진·장소 시험 본보기 | `tests/unit/decision-engine.test.ts`, `places.test.ts` | 어댑터 시험 | 10/12~13 |
| ✅ | 화면 시험 (Playwright) | `playwright.config.ts`, `tests/e2e/` | 휴대폰 화면 시험 | 10/14 |
| 🆕 | 화면 시험용 서버 | `scripts/e2e-server.ts` | 메모리에서만 도는 시험 서버 | 10/14 |

## 8. 10/20 이후에 가져올 것 (🆕 10/22 순서 바꿈)

> 🆕 10/22 순서: 7.7 🎤 마이크·탭(10/22~10/23) → 7.8 서버 말 쌓기(10/26~10/27) → **8단계 여러 명**(10/28~10/30) → **9단계 SOPHIA 공통 계정·상태 연동은 보류** (예전 8단계). 10단계 주문·결제는 무기한 연기.
> 김민지 일정은 10/19(22일차)로 끝. 9단계(SOPHIA 연동)는 **51번 규격(10/20 협의)에 따라** SOPHIA 코드를 **복사해 오거나, SOPHIA 통로를 부르는 것**으로 바뀔 수 있다 — 계정·상태의 원본은 SOPHIA에 둔다.

| 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 날짜 |
|---|---|---|---|
| 공통 엔진 패키지 | (김민지가 `pure_engine/`·`decision-contract.ts`를 `sophia-engine`으로 떼면) | `vendor/sophia` 복사본 대신 (52번) | 9단계 (보류) |
| 계정 확인 | `services/identity/identity-service.ts`, `passkey-service.ts`, `config.ts`, `packages/contracts/src/identity-contract.ts`, `apps/server/src/identity-http.ts`, `services/client/identity-api.ts` | SOPHIA 계정으로 같은 사람 확인 (53번) | 9단계 (보류) |
| 앱 사이 이어받기 | `services/identity/entry-handoff-service.ts`, `packages/contracts/src/entry-handoff-contract.ts` | 일정 앱 → 써브웨이로 넘어올 때 계정 이어받기 (53번) | 9단계 (보류) |
| 패스키 시험 | `packages/test-support/soft-authenticator.ts` | 로그인 시험 | 9단계 (보류) |
| 로그인·복구 화면 | `apps/client-pwa/src/identity-ui.ts`, `recovery-ui.ts`, `recovery-offers-ui.ts`, `identity-events.ts` (복구 자체는 `recovery-service.ts`·`recovery-binding.ts`·`recovery-mail.ts` — SOPHIA 쪽에서) | [SOPHIA 계정으로 계속하기] (53번) | 9단계 (보류) |
| 쉬는 동안 잠그기 (10/9 🆕) | `runtime/execution/idle-session.ts` | 로그인 붙일 때 같이 | 9단계 (보류) |
| 허용 확인 (목적·대상·맥락·유효기간) | `state/emotion/authorize-processing.ts`, `authorized-view.ts`, `packages/contracts/src/evidence-contract.ts` | SOPHIA 상태를 쓸 수 있는지 확인 (54번) | 9단계 (보류) |
| 상태 → 판단 입력 | `state/emotion/build-decision-input.ts`, `packages/contracts/src/emotion-decision-contract.ts` | 오늘 상태·기분을 메뉴 점수로 (54번) | 9단계 (보류) |
| 오래된 상태 만료 | `state/emotion/time-dynamics.ts` | 오늘 상태 유효기간 (56번) | 9단계 (보류) |
| 보내기 대기 (다시 씀) | `services/client/outbox.ts` (10/15에 가져옴) | SOPHIA로 상태 보내기 실패 시 (55번) | 9단계 (보류) |
| 권리 요청 (다시 씀) | `services/identity/rights-service.ts` (10/19에 가져옴) | 써브웨이에서 지우면 SOPHIA에도 (55번) | 9단계 (보류) |
| 여러 명 | `domains/scheduling/attendance-words.ts`, `capacity.ts` | "3명이야" (59번) | 10/28~10/29 (8단계) |
| 친구 (선택) | `services/group/friend-service.ts`, `packages/contracts/src/friend-contract.ts`, `apps/client-pwa/src/friends-ui.ts` | 같이 먹는 사람이 SOPHIA 친구이고 동의했으면 그 사람 알레르기 (59~60번) | 10/28~10/29 (8단계, 선택) |
| 🆕 실시간 글자 (참고만) | `apps/client-pwa/src/media-input-ui.ts` (말하는 동안 1.5초마다 글자 보이기) | 7.7-1 화면 동작 본보기 — 받아쓰기는 OpenAI 그대로 (10/20 결정) | 10/22~10/23 (7.7) |
| 문장 시험 | `scripts/ai-eval.ts`, `scripts/ai-dinner-eval.ts`, `scripts/fixtures/c-eval-samples.ts` | 문장 100개 정확도 (29번) | 10/27 |
| 먼저 알리기 (선택) | `domains/scheduling/proactive-notices.ts` | "11시 지나면 아침 메뉴 끝나요" | 10/29 (선택, 예비일) |
| 기상청 날씨 (선택) | `services/providers/kma-weather-provider.ts` | 비 오면 가까운 매장 우선 | 10/30 (선택, 예비일) |
| 푸시 알림 | `services/providers/web-push.ts`, `services/group/push-service.ts`, `push-contract.ts`, `scripts/vapid-keys.ts`, `packages/test-support/push-receiver.ts` | 주문 상태 알림 | 무기한 연기 (10단계) |
| 알림함 | `services/group/notification-service.ts`, `notification-contract.ts`, `notifications-ui.ts` | 주문 알림 목록 | 무기한 연기 (10단계) |

> 🔄 10/13 점검: 엔진 그대로. 바뀐 54개 중 목록에 있는 20개는 가져오는 날 최신판으로 (10/13 `place-contract`, 10/14 해석·화면·디자인 규칙, 10/15 기기 저장소, 10/21 로그인 화면). 새로 생긴 `proposal-status.ts`·의견 조율·모임 공유·알림 종류는 일정 앱 전용이라 안 가져옴.

## 9. 가져오지 않는 것

| 것 | 이유 |
|---|---|
| 알림 예약·첨부·문장 다듬기·Google 달력(`reminder-*`, `message-attachments`, `rewrite-*`, `google-calendar*`) (10/12 추가), 모임 저녁 계획(`dinner-plan-*`, `dinner-cafe`, `dinner-transit`, `meeting-*`, `coordination-*`, `proposal-place-plan`, `home-coordination-ui`), 대화 도우미(`conversation-assist*`), 실시간 갱신(`live-updates`, `live-connection`) (10/9 추가), 모임·초대·QR·참석·정원·확정·달력·모임방 대화·공지 (`services/group/*` 대부분, `groups-ui`·`invite-ui`·`group-room-ui`·`calendar-*`·`attendance-*`·`finalization-*`·`meeting-calendar-ui`·`time-coordination-*`·`live-refresh` 등) | 일정 앱 전용 |
| 개인 Google Drive 백업 (`backup-crypto`, `backup-targets`, `backup-contract`, `account-data-ui`의 백업 부분, `oauth-google.*`) | 써브웨이에 맡길 데이터가 적음 |
| 감정 연구 시뮬레이션 (`state/emotion/simulation/`, `epdf-simulate.ts`, `epdf-signal-registry.ts`) | 연구용 |
| 등산로·자전거길·주차장·공연·영화·링크 읽기 (`*-trails`, `bike-*`, `parking-*`, `kopis`, `kobis`, `page-fetcher`) | 써브웨이와 무관 |
| 예전 시연·예전 코드 보존 스크립트 (`demo_*`, `verify-legacy-preservation`, `check-legacy-source`, `prepare-legacy-rollback`, `db/sqlite`) | SOPHIA 과거 기록용 |
| GPU 점검 (`infrastructure/local-ai/`) | 회사 서버 GPU 관리용, SOPHIA가 이미 함 |

## 🆕 10/20 점검 (a0195f9 → 6397fa3)
| 상태 | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 언제 |
|---|---|---|---|---|
| ⛔ 안 함 (10/20 예형님: OpenAI 그대로) | 🎤 받아쓰기를 **A100 whisper**로 (외부 유료 서비스 안 씀), 말하는 동안 1.5초마다 글자 보이기 | `services/ai/media-service.ts`, `apps/server/src/media-http.ts`(x-sophia-live), `apps/client-pwa/src/media-input-ui.ts`, `services/client/media-api.ts` | 🎤도 OpenAI 대신 A100 (10/19엔 "OpenAI 계속" 결정) — 써브웨이 A100 통로(지금 8022만)에 whisper 포트도 열어야 함 | 예형님 결정 뒤 |
- 그 밖(모임 대화·알림 탭·가입 승인 삭제·화면 문구)은 일정 앱 전용 → 써브웨이 영향 없음. 써브웨이가 가져다 쓴 32개 파일과 겹치는 것 없음

### 10/21 점검 (6397fa3 → fc347d9, 4개)

- 바뀐 것: 모임방을 카카오톡 모양으로(채팅 목록 같은 모임 목록, 대화 먼저), 대화 속 카드(지역 장소 후보 3곳·약속·참석 인원·캘린더 안내), 대화방 색을 소피아 색으로
- 써브웨이가 가져다 쓴 파일 중 `packages/contracts/src/place-contract.ts`만 바뀜 — 뒤에 **더하기만** 함(AreaPlaceKind·AreaPlacesView·parseAreaPlacesRequest, "강남역" → 장소 후보 3곳). 써브웨이가 쓰는 GeoPoint·PlaceRecord·VenueHours·OpeningPeriod·distanceM·inKorea·DataFailure는 그대로 → **영향 없음**, vendor 복사본은 그대로(SOURCE_COMMIT 유지)
- 가져올 것: 없음 (지역 → 장소 후보는 써브웨이가 이미 매장 찾기로 함)


## 🆕 10/25 점검 (e1dd80c → ee5ffdc)
| 상태 | 가져올 것 | SOPHIA 위치 | 써브웨이에서 | 언제 |
|---|---|---|---|---|
| ✅ 10/26 가져옴 (e853254) | **주소로 장소 찾기** (카카오 주소 검색: 동 이름·도로명·지번 → 좌표, 같은 이름이 더 있는지 `complete`) | `services/providers/kakao-local-provider.ts`(`searchAddress`), `services/providers/place-data-provider.ts`, `packages/contracts/src/place-contract.ts`(`GeocodedAddress`·`AddressSearchResult`), `packages/test-support/scripted-places.ts` | ① 매장 "장소 직접 입력"·말한 장소. ⚠ 10/26 바로잡음: 10/25의 "못 찾음·도봉구 카페"는 curl이 한글을 깨뜨려 잘못 잰 것. 실제로는 이름 검색이 근처 건물 목록("KB국민은행 강남파이낸스" 등)을 보여 주고 고르게 했음. 가져온 뒤: 주소를 말하면 **그 자리로 바로** (고르기 없음), 같은 이름 동("신사동"·"정자동")은 동끼리 고르기 | ✅ 10/26 |
| 참고만 | 날짜 표시 `seoulDayWeekTime`·`seoulDayTimeRange` | `apps/client-pwa/src/seoul-time.ts` | 써브웨이는 안 씀 (복사본은 주소 검색과 같이 최신판으로) | — |
| 해당 없음 | 음성 부탁하기(일정 앱), 친구 찾기, 먼저 알리기 바뀐 것 | `media-input-ui.ts`, `friend-search.ts`, `proactive-notices.ts` | 일정 앱 기능. 먼저 알리기는 선택(예비일), 친구는 8단계 선택 | — |
