// 3,000문장 시험 중 "취향 기억하기" 이야기 약 100개 (10/20). 여러 번 말하고 주문하고 날짜가 지나는 이야기로,
// 화면(app.ts)이 하는 일을 그대로 따라 한다: 말 → 취향 기록(TasteRecord) → buildTaste → /api/menus/recommend(taste 점수)
//   npx tsx scripts/taste-stories.ts [--live https://subway.metasolveai.com] [--docs]
//   --live: 말 해석만 실제 주소로 (추천은 이 컴퓨터 서버 — 가짜 매장 1곳)
// 결과: var/taste-stories-result.json (이야기별 ✅/❌), --docs 이면 docs/검수/3000문장_목록.md 끝에 이야기 목록을 붙인다
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { loadSubwayCatalog, type CatalogMenu } from '../src/catalog/subway-catalog.ts';
import { interpret } from '../src/conversation/interpret.ts';
import { createSubwayServer } from '../src/server/server.ts';
import type { Providers } from '../src/server/providers.ts';
import { mainKindsOf, type MainKind } from '../src/subway-menu/menu-domain.ts';
import { buildTaste, dayEndValidUntil, DAY_END_POLICY, usualChoices, type OrderLike, type TasteRecord } from '../src/web/taste.ts';
import type { VenueHours } from '../vendor/sophia/packages/contracts/src/place-contract.ts';
import { stamp, type PlaceDataProvider } from '../vendor/sophia/services/providers/place-data-provider.ts';

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const live = arg('--live');
const catalog = loadSubwayCatalog();

// ── 이야기 한 칸 ──
export type Step =
  | { say: string; at?: string }
  | { order: string; remove?: string[]; add?: string[] }
  | { del: 'record' | 'menu' }
  | { newSession: true }
  | { check: Check; at?: string; say?: string };
export interface Check {
  /** 추천 Top3에 이 메인 재료 메뉴가 있어야 함 / 없어야 함 */
  has?: MainKind | MainKind[]; lacks?: MainKind | MainKind[];
  /** 10/20 2차: 말의 질문 종류(LAST 등), [평소처럼]에 더할 야채, 막연한 말 */
  ask?: string; usualAdd?: string; vague?: boolean;
  /** 추천 Top3에 이 메뉴 */
  hasMenu?: string;
  /** 내 취향 목록 글에 이 말이 있음 / 없음 */
  item?: string; noItem?: string;
  /** 취향 목록이 비었음 */
  empty?: boolean;
  /** [평소처럼]에 뺄 야채 */
  usualRemove?: string;
  /** 오늘 피곤함이 살아 있음 / 없음 */
  tired?: boolean;
  /** 예산 이하만 */
  maxPrice?: number;
  /** 이 알레르기 성분이 든 메뉴는 없음 */
  noAllergen?: string;
}
export interface Story { id: string; title: string; consent: boolean; steps: Step[]; /** 주문 기록 끔 (주문해도 안 배움) */ ordersOff?: boolean }

const NOON = '2026-10-20T12:10:00+09:00';
const NIGHT = '2026-10-20T23:30:00+09:00';
const NEXT_EARLY = '2026-10-21T03:30:00+09:00';
const NEXT_DAY = '2026-10-21T12:10:00+09:00';
const MAIN_WORDS: Array<[MainKind, string[]]> = [
  ['쇠고기', ['소고기', '쇠고기']],
  ['닭고기', ['닭고기', '치킨']],
  ['돼지고기', ['돼지고기', '햄']],
  ['새우', ['새우', '쉬림프']],
  ['참치', ['참치', '튜나']],
  ['달걀', ['계란', '달걀']],
  ['야채', ['채식', '야채만 든 거']],
];

