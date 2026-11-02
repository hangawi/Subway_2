// AI 비교 (10/26 예형님): 같은 문장으로 젬마(A100)·OpenAI(gpt-5-mini)·10/21 학습 모델·지금 방식(규칙 먼저)을 잰다.
// AI는 "장바구니 명령"(src/conversation/command-ai.ts)을 내고, 코드가 검사·적용한 결과를 정답과 비교. 실제 서비스는 안 바꿈.
// 문제: 한 개 주문 1,400(3000문장 1~4차 + CASES, 이 형식으로 잴 수 있는 칸만) + 장바구니 100 + 예상 밖 100
//   npx tsx scripts/ai-command-eval.ts prep            → var/cmd-eval/items.json, gemma-run.js(서버 컨테이너에서), trained.jsonl(A100)
//   npx tsx scripts/ai-command-eval.ts openai [--workers 6] [--limit N]   → out-openai.json (키는 .env.local, 화면·파일에 안 남김)
//   npx tsx scripts/ai-command-eval.ts rules           → out-rules-single.json (한 개 주문: 규칙만, 이 컴퓨터)
//   npx tsx scripts/ai-command-eval.ts score           → result.json + 표
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { interpret } from '../src/conversation/interpret.ts';
import { applyCommands, commandInput, commandInstructions, commandSchema, validateCommands, type CartLineView, type Command, type SimLine } from '../src/conversation/command-ai.ts';
import { CASES, judge, needsSecondPass, type Want } from './talk-cases.ts';
import { make3000 } from './talk-3000.ts';
import { make3000b, type TalkCase2 } from './talk-3000-2.ts';
import { make3000c } from './talk-3000-3.ts';
import { make3000d } from './talk-3000-4.ts';
import { CART_CASES } from './cart-talk-cases.ts';
import { judgeLines, makeOdd, type GoldLine, type GotLine, type SeedLine } from './odd-cart-cases.ts';

const DIR = 'var/cmd-eval';
mkdirSync(DIR, { recursive: true });
const mode = process.argv[2] ?? 'score';
const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const catalog = loadSubwayCatalog();
const menuId = (n: string) => catalog.menus.find((m) => m.name === n)?.id ?? null;
const nameOf = (id: string | null) => (id ? (catalog.menus.find((m) => m.id === id)?.name ?? id) : null);
const ing = (id: string) => catalog.ingredients.find((x) => x.id === id)?.name ?? catalog.toppings.find((x) => x.id === id)?.name ?? catalog.singles?.find((x) => x.id === id)?.name ?? id;
// ③ 지금 추천 (이거=1, 저거=2) — 모든 문장에 같게
const RECS = ['로스트 치킨', '이탈리안 비엠티', '에그마요'];
const REC_IDS = RECS.map((n) => menuId(n)!);

interface Item {
  id: string;
  kind: 'single' | 'cart' | 'odd';
  text: string;
  cart: SeedLine[];
  want?: Want;
  gold?: { lines: number; qty?: number; single?: boolean; persons?: number; reason?: boolean };
  goldLines?: GoldLine[];
}
// 이 형식이 다루는 칸만 (취향 기억·짜게·끼니·단품·지난번처럼 같은 건 명령 형식에 아직 없음 → 빼고 잼)
const SUPPORTED = new Set(['menu', 'goal', 'budget', 'spicy', 'allergies', 'mains', 'kinds', 'avoid', 'remove', 'add', 'sauces', 'noSauce', 'set', 'drink', 'size', 'cheese', 'bread', 'setItem', 'place', 'ask', 'pickRank', 'notRemove']);
const fits = (w: Want) => Object.keys(w).every((k) => SUPPORTED.has(k)) && (w.ask === undefined || w.ask === 'WHY' || w.ask === 'COMPARE');

