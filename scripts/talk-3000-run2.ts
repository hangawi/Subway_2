// 3,000문장 2차·3차 돌리기 (10/20): 알아들은 값 + 깊게 보기(talk-deep.ts) + 대화 이어 말하기 + 시간대
//   npx tsx scripts/talk-3000-run2.ts --set 2 [--live https://subway.metasolveai.com] [--from 0 --to 1000] [--ids A,B] [--group G]
//   규칙만: 이 컴퓨터에서 해석 + 추천(가짜 매장 1곳)까지 / --live: 해석은 실제 주소(규칙 + A100), 주문서 점검은 같은 코드로 이 컴퓨터에서
// 결과: var/talk-3000-<set>-fails.json, var/talk-3000-<set>-result.json
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { interpret } from '../src/conversation/interpret.ts';
import { createSubwayServer } from '../src/server/server.ts';
import type { Providers } from '../src/server/providers.ts';
import { stamp } from '../vendor/sophia/services/providers/place-data-provider.ts';
import { judge, needsSecondPass } from './talk-cases.ts';
import { deepCheck } from './talk-deep.ts';
import type { TalkCase2 } from './talk-3000-2.ts';

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const set = arg('--set') ?? '2';
const live = arg('--live');
const from = Number(arg('--from') ?? 0);
const to = Number(arg('--to') ?? 100000);
const only = arg('--group');
const ids = arg('--ids')?.split(',');
const catalog = loadSubwayCatalog();
const gen = set === '1' ? (await import('./talk-3000.ts')).make3000 : set === '2' ? (await import('./talk-3000-2.ts')).make3000b : set === '3' ? (await import('./talk-3000-3.ts')).make3000c : (await import(`./talk-3000-${set}.ts`)).make3000d;
const all = gen(catalog) as TalkCase2[];
const list = all.slice(from, to).filter((c) => (!only || c.group === only) && (!ids || ids.includes(c.id)));
const sample = catalog.menus.find((m) => m.name === '로스트 치킨')!.id;
const nameOf = (id: string | null) => (id ? (catalog.menus.find((m) => m.id === id)?.name ?? id) : null);
const ing = (id: string) => catalog.ingredients.find((x) => x.id === id)?.name ?? catalog.singles?.find((x) => x.id === id)?.name ?? id;

