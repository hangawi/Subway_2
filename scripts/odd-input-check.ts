// 엇갈린 입력 점검 (10/21, 매일 5가지 점검 ⑤): 이상한 값을 보내도 서버가 500 없이 4xx로 거절하고, 끝나도 /health가 정상인지
//   npx tsx scripts/odd-input-check.ts [주소]
// AI를 부르는 입력은 넣지 않음 (말 해석은 300자 넘김·빈 값처럼 해석 전에 거절되는 것만)
export {};
const base = process.argv[2] ?? 'https://subway.metasolveai.com';
let pass = 0;
let total = 0;
const ok = (name: string, cond: boolean, info = '') => {
  total++;
  if (cond) pass++;
  if (!cond) console.log(`❌ ${name} — ${info}`);
};
const post = async (path: string, body: unknown, raw = false) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? (body as string) : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
};
const gangnam = { lat: 37.4979, lng: 127.0276 };
const bad4xx = async (name: string, path: string, body: unknown, raw = false) => {
  const r = await post(path, body, raw);
  ok(name, r.status >= 400 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 80)}`);
};

// 몸통 모양
await bad4xx('JSON 아님', '/api/menus/recommend', '{"location":', true);
await bad4xx('몸통이 배열', '/api/menus/recommend', '[1,2]', true);
await bad4xx('위치 글자', '/api/menus/recommend', { location: { lat: 'x', lng: 1 } });
// 한국 밖은 거절이 아니라 "한국 밖이에요" 안내 (설계)
const out = await post('/api/menus/recommend', { location: { lat: 51.5, lng: -0.12 } });
ok('위치 한국 밖 → OUTSIDE_KOREA 안내', out.status === 200 && out.body.status === 'OUTSIDE_KOREA', JSON.stringify(out.body).slice(0, 80));
await bad4xx('위도 범위 밖', '/api/menus/recommend', { location: { lat: 999, lng: 127 } });
// 조건 값
for (const [k, v] of [['budgetKrw', -1], ['budgetKrw', 99_999_999], ['budgetKrw', 'abc'], ['goal', 'FAST'], ['allergies', ['외계인']], ['allergies', 'x'], ['kinds', ['PIZZA']], ['salty', 'VERY'], ['meal', 'BRUNCH'], ['wantMains', ['고래']], ['taste', { mains: { 쇠고기: 5 } }], ['maxEnergyKcal', -100]] as const)
  await bad4xx(`조건 ${k}=${JSON.stringify(v)}`, '/api/menus/recommend', { location: gangnam, prefs: { [k]: v } });
// 말 해석 (AI 전에 거절되는 것만)
await bad4xx('말 빈 값', '/api/interpret', { text: '' });
await bad4xx('말 공백만', '/api/interpret', { text: '    ' });
await bad4xx('말 300자 넘음', '/api/interpret', { text: '가'.repeat(301) });
await bad4xx('말 숫자', '/api/interpret', { text: 123 });
await bad4xx('말 없음', '/api/interpret', {});
// 주문서
await bad4xx('없는 메뉴', '/api/order-sheet', { menuId: 'menu_없음' });
await bad4xx('메뉴 id 숫자', '/api/order-sheet', { menuId: 5 });
const menus = (await (await fetch(base + '/api/options')).json()) as { menus: Array<{ id: string; kind: string; name: string }>; ingredients?: unknown };
const sw = menus.menus.find((m) => m.kind === 'SANDWICH')!;
const salad = menus.menus.find((m) => m.kind === 'SALAD')!;
for (const [name, choices] of [
  ['45cm', { size: '45cm' }], ['소스 4개', { sauces: ['sauce:랜치', 'sauce:마요네즈', 'sauce:스위트 칠리', 'sauce:허니 머스터드'] }], ['없는 빵', { bread: 'bread:없음' }],
  ['야채 목록이 글자', { removeVegetables: 'vegetable:양파' }], ['단품 개수 0', { extras: [{ id: 'single_1', qty: 0 }] }], ['단품 개수 999', { extras: [{ id: 'single_1', qty: 999 }] }],
  ['없는 단품', { extras: [{ id: 'single_없음', qty: 1 }] }], ['없는 세트', { set: '피자 세트' }], ['없는 토핑', { toppings: ['topping:금가루'] }],
] as const) await bad4xx(`주문서 ${name}`, '/api/order-sheet', { menuId: sw.id, choices });
await bad4xx('샐러드에 빵 바꾸기', '/api/order-sheet', { menuId: salad.id, choices: { bread: 'bread:화이트' } });
await bad4xx('주문서 알레르기 이상한 값', '/api/order-sheet', { menuId: sw.id, allergies: ['외계인'] });
// AI 한마디 (10/21)
await bad4xx('설명 메뉴 없음', '/api/menus/explain', { menuIds: [] });
await bad4xx('설명 메뉴 4개', '/api/menus/explain', { menuIds: [sw.id, sw.id, sw.id, sw.id] });
await bad4xx('설명 없는 메뉴', '/api/menus/explain', { menuIds: ['menu_없음'] });
await bad4xx('설명 조건 이상한 값', '/api/menus/explain', { menuIds: [sw.id], prefs: { goal: 'FAST' } });
// 매장 찾기·파일
const q = await fetch(base + '/api/stores?q=' + encodeURIComponent('가'.repeat(500)));
ok('매장 찾기 500자', q.status >= 400 && q.status < 500, String(q.status));
const trav = await fetch(base + '/%2e%2e/%2e%2e/package.json');
ok('폴더 밖 파일 못 읽음', trav.status === 404, String(trav.status));
const env = await fetch(base + '/.env');
ok('.env 못 읽음', env.status === 404, String(env.status));
const put = await fetch(base + '/api/menus/recommend', { method: 'PUT' });
ok('없는 방식(PUT)', put.status >= 400 && put.status < 500, String(put.status));
const big = await post('/api/interpret', JSON.stringify({ text: '가', pad: 'x'.repeat(2_000_000) }), true).catch(() => ({ status: 413, body: {} }));
ok('너무 큰 몸통', big.status >= 400 && big.status < 500, String(big.status));
// 끝나고도 멀쩡한지
const h = await (await fetch(base + '/health')).json() as { status: string; counts?: { serverErrors?: number } };
ok('/health 정상', h.status === 'ok', JSON.stringify(h).slice(0, 80));
console.log(`엇갈린 입력 ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
