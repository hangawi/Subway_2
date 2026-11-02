// 말로 주문하기 집중 점검 (10/19, 로드맵 7.6-2): 실제 말투 문장을 실제 주소(규칙 + AI)에 넣어 알아들은 것을 대조한다.
// 실행: npx tsx scripts/talk-check.ts [주소]   — 틀린 것만 자세히, 끝에 통과 수
const base = process.argv[2] ?? 'https://subway.metasolveai.com';
import { CASES, judge, needsSecondPass } from './talk-cases.ts';


const opts = await (await fetch(base + '/api/options')).json();
const nameOf = (id: string | null) => (id ? opts.menus.find((m: { id: string }) => m.id === id)?.name ?? id : null);
const ing = (id: string) => [...opts.vegetables, ...opts.sauces, ...opts.breads, ...opts.cheeses, ...(opts.singles ?? [])].find((x: { id: string }) => x.id === id)?.name ?? id;
let pass = 0;
const fails: string[] = [];
const times: number[] = [];
for (const [text, want] of CASES) {
  const t0 = performance.now();
  const r = await (await fetch(base + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })).json();
  times.push(performance.now() - t0);
  // 화면과 같게: 메뉴를 안 말했으면 1위 메뉴를 골라 같은 말을 다시 적용 (AI는 또 안 부름) — 여기서는 1위 대신 샌드위치 하나로
  let ch = r.choices ?? {};
  if (needsSecondPass(r)) {
    const sample = opts.menus.find((m: { name: string }) => m.name === '로스트 치킨')!.id;
    const r2 = await (await fetch(base + '/api/interpret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, context: { menuId: sample, prefs: r.prefs, skipAi: true } }) })).json();
    ch = r2.choices ?? {};
  }
  const bad = judge(text, want, r, ch, nameOf, ing);
  if (bad.length) fails.push(`❌ "${text}"\n   ${bad.join('\n   ')}\n   이해: ${(r.understood ?? []).join(' / ')}${r.question ? ` | 질문: ${r.question}` : ''}${r.refusals?.length ? ` | 거절: ${r.refusals.join(' / ')}` : ''} [${r.source}]`);
  else pass++;
}
for (const f of fails) console.log(f);
const sorted = [...times].sort((a, b) => a - b);
console.log(`\n통과 ${pass} / ${CASES.length} · 응답 p50 ${Math.round(sorted[Math.floor(sorted.length / 2)]!)}ms · p95 ${Math.round(sorted[Math.floor(sorted.length * 0.95)]!)}ms`);