// 추천은 이 컴퓨터 서버로 (가짜 매장 1곳, 24시간)
const providers: Providers = {
  places: {
    name: 'fake',
    search: async () => ({ ok: true, data: [], stamp: stamp('fake', false, 0, 1) }),
    nearby: async (_k, _c, radius) => ({ ok: true, data: radius === 1000 ? [{ place_id: 'kakao:1', name: '써브웨이 강남역점', category: null, address: '서울', point: { lat: 37.499, lng: 127.0276 }, phone: '02-1', url: null, distance_m: 150 }] : [], stamp: stamp('fake', true, 0, 1) }),
  },
  sources: { hours: { name: 'h', hours: async () => ({ ok: true, data: { status: 'OPERATIONAL', periods: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, minute: 0 }, close: { day, minute: 1439 } })) }, stamp: stamp('h', false, 0, 1) }) } },
  ready: { places: true, hours: true, walk: false, transit: false, car: false },
};
const server = createSubwayServer({ catalog, providers, version: { commit: 'l', engineSource: 'l', builtAt: 't' }, clock: () => new Date('2026-10-21T12:10:00+09:00') });
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const post = async (url: string, body: unknown) => {
  for (let t = 0; t < 3; t++) {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (res && res.status === 200) return res.json();
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return { error: 'NO_RESPONSE' };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ask(text: string, context: any): Promise<any> {
  if (!live) {
    const r = await interpret(text, catalog, context, null);
    return { ...r, ask: r.intent.ask ?? null };
  }
  return post(`${live}/api/interpret`, { text, context });
}

const resultFile = `var/talk-3000-${set}-result.json`;
const result: Record<string, string> = existsSync(resultFile) ? JSON.parse(readFileSync(resultFile, 'utf8')) : {};
const fails: Array<{ id: string; group: string; before?: string[] | undefined; text: string; bad: string[]; understood: string[]; question: string | null; refusals: string[]; source: string }> = [];
const byGroup: Record<string, { pass: number; total: number }> = {};
const times: number[] = [];
let aiCalls = 0;
for (const c of list) {
  // 앞 말 (화면처럼: 메뉴·선택은 이어받고 조건은 합침)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = {};
  for (const b of c.before ?? []) {
    const p = await ask(b, { ...ctx });
    if (p.source === 'RULES+AI') aiCalls++;
    ctx.menuId = p.menuId ?? ctx.menuId;
    ctx.choices = p.choices ?? ctx.choices;
    ctx.prefs = { ...(ctx.prefs ?? {}), ...(p.prefs ?? {}) };
  }
  const t0 = performance.now();
  const r = await ask(c.text, { ...ctx });
  times.push(performance.now() - t0);
  if (r.source === 'RULES+AI') aiCalls++;
  const menuId = r.menuId ?? ctx.menuId ?? null;
  let ch = r.choices ?? (r.menuId ? null : ctx.choices) ?? {};
  const rr = { ...r, menuId };
  // 메뉴를 안 골랐으면 (막연한 말·조건만) 추천 Top3 — 규칙만 시험에서만 (실제 주소 추천은 매장 검색을 불러서 뺌)
  const rec = !r.error && !live && !menuId && !r.refusals?.some((x: string) => /배달|없어요/.test(x)) ? await post(`${base}/api/menus/recommend`, { location: { lat: 37.4979, lng: 127.0276 }, prefs: r.prefs, at: c.at ?? '2026-10-21T12:10:00+09:00' }) : undefined;
  // 화면처럼 1위 메뉴에 같은 말을 다시 적용 (실제 주소 시험은 1위를 모르니 로스트 치킨으로 — 그때는 메뉴 알레르기는 안 봄)
  let secondMenu: string | null = null;
  if (!r.error && !menuId && needsSecondPass(r)) {
    // 추천이 없으면(조건에 맞는 메뉴가 없음) 화면도 메뉴를 안 고름
    // 10/21: 화면이 1위를 알아서 고르지 않고 사람이 Top3에서 고름 → 말한 옵션이 다 들어가는(주문서 오류 없는) 첫 메뉴를 고른다
    const tops: string[] = rec ? (rec.menus?.top ?? []).map((m: { id: string }) => m.id) : [sample];
    secondMenu = tops[0] ?? null;
    for (const id of tops) {
      const r2 = await ask(c.text, { menuId: id, prefs: r.prefs, skipAi: true });
      if (!(r2.orderErrors ?? []).length) {
        secondMenu = id;
        ch = r2.choices ?? {};
        break;
      }
      if (id === tops[0]) ch = r2.choices ?? {};
    }
  }
  // 조건에 맞는 메뉴가 정말 없으면 메뉴를 안 고르니 옵션(음료·야채·세트)은 붙일 주문서가 없음 → 조건만 본다
  const noMenu = rec?.menus?.status === 'NO_FEASIBLE_CANDIDATE' && !menuId;
  const want = noMenu ? Object.fromEntries(Object.entries(c.want).filter(([k]) => !['extras', 'remove', 'add', 'sauces', 'set', 'drink', 'setItem', 'notRemove', 'bread', 'size'].includes(k))) : c.want;
  const bad = r.error ? ['응답 없음'] : judge(c.text, want, rr, ch, nameOf, ing);
  if (!r.error) {
    bad.push(...deepCheck(catalog, { want: c.want, top: c.top, r: rr, menuId: menuId ?? secondMenu, choices: ch, rec, skipMenuAllergy: secondMenu === sample && !rec }));
  }
  const g = (byGroup[c.group] ??= { pass: 0, total: 0 });
  g.total++;
  if (bad.length) fails.push({ id: c.id, group: c.group, before: c.before, text: c.text, bad, understood: r.understood ?? [], question: r.question ?? null, refusals: r.refusals ?? [], source: r.source });
  else g.pass++;
  result[c.id] = bad.length ? '❌' : '✅';
}
server.close();
writeFileSync(`var/talk-3000-${set}-fails.json`, JSON.stringify(fails, null, 1));
writeFileSync(resultFile, JSON.stringify(result));
const sorted = [...times].sort((a, b) => a - b);
const pass = Object.values(byGroup).reduce((a, g) => a + g.pass, 0);
console.log(`${set}차 ${live ? `실제 주소 ${live}` : '규칙만'} · ${from}~${Math.min(to, all.length)} (${list.length}문장)`);
for (const [g, v] of Object.entries(byGroup)) console.log(`  ${v.pass === v.total ? '✅' : '❌'} ${g}: ${v.pass}/${v.total}`);
console.log(`통과 ${pass} / ${list.length} (${((pass / Math.max(1, list.length)) * 100).toFixed(1)}%) · AI 부름 ${aiCalls} · 응답 p50 ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)}ms · p95 ${Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0)}ms`);
console.log(`틀린 문장: var/talk-3000-${set}-fails.json (${fails.length}개)`);
