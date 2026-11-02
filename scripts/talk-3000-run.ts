// 3,000문장 돌리기 (10/20): 규칙만(이 컴퓨터, 비용 없음) 또는 --live <주소> (실제 주소: 규칙 + A100).
//   npx tsx scripts/talk-3000-run.ts [--live https://subway.metasolveai.com] [--from 0 --to 1000] [--group L섞기] [--ids L섞기-347,L섞기-559]
// 결과: 묶음별 통과 수, 틀린 문장(var/talk-3000-fails.json), 문장별 ✅/❌ (var/talk-3000-result.json → --docs 목록에 표시)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { interpret } from '../src/conversation/interpret.ts';
import { make3000 } from './talk-3000.ts';
import { judge, needsSecondPass } from './talk-cases.ts';

const arg = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : undefined);
const live = arg('--live');
const from = Number(arg('--from') ?? 0);
const to = Number(arg('--to') ?? 100000);
const only = arg('--group');
const catalog = loadSubwayCatalog();
const all = make3000(catalog);
const ids = arg('--ids')?.split(',');
const list = all.slice(from, to).filter((c) => (!only || c.group === only) && (!ids || ids.includes(c.id)));
const sample = catalog.menus.find((m) => m.name === '로스트 치킨')!.id;
const nameOf = (id: string | null) => (id ? (catalog.menus.find((m) => m.id === id)?.name ?? id) : null);
const ing = (id: string) => catalog.ingredients.find((x) => x.id === id)?.name ?? catalog.singles?.find((x) => x.id === id)?.name ?? id;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ask(text: string, context: any): Promise<any> {
  if (!live) {
    const r = await interpret(text, catalog, context, null);
    return { ...r, ask: r.intent.ask ?? null };
  }
  for (let t = 0; t < 3; t++) {
    const res = await fetch(`${live}/api/interpret`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, context }) }).catch(() => null);
    if (res && res.status === 200) return res.json();
    await new Promise((ok) => setTimeout(ok, 500));
  }
  return { error: 'NO_RESPONSE' };
}

const result: Record<string, string> = existsSync('var/talk-3000-result.json') ? JSON.parse(readFileSync('var/talk-3000-result.json', 'utf8')) : {};
const fails: Array<{ id: string; group: string; text: string; bad: string[]; understood: string[]; question: string | null; refusals: string[]; source: string }> = [];
const byGroup: Record<string, { pass: number; total: number }> = {};
const times: number[] = [];
let aiCalls = 0;
let next = 0;
async function worker() {
  while (next < list.length) {
    const c = list[next++]!;
    const t0 = performance.now();
    const r = await ask(c.text, {});
    times.push(performance.now() - t0);
    if (r.source === 'RULES+AI' || r.aiStatus === 'USED') aiCalls++;
    let ch = r.choices ?? {};
    if (!r.error && needsSecondPass(r)) ch = (await ask(c.text, { menuId: sample, prefs: r.prefs, skipAi: true })).choices ?? {};
    const bad = r.error ? ['응답 없음'] : judge(c.text, c.want, r, ch, nameOf, ing);
    const g = (byGroup[c.group] ??= { pass: 0, total: 0 });
    g.total++;
    if (bad.length) fails.push({ id: c.id, group: c.group, text: c.text, bad, understood: r.understood ?? [], question: r.question ?? null, refusals: r.refusals ?? [], source: r.source });
    else g.pass++;
    result[c.id] = bad.length ? '❌' : '✅';
  }
}
// 10/20: 4개씩 동시에 보내면 A100이 한 번 늦어(TIMEOUT) OpenAI로 넘어갔다 → 기본 1개 (--workers N)
await Promise.all(Array.from({ length: Number(arg('--workers') ?? 1) }, worker));
writeFileSync('var/talk-3000-fails.json', JSON.stringify(fails, null, 1));
writeFileSync('var/talk-3000-result.json', JSON.stringify(result));
const sorted = [...times].sort((a, b) => a - b);
const pass = Object.values(byGroup).reduce((a, g) => a + g.pass, 0);
console.log(`${live ? `실제 주소 ${live}` : '규칙만'} · ${from}~${Math.min(to, all.length)} (${list.length}문장)`);
for (const [g, v] of Object.entries(byGroup)) console.log(`  ${v.pass === v.total ? '✅' : '❌'} ${g}: ${v.pass}/${v.total}`);
console.log(`통과 ${pass} / ${list.length} (${((pass / Math.max(1, list.length)) * 100).toFixed(1)}%) · AI 부름 ${aiCalls} · 응답 p50 ${Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0)}ms · p95 ${Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0)}ms`);
console.log(`틀린 문장: var/talk-3000-fails.json (${fails.length}개)`);