function prep() {
  const items: Item[] = [];
  CASES.forEach(([text, want], i) => fits(want) && items.push({ id: `CASES-${i + 1}`, kind: 'single', text, cart: [], want }));
  const sets: Array<[string, TalkCase2[]]> = [['1차', make3000(catalog)], ['2차', make3000b(catalog)], ['3차', make3000c(catalog)], ['4차', make3000d(catalog)]];
  // 묶음마다 골고루 (돌아가며 하나씩)
  const groups = new Map<string, TalkCase2[]>();
  for (const [s, list] of sets) for (const c of list) if (!c.before?.length && !c.at && !c.top && fits(c.want)) (groups.get(`${s}:${c.group}`) ?? groups.set(`${s}:${c.group}`, []).get(`${s}:${c.group}`)!).push({ ...c, id: `${s}-${c.id}` });
  const queues = [...groups.values()];
  const need = 1400 - items.length;
  for (let round = 0, taken = 0; taken < need && queues.some((q) => q.length > round); round++)
    for (const q of queues) if (taken < need && q[round]) items.push({ id: q[round]!.id, kind: 'single', text: q[round]!.text, cart: [], want: q[round]!.want }), taken++;
  CART_CASES.forEach((c, i) => items.push({ id: `장바구니-${String(i + 1).padStart(3, '0')}`, kind: 'cart', text: c.text, cart: [], gold: { lines: c.lines, ...(c.qty ? { qty: c.qty } : {}), ...(c.single ? { single: true } : {}) } }));
  for (const c of makeOdd(catalog)) items.push({ id: `예상밖-${c.id}`, kind: 'odd', text: c.text, cart: c.cart, goldLines: c.lines });
  // 10/27 예형님 말투: 단체 인원 · 사람별로 섞인 말 · 상황 (장바구니 칸에서 잼: 줄 수·사람 수·상황 한 줄)
  const group: Array<[string, NonNullable<Item['gold']>]> = [
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n): [string, NonNullable<Item['gold']>] => [`야구부 ${n}명인데 그거에 맞게 추천해줘`, { lines: n, persons: n, reason: true }]),
    ['우리 4명이야 다 가벼운 걸로', { lines: 4, persons: 4 }],
    ['축구 끝나고 6명이서 먹을 거야 든든한 걸로', { lines: 6, persons: 6, reason: true }],
    ['팀원 3명 점심인데 하나씩 단백질 많은 걸로', { lines: 3, persons: 3 }],
    ['한명은 매운거랑, 든든한거 하나씩, 한명은 가벼운거에다 토마토 빼주고 한명은 소고기에다가 제로콜라 , 한명은 두개를 시키고 나머지 두명은 각각 하나씩', { lines: 8, persons: 6 }],
    ['한 명은 매운 거 두 개, 나머지 세 명은 하나씩', { lines: 4, persons: 4 }],
    ['나는 가벼운 거 하나, 동생은 든든한 거 두 개', { lines: 2, persons: 2 }],
    ['엄마는 안 매운 거, 아빠는 소고기, 나는 샐러드', { lines: 3, persons: 3 }],
    ['두 명은 해장할 거 하나씩, 한 명은 다이어트 중이라 가벼운 거', { lines: 3, persons: 3 }],
    ['5명인데 2명은 매운 거 3명은 안 매운 거', { lines: 5, persons: 5 }],
    ['친구 둘이랑 나 해서 셋인데 다 든든하게', { lines: 3, persons: 3 }],
    ['한 명은 쿠키 세트로 하나, 한 명은 웨지 세트로 하나', { lines: 2, persons: 2 }],
    ['감기걸렷는데 그거에 맞게 추천해줘', { lines: 0, single: true, reason: true }],
    ['어제 술 마셔서 속이 안 좋아 추천해줘', { lines: 0, single: true, reason: true }],
    ['운동 끝나고 왔는데 뭐 먹지', { lines: 0, single: true, reason: true }],
    ['다이어트 중인데 배고파', { lines: 0, single: true, reason: true }],
    ['몸살 기운 있는데 따뜻한 거', { lines: 0, single: true, reason: true }],
    ['시험 기간이라 빨리 먹고 갈 거', { lines: 0, single: true, reason: true }],
    ['야근이라 든든하게 먹어야 돼', { lines: 0, single: true, reason: true }],
    ['등산 가기 전에 먹을 거', { lines: 0, single: true, reason: true }],
  ];
  group.forEach(([text, gold], i) => items.push({ id: `새말투-${String(i + 1).padStart(2, '0')}`, kind: 'cart', text, cart: [], gold }));
  writeFileSync(`${DIR}/items.json`, JSON.stringify(items, null, 1));
  // 젬마: 서버(subway-prod 컨테이너 안)에서 A100으로 — 키는 컨테이너 환경에서만 읽음. 2개씩 동시에
  const payload = { instructions: commandInstructions(catalog), schema: commandSchema(catalog), inputs: items.map((x) => ({ id: x.id, input: inputOf(x) })) };
  writeFileSync(`${DIR}/gemma-run.js`, `const PAYLOAD = ${JSON.stringify(payload)};\n${GEMMA_JS}`);
  // 일부만 먼저 (--ids 파일): gemma-probe.js
  if (arg('--ids')) {
    const ids = new Set(readFileSync(arg('--ids')!, 'utf8').split(/\s+/).filter(Boolean));
    writeFileSync(`${DIR}/gemma-probe.js`, `const PAYLOAD = ${JSON.stringify({ ...payload, inputs: payload.inputs.filter((x) => ids.has(x.id)) })};\n${GEMMA_JS}`);
  }
  // 학습 모델 (10/21, 한 개 주문 형식만 배움): 한 개 주문 문장만, 그때 시험지와 같은 지시문
  const sys = JSON.parse(readFileSync('var/train/test3.jsonl', 'utf8').split('\n')[0]!).messages[0].content as string;
  writeFileSync(`${DIR}/trained.jsonl`, items.filter((x) => x.kind === 'single').map((x) => JSON.stringify({ id: x.id, messages: [{ role: 'system', content: sys }, { role: 'user', content: x.text }] })).join('\n') + '\n');
  const n = (k: Item['kind']) => items.filter((x) => x.kind === k).length;
  console.log(`문제 ${items.length}개 (한 개 주문 ${n('single')} · 장바구니 ${n('cart')} · 예상 밖 ${n('odd')}) · 지시문+형식 ${Math.round((payload.instructions.length + JSON.stringify(payload.schema).length) / 1000)}천 글자`);
}
const viewOf = (cart: SeedLine[]): CartLineView[] => cart.map((l, i) => ({ no: i + 1, menu: l.menu, qty: l.qty ?? 1, owner: l.owner ?? 'ME', ...(l.name ? { name: l.name } : {}) }));
const inputOf = (x: Item) => commandInput(x.text, viewOf(x.cart), RECS);

