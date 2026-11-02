# A100 종료 → OpenAI 전환 계획 (바꾸기 + 보정)

- 작성: 2026-10-28 (fbabb75 기준, live 설정 직접 확인)
- 언제: **GPU(A100, RunYourAI) 계약이 끝날 때까지는 지금처럼 젬마를 씁니다.** 예형님이 "하라"고 하시면 아래 순서대로 바로 진행합니다.
- 범위: 써브웨이만 해당합니다. SOPHIA의 A100 연결은 이 문서에서 다루지 않습니다.

---

## 0. 지금 구조 (코드·live 확인 결과)

| 쓰는 곳 | 코드 | 지금 순서 | 기다리는 시간 |
|---|---|---|---|
| 장바구니 명령 (말 → 담기·고치기, 젬마 먼저) | [cart-ai.ts:47](../../src/conversation/cart-ai.ts) | A100 젬마 → OpenAI | 화면 40초 (`CART_AI_TIMEOUT_MS`) |
| 여러 명 말 나누기 | [split-ai.ts:26](../../src/conversation/split-ai.ts) | A100 젬마 → OpenAI | 라우터 기본값 |
| 한 개 주문 규칙 해석의 나머지 | [interpret.ts:184](../../src/conversation/interpret.ts) | A100 젬마 → OpenAI | 12초 (`AI_TIMEOUT_MS`) |
| Top3 AI 한마디 | [ai-explain.ts](../../src/subway-menu/ai-explain.ts), [providers.ts:69-71](../../src/server/providers.ts) | **A100만** (OpenAI로 안 넘김) | 4초 |
| 🎤 받아쓰기 | 브라우저 → OpenAI | A100 안 씀 | 해당 없음 |

- 라우터: [providers.ts](../../src/server/providers.ts)에서 `SUBWAY_*` 설정을 `SOPHIA_*`로 옮겨 [config.ts](../../vendor/sophia/services/ai/config.ts)에 넘깁니다. 시도 1번에 12초(`interactive`)이고, 시간이 넘으면 1번 더 시도합니다(`max_attempts: 2`).
- **이미 있는 스위치**: `SUBWAY_A100_DISABLED=1`을 넣으면 A100 설정을 지우고 OpenAI만 씁니다 ([providers.ts:64](../../src/server/providers.ts)).
- **live 설정 (subway-prod, 10/28 확인)**: `SUBWAY_A100_*` 4개와 `SUBWAY_OPENAI_API_KEY`만 들어 있습니다.
  → OpenAI 생각 수준이 **기본값 `minimal`** 입니다. 지금 젬마가 실패했을 때 넘어가는 OpenAI는 75.4% 모드로 돌고 있습니다.

### 같은 1,628문장 성적 (`var/cmd-eval/result.json`)

| AI | 전체 | 알레르기 실수 | JSON 실패 | p50 / p95 | 1,000번 비용 |
|---|---|---|---|---|---|
| 젬마 A100 (지금) | 86.3% | 2 | 0 | 1.7초 / 3.2초 | 0원 |
| gpt-5-mini **low** | 84.3% | **9** | 4 | 6.0초 / **15.2초** | 약 3,900원 |
| gpt-5-mini minimal | 75.4% | 2 | 0 | 3.0초 / 6.1초 | 약 2,900원 |

설명서(`commandInstructions`)는 젬마와 OpenAI가 **같은 것**을 씁니다. 따라서 바꾸기만 하는 데는 설명서를 고칠 필요가 없습니다.

---

## A. 바꾸기 (예형님 "하라" → 약 30분)

코드는 거의 그대로 두고 **서버 설정 위주**로 바꿉니다.

1. **서버 설정 파일 `secrets/subway.env`에 3줄 추가**
   ```
   SUBWAY_A100_DISABLED=1
   SUBWAY_OPENAI_REASONING_EFFORT=low
   SUBWAY_AI_INTERACTIVE_TIMEOUT_MS=20000
   ```
   - `low`를 쓰는 이유: minimal은 75.4%라서 너무 낮습니다.
   - 20초로 늘리는 이유: low의 p95가 15.2초라서, 지금 12초로 두면 열 번 중 한 번은 시간이 넘어 재시도합니다. 장바구니 화면의 40초 안에는 들어갑니다.
   - `SUBWAY_A100_*` 4줄은 지우지 않고 그대로 둡니다. 되돌릴 때 쓰기 위해서입니다.
2. **다시 띄우기**: `docker compose up -d`를 실행합니다. 설정 파일이 바뀌면 컨테이너가 새로 만들어집니다. `restart`로는 새 설정을 읽지 않습니다.
3. **A100 통로 끄기**: `docker compose stop a100-tunnel`을 실행합니다. 계약이 끝난 뒤에도 켜 두면 SSH 재접속만 계속 시도합니다.
4. **작은 코드 수정** (커밋 1개)
   - [app.ts:1559](../../src/web/app.ts), [app.ts:1651](../../src/web/app.ts): 응답에 `by`가 없을 때 기본값이 `'a100'`로 되어 있어서, 말 기록에 "A100이 알아들음"으로 잘못 남습니다. 이를 `null`로 바꿉니다.
   - [interpret.ts:184](../../src/conversation/interpret.ts) `AI_TIMEOUT_MS` 12초 → 20초 (low p95에 맞춤).
   - `docs/자동작업/README.md` 25줄의 "A100 gemma → OpenAI"를 "OpenAI (gpt-5-mini low)"로 고칩니다.
