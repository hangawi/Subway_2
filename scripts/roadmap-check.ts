// 로드맵 1~7단계 데이터 점검 (10/19, 7.6-1): ✅ 표시를 믿지 않고 공식 자료와 다시 대조한다.
// 실행: npx tsx scripts/roadmap-check.ts [--live]   (--live: 공식 홈페이지 메뉴 목록을 지금 다시 읽어 새 메뉴가 있는지)
import { readFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { buildOrderSheet } from '../src/order-sheet/order-sheet.ts';
import { isSideLike } from '../src/subway-menu/menu-domain.ts';

const catalog = loadSubwayCatalog();
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const official = json('data/official/menus.json');
const offIng = json('data/official/ingredients.json');
const prices = json('data/official/prices.json');
const rows: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => rows.push([n, ok, d]);

// 9. 재료: 공식 목록에 있는 재료가 다 들어왔는지
const ingNames = new Set(catalog.ingredients.map((i) => i.name));
const missingIng = offIng.ingredients.map((i: { name: string }) => i.name).filter((n: string) => !ingNames.has(n));
check('9 공식 재료가 전부 들어옴', missingIng.length === 0, `공식 ${offIng.ingredients.length}, 빠짐 ${missingIng.join(',') || '0'}`);

// 10. 시험용 값이 운영 데이터에 없음
const raw = readFileSync('src/catalog/subway-catalog.json', 'utf8');
check('10 TEST_FIXTURE_ONLY 0개', !raw.includes('TEST_FIXTURE_ONLY'));

// 12. 공식 메뉴 수·가격
const offMenus = official.menus.filter((m: { category: string }) => !/\.(TOPPING|ETC)$/.test(m.category));
const catIdx = new Set(catalog.menus.map((m) => m.officialIdx));
// 같은 메뉴가 두 분류에 올라온 것(예: 치킨 베이컨 미니 랩 = 랩·스마일 썹)은 이름으로도 맞춤
const catNames = new Set(catalog.menus.map((m) => m.name));
// 판매 끝(data/입력표/판매끝.csv)으로 뺀 것은 빠진 게 아님
const endedNames = new Set((catalog.ended ?? []).map((e) => e.name));
const notIn = offMenus.filter((m: { menuItemIdx: string | null; name: string }) => !catIdx.has(m.menuItemIdx) && !catNames.has(m.name) && !endedNames.has(m.name)).map((m: { name: string; category: string }) => `${m.name}(${m.category})`);
check('12 공식 메뉴(10/08 받은 것)가 메뉴판에 다 있음 (판매 끝 뺌)', notIn.length === 0, `공식 ${offMenus.length}, 메뉴판 ${catalog.menus.length}, 없는 것: ${notIn.join(', ') || '없음'}`);
const priceOf = new Map<string, number | null>();
for (const p of prices.menus ?? []) priceOf.set(p.name, p.price15cm ?? p.price ?? null);
const diff = catalog.menus.filter((m) => m.price.status === 'KNOWN' && priceOf.has(m.name) && priceOf.get(m.name) != null && priceOf.get(m.name) !== m.price.price15cm).map((m) => `${m.name} ${m.price.price15cm}≠${priceOf.get(m.name)}`);
check('12 가격이 공식 주문 시스템 값과 같음', diff.length === 0, diff.slice(0, 5).join(', ') || `비교 ${catalog.menus.filter((m) => priceOf.has(m.name)).length}개 같음`);

// 3·15. 기본 메뉴 주문서 영양 = 공식값 (오차 ±10% 안)
const meals = catalog.menus.filter((m) => !isSideLike(m) && m.nutrition15cm);
const bad3: string[] = [];
const bad15: string[] = [];
for (const m of meals) {
  const r = buildOrderSheet(m, {}, catalog);
  if (!r.ok) {
    bad3.push(`${m.name}(주문서 안 만들어짐)`);
    continue;
  }
  const got = r.sheet.nutrition.energyKcal;
  const want = m.nutrition15cm!.energyKcal;
  if (got !== want) bad3.push(`${m.name} ${got}≠${want}`);
  if (got == null || want == null || Math.abs(got - want) > want * 0.1) bad15.push(m.name);
}
check('3 기본 메뉴 주문서 열량 = 공식값', bad3.length === 0, bad3.slice(0, 5).join(', ') || `${meals.length}개 같음`);
check('15 오차 ±10% 안', bad15.length === 0, bad15.join(', ') || `${meals.length}개`);

// 공식 홈페이지 지금 목록 (새 메뉴)
if (process.argv.includes('--live')) {
  const now: string[] = [];
  for (const page of ['sandwich', 'salad', 'grain_salad', 'morning', 'unit', 'sidedrink']) {
    const html = (await (await fetch(`https://www.subway.co.kr/menuList/${page}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()).replace(/<!--[\s\S]*?-->/g, '');
    for (const m of html.matchAll(/<li[^>]*class="ITEM_([A-Z_.]+)"[^>]*>([\s\S]*?)<\/li>/g)) {
      if (/\.(TOPPING|ETC)$/.test(m[1] ?? '')) continue;
      const idx = m[2]?.match(/data-menuitemidx="(\d+)"/)?.[1];
      const name = m[2]?.match(/<strong class="tit">([\s\S]*?)<\/strong>/)?.[1]?.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
      if (idx && name && !catIdx.has(idx) && !catNames.has(name)) now.push(name);
    }
  }
  check('12 지금 공식 홈페이지에 있는데 메뉴판에 없는 메뉴', now.length === 0, [...new Set(now)].join(', ') || '없음');
}

for (const [n, ok, d] of rows) console.log(`${ok ? '✅' : '❌'} ${n}${d ? `  — ${d}` : ''}`);
console.log(`통과 ${rows.filter((r) => r[1]).length} / ${rows.length}`);