const GEMMA_JS = String.raw`const base = process.env.SUBWAY_A100_BASE_URL.replace(/\/$/, '');
const url = /\/v1$/.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
const out = {};
let next = 0;
async function one(x) {
  const t0 = Date.now();
  let raw = '';
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.SUBWAY_A100_API_KEY }, body: JSON.stringify({ model: process.env.SUBWAY_A100_MODEL, messages: [{ role: 'system', content: PAYLOAD.instructions }, { role: 'user', content: x.input }], max_tokens: 2500, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'cart_commands', schema: PAYLOAD.schema, strict: true } } }), signal: AbortSignal.timeout(90000) });
    const j = await r.json();
    raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || ('ERROR ' + r.status);
  } catch (e) { raw = 'ERROR ' + e.message; }
  out[x.id] = { raw, ms: Date.now() - t0 };
}
async function worker() { while (next < PAYLOAD.inputs.length) { const x = PAYLOAD.inputs[next++]; await one(x); if (next % 100 === 0) process.stderr.write(next + '\n'); } }
Promise.all([worker(), worker()]).then(() => process.stdout.write(JSON.stringify(out)));
`;

// ── OpenAI (이 컴퓨터에서, .env.local의 키) ──
function env(): Record<string, string> {
  const e: Record<string, string> = {};
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) e[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
  return e;
}
async function openai() {
  const e = env();
  const key = e.SOPHIA_OPENAI_API_KEY;
  if (!key) throw new Error('SOPHIA_OPENAI_API_KEY 없음');
  const model = e.SOPHIA_OPENAI_MODEL || 'gpt-5-mini';
  const effort = arg('--effort') ?? (e.SOPHIA_OPENAI_REASONING_EFFORT || 'minimal');
  const items = JSON.parse(readFileSync(`${DIR}/items.json`, 'utf8')) as Item[];
  const file = `${DIR}/${arg('--out') ?? 'out-openai.json'}`;
  const ids = arg('--ids') ? new Set(readFileSync(arg('--ids')!, 'utf8').split(/\s+/).filter(Boolean)) : null;
  const out: Record<string, { raw: string; ms: number; inTok?: number; outTok?: number }> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const todo = items.filter((x) => (!ids || ids.has(x.id)) && (!out[x.id] || out[x.id]!.raw.startsWith('ERROR'))).slice(0, Number(arg('--limit') ?? 1e9));
  const instructions = commandInstructions(catalog);
  const schema = commandSchema(catalog);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < todo.length) {
      const x = todo[next++]!;
      const t0 = Date.now();
      let raw = '';
      let inTok: number | undefined;
      let outTok: number | undefined;
      for (let t = 0; t < 3; t++) {
        try {
          const r = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, instructions, input: inputOf(x), max_output_tokens: 4000, reasoning: { effort }, store: false, text: { format: { type: 'json_schema', name: 'cart_commands', schema, strict: true } } }),
            signal: AbortSignal.timeout(90000),
          });
          const j = (await r.json()) as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>; usage?: { input_tokens: number; output_tokens: number }; error?: { message: string } };
          raw = j.output?.flatMap((o) => o.content ?? []).find((c) => c.type === 'output_text')?.text ?? `ERROR ${r.status} ${j.error?.message?.slice(0, 80) ?? ''}`;
          inTok = j.usage?.input_tokens;
          outTok = j.usage?.output_tokens;
          if (r.status !== 429 && r.status < 500) break;
        } catch (err) {
          raw = `ERROR ${(err as Error).message}`;
        }
        await new Promise((ok) => setTimeout(ok, 2000 * (t + 1)));
      }
      out[x.id] = { raw, ms: Date.now() - t0, ...(inTok ? { inTok } : {}), ...(outTok ? { outTok } : {}) };
      if (++done % 50 === 0) writeFileSync(file, JSON.stringify(out)), console.log(`${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: Number(arg('--workers') ?? 6) }, worker));
  writeFileSync(file, JSON.stringify(out));
  console.log(`OpenAI ${model} (${effort}) ${done}개 끝`);
}

// ── 지금 방식, 한 개 주문 (규칙만, talk-3000-run과 같은 방법) ──
async function rules() {
  const items = (JSON.parse(readFileSync(`${DIR}/items.json`, 'utf8')) as Item[]).filter((x) => x.kind === 'single');
  const sample = menuId('로스트 치킨');
  const out: Record<string, { r: unknown; ch: unknown; ms: number }> = {};
  for (const x of items) {
    const t0 = performance.now();
    const r0 = await interpret(x.text, catalog, {}, null);
    const r = { ...r0, ask: r0.intent.ask ?? null };
    let ch = r.choices ?? {};
    if (needsSecondPass(r)) ch = (await interpret(x.text, catalog, { menuId: sample!, prefs: r.prefs }, null)).choices ?? {};
    out[x.id] = { r, ch, ms: performance.now() - t0 };
  }
  writeFileSync(`${DIR}/out-rules-single.json`, JSON.stringify(out));
  console.log(`규칙만 ${items.length}개 끝`);
}

// ── 채점 ──
const reasons = new Map<string, string | null>();
function parseCommands(raw: string, x: Item): Command[] | null {
  try {
    const v = validateCommands(JSON.parse(raw), catalog, x.text, x.cart.length);
    reasons.set(x.id, v.reason);
    return v.commands;
  } catch {
    return null;
  }
}
/** 학습 모델 답(한 개 주문 JSON, 이름 모양) → 명령 하나로 바꿔 같은 검사 */
function trainedToCommands(raw: string, x: Item): Command[] | null {
  try {
    const j = JSON.parse(raw);
    const o = j.options ?? {};
    const op = j.ask === 'WHY' ? 'ASK_WHY' : j.ask === 'COMPARE' ? 'COMPARE' : j.menu ? 'ADD' : 'RECOMMEND';
    const cmd = { op, line: null, allLines: null, qty: null, owner: null, name: null, pick: null, menu: j.menu ?? null, conditions: j.conditions ?? {}, options: { ...o, noSauce: Array.isArray(o.sauces) && o.sauces.length === 0 ? true : null } };
    return validateCommands({ commands: [cmd] }, catalog, x.text, 0).commands;
  } catch {
    return null;
  }
}
/** 명령 → 한 개 주문 해석 모양 (judge가 보는 r·ch) */
function asSingle(cmds: Command[]) {
  const prefs: Record<string, unknown> = {};
  const ch: Record<string, unknown> = {};
  let menu: string | null = null;
  let ask: string | null = null;
  let pickRank: number | null = null;
  for (const c of cmds) {
    for (const [k, v] of Object.entries(c.intent.conditions)) prefs[k] = Array.isArray(v) ? [...new Set([...((prefs[k] as unknown[]) ?? []), ...v])] : v;
    for (const [k, v] of Object.entries(c.intent.options)) if (v !== undefined) ch[k] = Array.isArray(v) && k !== 'sauces' ? [...new Set([...((ch[k] as unknown[]) ?? []), ...v])] : v;
    menu ??= c.intent.menu ?? null;
    if (c.op === 'ASK_WHY') ask = 'WHY';
    if (c.op === 'COMPARE') ask = 'COMPARE';
    if (c.pick && !c.intent.menu) pickRank ??= c.pick;
  }
  return { r: { menuId: menu, prefs: { ...prefs, allergies: (prefs.allergies as string[]) ?? [] }, place: prefs.place ?? null, ask, pickRank }, ch };
}
const seedLines = (cart: SeedLine[]): SimLine[] => cart.map((l) => ({ menuId: menuId(l.menu), qty: l.qty ?? 1, owner: l.owner ?? 'ME', ...(l.name ? { name: l.name } : {}), allergies: [], choices: {} }));
const toGot = (l: SimLine): GotLine => {
  const ch = l.choices as { removeVegetables?: string[]; bread?: string; size?: string; cheese?: string | null; sauces?: string[] };
  return {
    menu: nameOf(l.menuId),
    qty: l.qty,
    owner: l.owner,
    ...(l.name ? { name: l.name } : {}),
    allergies: l.allergies,
    remove: (ch.removeVegetables ?? []).map(ing),
    ...(ch.bread ? { bread: ing(ch.bread) } : {}),
    ...(ch.size ? { size: ch.size } : {}),
    ...(ch.cheese !== undefined ? { cheese: ch.cheese === null ? null : ing(ch.cheese) } : {}),
    ...(ch.sauces ? { sauces: ch.sauces.map(ing) } : {}),
  };
};
interface Score {
  name: string;
  n: Record<Item['kind'], number>;
  pass: Record<Item['kind'], number>;
  allergy: number;
  badJson: number;
  ms: number[];
  wonPer1000?: number;
  fails: Array<{ id: string; text: string; bad: string[] }>;
}
function scoreOne(name: string, items: Item[], get: (x: Item) => { cmds: Command[] | null; ms?: number } | null): Score {
  const s: Score = { name, n: { single: 0, cart: 0, odd: 0 }, pass: { single: 0, cart: 0, odd: 0 }, allergy: 0, badJson: 0, ms: [], fails: [] };
  for (const x of items) {
    const g = get(x);
    if (!g) continue;
    s.n[x.kind]++;
    if (g.ms !== undefined) s.ms.push(g.ms);
    if (!g.cmds) {
      s.badJson++;
      s.fails.push({ id: x.id, text: x.text, bad: ['JSON 아님·응답 없음'] });
      continue;
    }
    let bad: string[] = [];
    if (x.kind === 'single') {
      const { r, ch } = asSingle(g.cmds);
      bad = judge(x.text, x.want!, r, ch, nameOf, ing);
      if (bad.some((b) => b.startsWith('allergies') || b.startsWith('말 안 한 알레르기'))) s.allergy++;
    } else if (x.kind === 'cart') {
      const lines = applyCommands([], g.cmds, REC_IDS);
      const qty = lines.reduce((a, l) => a + l.qty, 0);
      const persons = new Set(g.cmds.filter((c) => c.op === 'ADD').map((c) => c.person ?? (c.name ? `n:${c.name}` : 1))).size;
      const ok = (x.gold!.single ? lines.length <= 1 : lines.length === x.gold!.lines && (x.gold!.qty === undefined || qty === x.gold!.qty)) && (x.gold!.persons === undefined || persons === x.gold!.persons) && (!x.gold!.reason || !!reasons.get(x.id) || !x.id.startsWith('새말투'));
      if (!ok) bad = [`${lines.length}줄 (${qty}개) · 사람 ${persons} · 상황 ${reasons.get(x.id) ?? '-'} / 기대 ${x.gold!.lines}줄${x.gold!.qty ? ` ${x.gold!.qty}개` : ''}${x.gold!.persons ? ` 사람 ${x.gold!.persons}` : ''}${x.gold!.reason ? ' 상황 있음' : ''}`];
    } else {
      const lines = applyCommands(seedLines(x.cart), g.cmds, REC_IDS).map(toGot);
      const j = judgeLines(x.goldLines!, lines);
      bad = j.bad;
      if (j.allergyMistake) s.allergy++;
    }
    if (bad.length) s.fails.push({ id: x.id, text: x.text, bad });
    else s.pass[x.kind]++;
  }
  return s;
}
function score() {
  const items = JSON.parse(readFileSync(`${DIR}/items.json`, 'utf8')) as Item[];
  const read = (f: string) => (existsSync(`${DIR}/${f}`) ? JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')) : null);
  const scores: Score[] = [];
  for (const [file, label] of [['out-openai.json', 'OpenAI gpt-5-mini (생각 low)'], ['out-openai-minimal.json', 'OpenAI gpt-5-mini (생각 minimal)']] as const) {
    const oa = read(file) as Record<string, { raw: string; ms: number; inTok?: number; outTok?: number }> | null;
    if (!oa) continue;
    const s = scoreOne(label, items, (x) => (oa[x.id] ? { cmds: oa[x.id]!.raw.startsWith('ERROR') ? null : parseCommands(oa[x.id]!.raw, x), ms: oa[x.id]!.ms } : null));
    // gpt-5-mini: 입력 $0.25 / 출력 $2.00 (100만 토큰당), 1달러 1,400원으로 셈
    const v = Object.values(oa).filter((o) => o.inTok);
    const usd = v.reduce((a, o) => a + (o.inTok! * 0.25 + (o.outTok ?? 0) * 2) / 1e6, 0);
    if (v.length) s.wonPer1000 = Math.round((usd / v.length) * 1000 * 1400);
    scores.push(s);
  }
  // 일부만 시험한 답 (--extra a.json,b.json): 그 문장만 채점
  for (const f of arg('--extra')?.split(',') ?? []) {
    const o = read(f) as Record<string, { raw: string; ms: number }>;
    scores.push(scoreOne(f, items, (x) => (o[x.id] ? { cmds: o[x.id]!.raw.startsWith('ERROR') ? null : parseCommands(o[x.id]!.raw, x), ms: o[x.id]!.ms } : null)));
  }
  const gm = read('out-gemma.json') as Record<string, { raw: string; ms: number }> | null;
  if (gm) scores.push({ ...scoreOne('젬마 (A100)', items, (x) => (gm[x.id] ? { cmds: gm[x.id]!.raw.startsWith('ERROR') ? null : parseCommands(gm[x.id]!.raw, x), ms: gm[x.id]!.ms } : null)), wonPer1000: 0 });
  const tr = read('out-trained.json') as { secPer: number; preds: Record<string, string> } | null;
  if (tr) scores.push({ ...scoreOne('학습 모델 (10/21, 한 개 주문만)', items, (x) => (tr.preds[x.id] !== undefined ? { cmds: trainedToCommands(tr.preds[x.id]!, x), ms: tr.secPer * 1000 } : null)), wonPer1000: 0 });
  // 지금 방식: 한 개 주문은 규칙만(이 컴퓨터), 예상 밖은 실제 화면(규칙 + A100 보조)
  const rs = read('out-rules-single.json') as Record<string, { r: any; ch: any; ms: number }> | null;
  const ro = read('out-rules-odd.json') as Record<string, { lines: GotLine[]; ms: number }> | null;
  if (rs || ro) {
    const s: Score = { name: '지금 방식 (규칙 먼저)', n: { single: 0, cart: 0, odd: 0 }, pass: { single: 0, cart: 0, odd: 0 }, allergy: 0, badJson: 0, ms: [], fails: [], wonPer1000: 0 };
    for (const x of items) {
      let bad: string[] | null = null;
      if (x.kind === 'single' && rs?.[x.id]) {
        bad = judge(x.text, x.want!, rs[x.id]!.r, rs[x.id]!.ch, nameOf, ing);
        if (bad.some((b) => b.startsWith('allergies') || b.startsWith('말 안 한 알레르기'))) s.allergy++;
      } else if (x.kind === 'odd' && ro?.[`${x.id.replace('예상밖-', '')}`]) {
        const o = ro[x.id.replace('예상밖-', '')]!;
        const j = judgeLines(x.goldLines!, o.lines);
        bad = j.bad;
        if (j.allergyMistake) s.allergy++;
        s.ms.push(o.ms);
      }
      if (!bad) continue;
      s.n[x.kind]++;
      if (bad.length) s.fails.push({ id: x.id, text: x.text, bad });
      else s.pass[x.kind]++;
    }
    const cartLive = arg('--rules-cart'); // cart-talk-check 결과 "통과/100" (화면, 실제 주소)
    if (cartLive) (s.n.cart = 100), (s.pass.cart = Number(cartLive));
    scores.push(s);
  }
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
  const q = (xs: number[], p: number) => (xs.length ? Math.round([...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)]!) : 0);
  const kindOf = new Map(items.map((x) => [x.id, x.kind]));
  // 서비스 약속 칸(세트 구성품을 열량으로 고르기·음료 이름)은 말 이해가 아니라 엔진이 정할 것 → 뺀 점수도
  const core = (s: Score) => s.n.single - s.fails.filter((f) => kindOf.get(f.id) === 'single' && f.bad.some((b) => !/^(setItem|drink):/.test(b))).length;
  console.log('| AI | 한 개 주문 | (약속 칸 빼고) | 장바구니 | 예상 밖 | 전체 | 알레르기 실수 | JSON 실패 | 응답 p50 / p95 | 1,000번 비용 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of scores) {
    const all = s.pass.single + s.pass.cart + s.pass.odd;
    const n = s.n.single + s.n.cart + s.n.odd;
    console.log(`| ${s.name} | ${s.pass.single}/${s.n.single} (${pct(s.pass.single, s.n.single)}) | ${pct(core(s), s.n.single)} | ${s.pass.cart}/${s.n.cart} | ${s.pass.odd}/${s.n.odd} | ${pct(all, n)} | ${s.allergy} | ${s.badJson} | ${q(s.ms, 0.5)}ms / ${q(s.ms, 0.95)}ms | ${s.wonPer1000 === undefined ? '-' : s.wonPer1000 ? `약 ${s.wonPer1000.toLocaleString('ko-KR')}원` : '0원 (우리 GPU)'} |`);
  }
  writeFileSync(`${DIR}/result.json`, JSON.stringify(scores.map((s) => ({ ...s, ms: undefined, p50: q(s.ms, 0.5), p95: q(s.ms, 0.95) })), null, 1));
}

if (mode === 'prep') prep();
else if (mode === 'openai') await openai();
else if (mode === 'rules') await rules();
else score();
