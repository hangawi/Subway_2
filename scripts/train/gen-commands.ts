// 젬마 학습 문장 만들기 (10/28 예형님 2부): OpenAI 큰 모델이 손님 말투를 만들고 정답(짧은 명령 형식)을 씀 → 우리 검사를 통과한 것만.
// 규칙으로 만든 문장이 아니라 큰 모델이 만든 다양한 말투 (10/21 Qwen 교훈: 규칙 문장으로만 배우면 그 말투만 앎)
//   npx tsx scripts/train/gen-commands.ts teacher-check [--n 100]   → 시험 문장 100개로 선생님(정답 쓰는 모델) 실력 확인
//   npx tsx scripts/train/gen-commands.ts utter [--target 3300]      → var/train-cmd/utter.json (말투만)
//   npx tsx scripts/train/gen-commands.ts label [--workers 8]        → var/train-cmd/labels.json (정답)
//   npx tsx scripts/train/gen-commands.ts build                      → var/train-cmd/train.jsonl · heldout.json (학습 / 처음 보는 시험)
// 키는 .env.local 에서만 읽고 어디에도 쓰지 않음
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { commandInput, commandInstructions, commandSchema, validateCommands, type CartLineView } from '../../src/conversation/command-ai.ts';

const DIR = 'var/train-cmd';
mkdirSync(DIR, { recursive: true });
const mode = process.argv[2] ?? 'utter';
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const catalog = loadSubwayCatalog();
const TEACHER = arg('--model') ?? 'gpt-5';
const EFFORT = arg('--effort') ?? 'minimal';

function key(): string {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^SOPHIA_OPENAI_API_KEY=(.*)$/.exec(line.trim());
    if (m) return m[1]!.replace(/^["']|["']$/g, '');
  }
  throw new Error('NO_KEY');
}
const KEY = key();
let usage = { in: 0, cached: 0, out: 0 };
async function ask(instructions: string, input: string, schema: Record<string, unknown>, name: string): Promise<unknown | null> {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
        body: JSON.stringify({ model: TEACHER, instructions, input, max_output_tokens: 6000, reasoning: { effort: EFFORT }, store: false, text: { format: { type: 'json_schema', name, schema, strict: true } } }),
        signal: AbortSignal.timeout(120000),
      });
      const j = (await r.json()) as { output?: Array<{ content?: Array<{ type: string; text?: string }> }>; usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } } };
      if (j.usage) (usage.in += j.usage.input_tokens), (usage.cached += j.usage.input_tokens_details?.cached_tokens ?? 0), (usage.out += j.usage.output_tokens);
      const text = j.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text;
      if (r.status === 200 && text) return JSON.parse(text);
      if (r.status !== 429 && r.status < 500) return null;
    } catch {
      /* 다시 */
    }
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  return null;
}
// gpt-5: 입력 $1.25 (캐시 $0.125) / 출력 $10 (100만 토큰당), 1달러 1,400원
const won = () => Math.round(((usage.in - usage.cached) * 1.25 + usage.cached * 0.125 + usage.out * 10) / 1e6 * 1400);

