// 처음 보는 문장 150개 채점 (10/28 2부): 선생님(gpt-5 low) 정답과 장바구니 결과가 같은지 — 메뉴·개수·누구·알레르기·옵션·추천 조건
//   npx tsx scripts/train/held-score.ts var/train-cmd/held-base.json [var/train-cmd/held-subway.json]
import { readFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { applyCommands, validateCommands, type Command, type SimLine } from '../../src/conversation/command-ai.ts';

const c = loadSubwayCatalog();
const held = JSON.parse(readFileSync('var/train-cmd/heldout.json', 'utf8')) as Array<{ id: string; text: string; cart: Array<{ menu: string; qty: number; owner: 'ME' | 'GUEST'; name?: string }>; kind: number; answer: unknown }>;
const menuId = (n: string) => c.menus.find((m) => m.name === n)?.id ?? null;
const seed = (cart: (typeof held)[number]['cart']): SimLine[] => cart.map((l) => ({ menuId: menuId(l.menu), qty: l.qty, owner: l.owner, ...(l.name ? { name: l.name } : {}), allergies: [], choices: {} }));
const norm = (lines: SimLine[]) => lines.map((l) => JSON.stringify({ m: l.menuId, q: l.qty, o: l.owner, a: [...l.allergies].sort(), c: Object.fromEntries(Object.entries(l.choices).filter(([, v]) => v !== undefined).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]).sort()), w: l.cond ? Object.fromEntries(Object.entries(l.cond).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)).sort()) : null })).sort().join('|');
const view = (cmds: Command[], x: (typeof held)[number]) => {
  const lines = norm(applyCommands(seed(x.cart), cmds, []));
  const other = cmds.filter((k) => k.op !== 'ADD' && k.op !== 'EDIT' && k.op !== 'REMOVE').map((k) => `${k.op}:${JSON.stringify(Object.fromEntries(Object.entries(k.intent.conditions).filter(([, v]) => v != null).sort()))}`).sort().join('|');
  return `${lines}#${other}`;
};
for (const f of process.argv.slice(2)) {
  const out = JSON.parse(readFileSync(f, 'utf8')) as Record<string, { raw: string; ms: number }>;
  let same = 0, n = 0, bad = 0, allergy = 0;
  const ms: number[] = [];
  const byKind: Record<number, [number, number]> = {};
  for (const x of held) {
    const o = out[`held-${x.id}`];
    if (!o) continue;
    n++;
    ms.push(o.ms);
    const gold = validateCommands(x.answer, c, x.text, x.cart.length).commands;
    let got: Command[] | null = null;
    try { got = validateCommands(JSON.parse(o.raw), c, x.text, x.cart.length).commands; } catch { bad++; }
    const k = (byKind[x.kind] ??= [0, 0]);
    k[1]++;
    if (got && view(got, x) === view(gold, x)) (same++, k[0]++);
    const al = (cmds: Command[]) => JSON.stringify(applyCommands(seed(x.cart), cmds, []).map((l) => [...l.allergies].sort()));
    if (got && al(got) !== al(gold)) allergy++;
  }
  ms.sort((a, b) => a - b);
  console.log(`${f}: 선생님과 같은 결과 ${same}/${n} (${((same / Math.max(1, n)) * 100).toFixed(1)}%) · 알레르기 다름 ${allergy} · JSON 실패 ${bad} · 응답 p50 ${ms[ms.length >> 1]}ms · 종류별 ${JSON.stringify(byKind)}`);
}