export function makeStories(): Story[] {
  const out: Story[] = [];
  const add = (title: string, steps: Step[], consent = true) => out.push({ id: `T${String(out.length + 1).padStart(3, '0')}`, title, consent, steps });
  for (const [k, words] of MAIN_WORDS) {
    for (const w of words) {
      add(`평소 ${w} 좋아함 → 추천에 ${k}`, [{ say: `평소에 ${w} 좋아해` }, { check: { has: k, item: `평소 ${k} 좋아함` }, say: '추천해줘' }]);
      add(`평소 ${w} 싫어함 → 추천에 ${k} 없음`, [{ say: `나 원래 ${w} 별로야` }, { check: { lacks: k, item: `평소 ${k} 피함` }, say: '추천해줘' }]);
    }
    const w = words[0]!;
    add(`오늘 ${w} 땡김 → 밤까지 유지`, [{ say: `오늘은 ${w} 땡겨` }, { check: { has: k, item: `오늘은 ${k} 좋아함` }, at: NIGHT }]);
    add(`오늘 ${w} 땡김 → 다음 날 새벽 4시 지나면 사라짐`, [{ say: `오늘은 ${w} 땡겨` }, { check: { item: `오늘은 ${k} 좋아함` }, at: NEXT_EARLY }, { check: { empty: true }, at: NEXT_DAY }]);
    add(`평소 ${w} 좋아함 + 오늘은 피함 → 오늘은 빼고, 내일은 다시`, [{ say: `평소에 ${w} 좋아해` }, { say: `오늘은 ${w} 피할래` }, { check: { lacks: k }, at: NOON }, { check: { has: k, noItem: `오늘은 ${k} 피함` }, at: NEXT_DAY }]);
    add(`취향 기억하기 끔 → 이 화면 동안만 (${w})`, [{ say: `평소에 ${w} 좋아해` }, { check: { has: k } }, { newSession: true }, { check: { empty: true } }], false);
    add(`취향 기억하기 켬 → 다시 열어도 남음 (${w})`, [{ say: `평소에 ${w} 좋아해` }, { newSession: true }, { check: { has: k, item: `평소 ${k} 좋아함` } }]);
    add(`말한 취향 지우기 → 추천에서 빠짐 (${w})`, [{ say: `평소에 ${w} 좋아해` }, { del: 'record' }, { check: { empty: true } }]);
  }
  const sw = catalog.menus.filter((m) => m.kind === 'SANDWICH' && !/^미니/.test(m.name));
  for (const m of sw.slice(0, 10)) add(`${m.name} 2번 주문 → 자주 고른 메뉴로 위에`, [{ order: m.name }, { order: m.name }, { check: { hasMenu: m.name, item: `자주 고른 메뉴: ${m.name} (2번)` } }]);
  for (const m of sw.slice(10, 15)) add(`${m.name} 1번 주문 → 아직 취향 아님`, [{ order: m.name }, { check: { noItem: '자주 고른 메뉴', empty: true } }]);
  for (const [m, v] of [[sw[0]!, '양파'], [sw[1]!, '피클'], [sw[2]!, '올리브'], [sw[3]!, '할라피뇨'], [sw[4]!, '오이']] as const)
    add(`${v} 빼고 2번 주문 → [평소처럼]에 ${v} 빼기`, [{ order: m.name, remove: [v] }, { order: m.name, remove: [v] }, { order: sw[5]!.name }, { check: { usualRemove: v, item: `늘 ${v} 빼기` } }]);
  for (const m of sw.slice(5, 10)) add(`자주 고른 메뉴 지우기 → 다시 안 배움 (${m.name})`, [{ order: m.name }, { order: m.name }, { del: 'menu' }, { order: m.name }, { check: { noItem: `자주 고른 메뉴: ${m.name}` } }]);
  for (const t of ['오늘 너무 피곤해', '오늘 좀 지쳤어', '피곤해 죽겠어', '오늘 기운이 없어', '오늘 힘들어'])
    add(`"${t}" → 오늘만 든든한 쪽, 내일은 없음`, [{ say: t }, { check: { tired: true } }, { check: { tired: false }, at: NEXT_DAY }]);
  add('평소 새우 좋아함 + 새우 알레르기 → 알레르기가 이김', [{ say: '평소에 새우 좋아해' }, { check: { noAllergen: '새우' }, say: '새우 알레르기 있어 추천해줘' }]);
  add('평소 참치 좋아함 + 우유 알레르기 → 우유 든 메뉴 없음', [{ say: '평소에 참치 좋아해' }, { check: { noAllergen: '우유' }, say: '우유 알레르기야' }]);
  add('평소 달걀 좋아함 + 난류 알레르기 → 달걀 메뉴 없음', [{ say: '평소에 계란 좋아해' }, { check: { noAllergen: '난류', lacks: '달걀' }, say: '계란 알레르기 있어' }]);
  for (const [k, w] of [['쇠고기', '소고기'], ['닭고기', '치킨'], ['돼지고기', '돼지고기'], ['참치', '참치'], ['야채', '채식']] as const)
    add(`평소 ${w} 좋아함 + 만 원 이하 → 예산 안에서 ${k}`, [{ say: `평소에 ${w} 좋아해` }, { check: { maxPrice: 10000 }, say: '만원 이하로 추천해줘' }]);
  return out;
}