// ── 말투 만들기 ──
const MENUS = catalog.menus.filter((m) => m.kind !== 'SIDE').map((m) => m.name);
const KINDS: Array<[string, boolean]> = [
  ['한 사람이 메뉴 하나를 시키며 빵·치즈·야채 빼기/더 넣기·소스·크기·세트·음료를 섞어 말함 (메뉴 이름은 정식 이름·줄임말·오타 섞어서)', false],
  ['한 사람이 메뉴 없이 조건으로 추천해 달라고 함 (예산·든든하게·가볍게·단백질·매운 거/안 매운 거·소고기·닭고기 같은 메인 재료·샐러드·아침 메뉴·알레르기)', false],
  ['상황을 말하며 추천해 달라고 함 (감기·몸살·해장·숙취·운동 끝나고·야근·시험 기간·다이어트·등산 전·비 오는 날 등)', false],
  ['여러 사람 주문: 사람 수만 말하거나("우리 넷", "야구부 6명"), 사람마다 다른 조건·메뉴·음료·알레르기를 말함 (이름 있는 사람·없는 사람 섞어서, 최대 10명)', false],
  ['한 사람이 여러 개: "하나는 ~ 하나는 ~", "같은 거 두 개인데 하나만 ~", "든든한 거 하나 가벼운 거 하나"', false],
  ['담은 장바구니를 고침: 줄 번호로("1번은 ~ 2번은 ~"), "둘 다/전부", "첫 번째 거 하나 더", "두 번째 빼줘", "2번 ○○로 바꿔", 그 줄 먹는 사람 알레르기', true],
  ['말을 고침·사투리·반말·군말·띄어쓰기 없음·음성 받아쓰기 같은 말투 ("홀스래디쉬 아니 랜치로", "묵고 싶다", "아나 배고파")', false],
  ['질문·기타: 왜 이게 추천이야, 1번이랑 2번 뭐가 달라, 지난번처럼·저번이랑 똑같이, 이대로 주문할게, 음료·사이드만 (콜라만 줘)', false],
];
function randomCart(seed: number): CartLineView[] {
  const n = 1 + (seed % 4);
  return Array.from({ length: n }, (_, i) => ({ no: i + 1, menu: MENUS[(seed * 7 + i * 13) % MENUS.length]!, qty: 1 + ((seed + i) % 3 === 0 ? 1 : 0), owner: i > 0 && (seed + i) % 2 ? ('GUEST' as const) : ('ME' as const), ...((seed + i) % 5 === 0 && i > 0 ? { name: ['민수', '지은', '현우', '서연'][i % 4]! } : {}) }));
}
async function utter() {
  const target = Number(arg('--target') ?? 3300);
  const file = `${DIR}/utter.json`;
  const out: Array<{ text: string; cart: CartLineView[]; kind: number }> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const seen = new Set(out.map((x) => x.text));
  const evalTexts = new Set((JSON.parse(readFileSync('var/cmd-eval/items.json', 'utf8')) as Array<{ text: string }>).map((x) => x.text.replace(/\s+/g, '')));
  const schema = { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', items: { type: 'string' } } } };
  let round = Math.floor(out.length / 30);
  while (out.length < target) {
    const jobs = Array.from({ length: 8 }, (_, w) => {
      const r = round + w;
      const kind = r % KINDS.length;
      const cart = KINDS[kind]![1] ? randomCart(r) : [];
      const input = `써브웨이 주문 앱에 손님이 말하거나 쓸 법한 한국어 문장 30개를 만들어 줘.
종류: ${KINDS[kind]![0]}
${cart.length ? `지금 장바구니 (이 장바구니를 보고 고치는 말):\n${cart.map((l) => `${l.no}번: ${l.menu} ×${l.qty}${l.owner === 'GUEST' ? ` (${l.name ?? '같이 먹는 사람'} 거)` : ''}`).join('\n')}\n` : ''}- 실제 사람처럼 다양하게: 짧은 말·긴 말, 존댓말·반말, 오타·줄임말, 띄어쓰기 없는 말, 말 고치기 섞어서. 서로 비슷한 문장 금지.
- 메뉴·재료는 써브웨이에 있는 것 (메뉴 예: ${MENUS.slice((r * 5) % MENUS.length, ((r * 5) % MENUS.length) + 12).join(', ')}).
- 문장만 (번호·설명 없이).`;
      return ask('너는 한국어 주문 문장을 다양하게 만드는 도우미다.', input, schema, 'utterances').then((res) => ({ res: res as { items?: string[] } | null, cart, kind }));
    });
    for (const { res, cart, kind } of await Promise.all(jobs)) {
      for (const t of res?.items ?? []) {
        const text = String(t).trim().slice(0, 200);
        if (text.length < 2 || seen.has(text) || evalTexts.has(text.replace(/\s+/g, ''))) continue;
        seen.add(text);
        out.push({ text, cart, kind });
      }
    }
    round += 8;
    writeFileSync(file, JSON.stringify(out));
    console.log(`말투 ${out.length}/${target} · 지금까지 약 ${won().toLocaleString()}원`);
  }
}
// ── 정답 쓰기 ──
async function label(list: Array<{ id: string; text: string; cart: CartLineView[] }>, file: string) {
  const done: Record<string, unknown> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const instructions = commandInstructions(catalog);
  const schema = commandSchema(catalog);
  const todo = list.filter((x) => !(x.id in done));
  let next = 0;
  let n = 0;
  async function worker() {
    while (next < todo.length) {
      const x = todo[next++]!;
      done[x.id] = await ask(instructions, commandInput(x.text, x.cart, []), schema, 'cart_commands');
      if (++n % 50 === 0) writeFileSync(file, JSON.stringify(done)), console.log(`정답 ${n}/${todo.length} · 약 ${won().toLocaleString()}원`);
    }
  }
  await Promise.all(Array.from({ length: Number(arg('--workers') ?? 8) }, worker));
  writeFileSync(file, JSON.stringify(done));
  console.log(`정답 끝 ${n}개 · 약 ${won().toLocaleString()}원 (입력 ${usage.in} · 캐시 ${usage.cached} · 출력 ${usage.out} 토큰)`);
  return done;
}

if (mode === 'teacher-check') {
  // 시험 문장으로 선생님 실력: ai-command-eval 채점에 그대로 넣음 (out-teacher.json)
  const items = JSON.parse(readFileSync('var/cmd-eval/items.json', 'utf8')) as Array<{ id: string; text: string; kind: string; cart: Array<{ menu: string; qty?: number; owner?: 'ME' | 'GUEST'; name?: string }> }>;
  const n = Number(arg('--n') ?? 100);
  // 예상 밖 40 + 한 개 주문 골고루 + 장바구니 일부
  const pick = [...items.filter((x) => x.kind === 'odd').filter((_, i) => i % 2 === 0).slice(0, 40), ...items.filter((x) => x.kind === 'single').filter((_, i) => i % 23 === 0), ...items.filter((x) => x.kind === 'cart').filter((_, i) => i % 13 === 0)].slice(0, n);
  const view = (cart: Array<{ menu: string; qty?: number; owner?: 'ME' | 'GUEST'; name?: string }>): CartLineView[] => cart.map((l, i) => ({ no: i + 1, menu: l.menu, qty: l.qty ?? 1, owner: l.owner ?? 'ME', ...(l.name ? { name: l.name } : {}) }));
  const got = await label(pick.map((x) => ({ id: x.id, text: x.text, cart: view(x.cart) })), `${DIR}/teacher-labels.json`);
  writeFileSync('var/cmd-eval/out-teacher.json', JSON.stringify(Object.fromEntries(Object.entries(got).map(([id, v]) => [id, { raw: v ? JSON.stringify(v) : 'ERROR', ms: 0 }]))));
  console.log('채점: npx tsx scripts/ai-command-eval.ts score --extra out-teacher.json');
} else if (mode === 'utter') await utter();
else if (mode === 'label') {
  const ut = JSON.parse(readFileSync(`${DIR}/utter.json`, 'utf8')) as Array<{ text: string; cart: CartLineView[] }>;
  await label(ut.map((x, i) => ({ id: String(i), text: x.text, cart: x.cart })), `${DIR}/labels.json`);
} else if (mode === 'build') {
  const ut = JSON.parse(readFileSync(`${DIR}/utter.json`, 'utf8')) as Array<{ text: string; cart: CartLineView[]; kind: number }>;
  const lab = JSON.parse(readFileSync(`${DIR}/labels.json`, 'utf8')) as Record<string, unknown>;
  const instructions = commandInstructions(catalog);
  const ok: Array<{ id: string; text: string; cart: CartLineView[]; kind: number; answer: unknown }> = [];
  let bad = 0;
  ut.forEach((x, i) => {
    const a = lab[String(i)];
    if (!a) return void bad++;
    const v = validateCommands(a, catalog, x.text, x.cart.length);
    // 검사에서 버린 게 있거나 명령이 하나도 없으면 학습에 안 씀 (선생님이 지어낸 것일 수 있음)
    // (goal = 검사 코드가 표시만 붙이는 것, menu = 줄임말을 선생님이 맞게 읽은 것 — 둘은 써도 됨)
    if (v.dropped.some((d) => d !== 'goal' && d !== 'menu') || (!v.commands.length && !v.reason)) return void bad++;
    ok.push({ id: String(i), text: x.text, cart: x.cart, kind: x.kind, answer: a });
  });
  // 처음 보는 시험용 300개 (종류마다 골고루, 학습에 안 씀)
  const held = new Set<string>();
  for (let k = 0; k < KINDS.length; k++) ok.filter((x) => x.kind === k).filter((_, i) => i % 10 === 0).slice(0, Math.ceil(300 / KINDS.length)).forEach((x) => held.add(x.id));
  const train = ok.filter((x) => !held.has(x.id));
  writeFileSync(`${DIR}/train.jsonl`, train.map((x) => JSON.stringify({ messages: [{ role: 'system', content: instructions }, { role: 'user', content: commandInput(x.text, x.cart, []) }, { role: 'assistant', content: JSON.stringify(x.answer) }] })).join('\n') + '\n');
  writeFileSync(`${DIR}/heldout.json`, JSON.stringify(ok.filter((x) => held.has(x.id))));
  console.log(`학습 ${train.length} · 처음 보는 시험 ${held.size} · 버림 ${bad}`);
}