5. **확인 (live)**
   - 서버 시작 로그의 AI 상태가 `openai:ready` 하나만 나오는지 확인합니다.
   - live 점검 4종: odd-cart-check, cart-check, cart-talk-check, screens.
     기준은 지금 점수(99/100, 60/60, 99/100, 154/154)에서 **크게 떨어지지 않는 것**입니다. 성적표상 1~2%p 정도 낮아지는 건 예상 범위입니다.
   - 말 기록의 `aiBy`가 `openai`로 남는지 확인합니다.
   - 응답 시간 p50·p95를 기록합니다.
6. **되돌리기** (계약이 연장되는 경우): 1번의 3줄을 지우고 `docker compose up -d`, `docker compose --profile a100 up -d a100-tunnel`을 실행합니다. (11/02: 배포 때 통로가 다시 켜져서 compose에서 `profiles: ["a100"]`로 뺐습니다.)

> **11/02 진행 완료** (db2abac + 다음 커밋): 설정 3줄 넣음(백업 `subway.env.bak-20261102-102452`), 서버 시작 로그 `ai=openai:ready`, 통로 정지.

### A에서 달라지는 것 (예형님이 알고 계셔야 할 것)
- **Top3 AI 한마디가 사라집니다.** 이 기능은 A100 전용입니다(10/21 결정: "없어도 되는 설명이라 OpenAI로 안 넘김"). 한마디가 빠지고 규칙 설명만 남습니다.
  → OpenAI로 살릴지는 **B-5**에서 정합니다.
- 응답이 느려집니다: 젬마 약 1.7초 → OpenAI 약 6초 (p50).
- 비용이 생깁니다: 장바구니 명령 1,000번에 약 3,900원. 말 나누기와 해석 나머지는 문장이 짧아서 이보다 훨씬 적게 듭니다.

---

## B. 보정 (A 끝난 뒤, 반나절 정도)

목표: **알레르기 실수 9 → 2 이하, JSON 실패 4 → 0, 전체 84% 이상 유지.**
방침(10/27 예형님): 말마다 새 규칙이나 정규식을 만들지 않습니다. **설명서 원칙과 예시 몇 개, 그리고 코드 검사기**로만 고칩니다.

1. **틀린 문장 꺼내기**: `var/cmd-eval/out-openai.json`(low)에서 알레르기 실수 9건과 JSON 실패 4건을 뽑아, 문장·정답·OpenAI 답을 표로 정리합니다.
2. **원인 나누기**
   - 말하지 않은 알레르기를 넣음, 다른 사람 알레르기를 섞음 → **검사기**(`validateCommands`)에서 막을 수 있으면 검사기로 막습니다. 말한 알레르기만 허용하는 검사는 이미 있으므로, 빠져나간 경로를 찾습니다.
   - 설명서를 잘못 이해함 → 설명서에 원칙 한 줄과 예시를 추가합니다.
   - JSON 실패 → `max_output_tokens`(3000)가 부족한지, 스키마에 맞지 않는 값인지 확인합니다.
3. **싸게 먼저 재기**: 틀린 13건과 무작위 100문장만 low로 다시 잽니다(약 500원). 좋아졌는지, 다른 문장이 망가지지 않았는지 봅니다.
4. **전체 다시 재기 1번**: `npx tsx scripts/ai-command-eval.ts openai --effort low` → `score`. 약 6천 원, 수십 분 걸립니다.
   목표에 못 미치면 2~3단계로 돌아갑니다. 전체 재측정은 **최대 2번(약 1.2만 원)** 까지만 하고, 그 이상은 예형님께 여쭙니다.
5. **AI 한마디 정하기**: `explain` 라우터를 OpenAI **minimal**로 따로 만들면 살릴 수 있습니다(p50 3초 → 4초 제한을 8초 정도로 늘려야 함). 비용은 Top3 1번에 약 1~2원입니다.
   → 예형님이 "살려" 하시면 [providers.ts:69-71](../../src/server/providers.ts)을 고칩니다. 아니면 꺼진 채로 둡니다.
6. 테스트(724개)를 통과하면 커밋, 푸시(자동 배포), live 점검 4종을 다시 돌립니다.

---

## 계약 만료 전에 예형님이 정하실 것
- **A100에만 있는 파일**: `~/subway-train`(LoRA 어댑터, 10/21 작은 모델)은 둘 다 실패해서 쓰지 않습니다. 학습 스크립트와 데이터 생성기는 Git에 있습니다(fbabb75).
  → 그냥 버려도 되는지, 내려받아 둘지 정해 주세요.
- **만료 날짜**: 날짜를 알려 주시면 그 전날 A를 진행하겠습니다.