// ── 화면 흉내 ──
const gangnam = { lat: 37.4979, lng: 127.0276 };
const places: PlaceDataProvider = {
  name: 'fake',
  search: async () => ({ ok: true, data: [], stamp: stamp('fake', false, 0, 1) }),
  nearby: async (_k, _c, radius) => ({
    ok: true,
    data: radius === 1000 ? [{ place_id: 'kakao:1', name: '써브웨이 강남역점', category: null, address: '서울', point: { lat: 37.499, lng: 127.0276 }, phone: '02-1', url: null, distance_m: 150 }] : [],
    stamp: stamp('fake', true, 0, 1),
  }),
};
const daily: VenueHours = { status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 0 }, close: { day, minute: 1439 } })) };
const providers: Providers = { places, sources: { hours: { name: 'h', hours: async () => ({ ok: true, data: daily, stamp: stamp('h', false, 0, 1) }) } }, ready: { places: true, hours: true, walk: false, transit: false, car: false } };

const byName = (n: string) => catalog.menus.find((m) => m.name === n);
const vegId = (n: string) => catalog.ingredients.find((x) => x.category === 'VEGETABLE' && x.name === n)?.id ?? n;
let aiCalls = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function say(text: string, prefs: unknown): Promise<any> {
  if (!live) {
    const r = await interpret(text, catalog, { prefs: prefs as never }, null);
    return { ...r, ask: r.intent.ask ?? null };
  }
  const res = await fetch(`${live}/api/interpret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, context: { prefs } }) });
  const j = await res.json();
  if (j.source === 'RULES+AI') aiCalls++;
  return j;
}

export async function runStory(st: Story, base: string): Promise<string[]> {
  const bad: string[] = [];
  let saved: TasteRecord[] = [];
  let session: TasteRecord[] = [];
  const orders: OrderLike[] = [];
  const suppressed: string[] = [];
  let prefs: Record<string, unknown> = {};
  let now = new Date(NOON);
  const remember = (r: { tastes?: Array<{ main: MainKind; sign: 1 | -1; scope: 'LASTING' | 'TODAY' }>; mood?: string | null }) => {
    const rec = (scope: 'LASTING' | 'TODAY', target: TasteRecord['target'], sign: 1 | -1): TasteRecord => ({
      id: `${Math.random()}`, scope, target, sign, at: now.toISOString(),
      valid_until: scope === 'TODAY' ? dayEndValidUntil(now) : null, policy: scope === 'TODAY' ? DAY_END_POLICY : null, account_id: null,
    });
    const recs = [...(r.tastes ?? []).map((t) => rec(t.scope, { type: 'main', id: t.main }, t.sign)), ...(r.mood === 'TIRED' ? [rec('TODAY', { type: 'mood', id: 'TIRED' }, 1)] : [])];
    for (const x of recs) {
      const same = (y: TasteRecord) => y.scope === x.scope && y.target.type === x.target.type && y.target.id === x.target.id;
      if (st.consent) saved = [x, ...saved.filter((y) => !same(y))];
      else session = [x, ...session.filter((y) => !same(y))];
    }
    return recs.length;
  };
  for (const step of st.steps) {
    if ('say' in step && !('check' in step)) {
      if (step.at) now = new Date(step.at);
      const r = await say(step.say, prefs);
      if (!remember(r)) bad.push(`"${step.say}" → 취향으로 못 알아들음 (${(r.understood ?? []).join(', ')})`);
      prefs = r.prefs ?? prefs;
    } else if ('order' in step) {
      const m = byName(step.order)!;
      if (!st.ordersOff) orders.push({ menuId: m.id, menuName: m.name, choices: { ...(step.remove ? { removeVegetables: step.remove.map(vegId) } : {}), ...(step.add ? { addVegetables: step.add.map(vegId) } : {}) } });
    } else if ('del' in step) {
      if (step.del === 'record') (saved = []), (session = []);
      else for (const o of orders) suppressed.push(`menu:${o.menuId}`);
    } else if ('newSession' in step) {
      session = [];
      prefs = {};
    } else if ('check' in step) {
      if (step.at) now = new Date(step.at);
      let said: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (step.say) {
        said = await say(step.say, prefs);
        remember(said);
        prefs = said.prefs ?? prefs;
      }
      const t = buildTaste(orders, [...saved, ...session], suppressed, now);
      const c = step.check;
      const texts = t.items.map((x) => x.text);
      // 화면처럼: 오늘 피곤함이 있고 목표를 안 정했으면 든든하게
      const send = { ...prefs, ...(t.tired && !prefs.goal ? { goal: 'FILLING' } : {}), ...(t.taste.menus || t.taste.mains ? { taste: t.taste } : {}) };
      const res = await fetch(`${base}/api/menus/recommend`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ location: gangnam, prefs: send, at: now.toISOString() }) });
      const j = await res.json();
      const top: CatalogMenu[] = (j.menus?.top ?? []).map((x: { name: string }) => byName(x.name)).filter(Boolean);
      const tops = top.map((m) => m.name).join(', ');
      if (!top.length) bad.push(`추천 없음 (${j.error ?? j.menus?.status ?? ''})`);
      for (const k of [c.has ?? []].flat()) if (!top.some((m) => mainKindsOf(m).includes(k))) bad.push(`Top3에 ${k} 없음: ${tops}`);
      for (const k of [c.lacks ?? []].flat()) if (top.some((m) => mainKindsOf(m).includes(k))) bad.push(`Top3에 ${k} 있음: ${tops}`);
      if (c.ask && said?.ask !== c.ask) bad.push(`질문 종류: 기대 ${c.ask} / 실제 ${said?.ask}`);
      if (c.vague !== undefined && !!said?.vague !== c.vague) bad.push(`막연한 말: 기대 ${c.vague} / 실제 ${!!said?.vague}`);
      if (c.usualAdd && !usualChoices(orders, suppressed).addVegetables.includes(vegId(c.usualAdd))) bad.push(`[평소처럼]에 ${c.usualAdd} 더 없음`);
      if (c.hasMenu && !top.some((m) => m.name === c.hasMenu)) bad.push(`Top3에 ${c.hasMenu} 없음: ${tops}`);
      if (c.item && !texts.some((x) => x.startsWith(c.item!))) bad.push(`취향 목록에 "${c.item}" 없음: ${texts.join(' / ') || '(비었음)'}`);
      if (c.noItem && texts.some((x) => x.startsWith(c.noItem!))) bad.push(`취향 목록에 "${c.noItem}" 남음`);
      if (c.empty && texts.length) bad.push(`취향 목록이 안 비었음: ${texts.join(' / ')}`);
      if (c.empty && (t.taste.menus || t.taste.mains)) bad.push('취향 점수가 남음');
      if (c.usualRemove && !usualChoices(orders, suppressed).removeVegetables.includes(vegId(c.usualRemove))) bad.push(`[평소처럼]에 ${c.usualRemove} 빼기 없음`);
      if (c.tired !== undefined && !!t.tired !== c.tired) bad.push(`피곤함 ${c.tired ? '없음' : '남음'}`);
      if (c.maxPrice && (j.menus?.top ?? []).some((x: { priceKrw?: number; price?: number }) => (x.priceKrw ?? x.price ?? 0) > c.maxPrice!)) bad.push(`예산 넘는 메뉴: ${tops}`);
      if (c.noAllergen && top.some((m) => m.allergens.contains.includes(c.noAllergen!))) bad.push(`${c.noAllergen} 든 메뉴가 Top3: ${tops}`);
    }
  }
  return bad;
}

if (process.argv[1]?.endsWith('taste-stories.ts')) {
  const server = createSubwayServer({ catalog, providers, version: { commit: 'local', engineSource: 'local', builtAt: 't' }, clock: () => new Date(NOON) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // --set 2: 2차 이야기 (scripts/taste-stories-2.ts)
  const setNo = process.argv.includes('--set') ? process.argv[process.argv.indexOf('--set') + 1]! : '1';
  const stories = setNo === '1' ? makeStories() : ((await import(`./taste-stories-${setNo}.ts`)) as { makeStories2: () => Story[] }).makeStories2();
  const result: Record<string, string> = {};
  let pass = 0;
  for (const st of stories) {
    const bad = await runStory(st, base);
    result[st.id] = bad.length ? '❌' : '✅';
    if (bad.length) console.log(`❌ ${st.id} ${st.title}\n    ${bad.join('\n    ')}`);
    else pass++;
  }
  server.close();
  writeFileSync(setNo === '1' ? 'var/taste-stories-result.json' : `var/taste-stories-${setNo}-result.json`, JSON.stringify(result));
  console.log(`취향 이야기 ${pass} / ${stories.length}${live ? ` · 말 해석 ${live} · AI 부름 ${aiCalls}` : ' · 규칙만'}`);
  if (process.argv.includes('--docs')) {
    const doc = setNo === '1' ? 'docs/검수/3000문장_목록.md' : `docs/검수/3000문장_목록_${setNo}차.md`;
    const head = existsSync(doc) ? readFileSync(doc, 'utf8').split('\n## 취향 기억하기 이야기')[0]! : '';
    const say1 = (s: Step) => ('order' in s ? `주문 ${s.order}${s.remove ? `(${s.remove.join('·')} 빼고)` : ''}${s.add ? `(${s.add.join('·')} 더)` : ''}` : 'del' in s ? (s.del === 'record' ? '말한 취향 지우기' : '자주 고른 메뉴 지우기') : 'newSession' in s ? '앱 다시 열기' : 'check' in s ? `확인${s.say ? ` "${s.say}"` : ''}${s.at ? ` (${s.at.slice(5, 16).replace('T', ' ')})` : ''}` : `"${s.say}"`);
    const rows = stories.map((s) => `| ${s.id} | ${s.title} | ${s.consent ? '켬' : '끔'}${s.ordersOff ? ' (주문 기록 끔)' : ''} | ${s.steps.map(say1).join(' → ')} | ${result[s.id]} |`);
    writeFileSync(doc, `${head.trimEnd()}\n\n## 취향 기억하기 이야기 (${stories.length}개)\n\n| 번호 | 이야기 | 취향 기억하기 | 순서 | 결과 |\n|---|---|---|---|---|\n${rows.join('\n')}\n`);
    console.log(`목록에 붙임: ${doc}`);
  }
}
