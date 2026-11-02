// 써브웨이 코리아 공식 홈페이지(subway.co.kr)에서 메뉴·재료·메뉴별 영양성분을 읽어 data/official/에 저장한다.
// 화면에 보이는 값만 그대로 옮긴다. 가격은 홈페이지에 없어서 매장 메뉴판으로 따로 채운다.
// 실행: npx tsx scripts/fetch-official.ts
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = 'https://www.subway.co.kr';
const OUT = process.env.OFFICIAL_OUT ?? 'data/official';
// 추가 토핑: 샌드위치·샐러드는 .TOPPING, 그레인 샐러드는 .ETC
const isTopping = (category: string) => /\.(TOPPING|ETC)$/.test(category);
const MENU_PAGES = ['sandwich', 'salad', 'grain_salad', 'morning', 'unit', 'sidedrink'] as const;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function get(path: string): Promise<string> {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.text();
}

// HTML 주석 안의 항목(판매 종료된 시즌 메뉴 등)은 빼고 읽는다.
const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');

interface OfficialMenu {
  page: string;
  category: string;
  menuItemIdx: string | null;
  name: string;
  nameEn: string | null;
  summary: string | null;
  nutrition: OfficialNutrition | null;
}
interface OfficialNutrition {
  weightG: number | null;
  energyKcal: number | null;
  proteinG: number | null;
  saturatedFatG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  raw: string[];
}

function parseMenuList(page: string, html: string): OfficialMenu[] {
  const items: OfficialMenu[] = [];
  const re = /<li[^>]*class="ITEM_([A-Z_.]+)"[^>]*>([\s\S]*?)<\/li>/g;
  for (const m of stripComments(html).matchAll(re)) {
    const body = m[2] ?? '';
    const name = body.match(/<strong class="tit">([\s\S]*?)<\/strong>/)?.[1];
    if (!name) continue;
    items.push({
      page,
      category: m[1] ?? '',
      menuItemIdx: body.match(/data-menuitemidx="(\d+)"/)?.[1] ?? null,
      name: decode(name),
      nameEn: decode(body.match(/<span class="eng">([\s\S]*?)<\/span>/)?.[1] ?? '') || null,
      summary: decode(body.match(/<div class="summary">([\s\S]*?)<\/div>/)?.[1] ?? '') || null,
      nutrition: null,
    });
  }
  return items;
}

const num = (cell: string | undefined) => {
  // "26.6(48%)" → 26.6, "머쉬룸(F):235g" → 235
  const digits = (cell ?? '').replace(/\([^)]*\)/g, '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0];
  const n = Number.parseFloat(digits ?? '');
  return Number.isFinite(n) ? n : null;
};

function parseNutrition(html: string): OfficialNutrition | null {
  const table = html.match(/<h3>영양성분표<\/h3>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)?.[1];
  if (!table) return null;
  const cells = [...table.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => decode(c[1] ?? ''));
  if (!cells.length) return null;
  return {
    weightG: num(cells[0]),
    energyKcal: num(cells[1]),
    proteinG: num(cells[2]),
    saturatedFatG: num(cells[3]),
    sugarG: num(cells[4]),
    sodiumMg: num(cells[5]),
    raw: cells,
  };
}

interface OfficialIngredient {
  category: string;
  name: string;
  nameEn: string | null;
  energyKcal: number | null;
}

function parseIngredients(html: string): OfficialIngredient[] {
  const out: OfficialIngredient[] = [];
  const re = /<li class="(bread|cheese|vegetable|sauce)">([\s\S]*?)<\/li>/g;
  for (const m of stripComments(html).matchAll(re)) {
    const body = m[2] ?? '';
    const name = body.match(/<strong class="tit">([\s\S]*?)<\/strong>/)?.[1];
    if (!name) continue;
    const cal = body.match(/<span class="cal">([\s\S]*?)<\/span>/)?.[1];
    out.push({
      category: m[1] ?? '',
      name: decode(name),
      nameEn: decode(body.match(/<span class="eng">([\s\S]*?)<\/span>/)?.[1] ?? '') || null,
      energyKcal: cal ? num(decode(cal)) : null,
    });
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const retrievedAt = new Date().toISOString();

  const menus: OfficialMenu[] = [];
  for (const page of MENU_PAGES) menus.push(...parseMenuList(page, await get(`/menuList/${page}`)));
  for (const menu of menus) {
    if (!menu.menuItemIdx || isTopping(menu.category)) continue;
    // 상세 페이지가 없는 메뉴(사이드 일부)는 영양을 비워 두고 넘어간다.
    const detail = await get(`/menuView/${menu.page}?menuItemIdx=${menu.menuItemIdx}`).catch(() => null);
    menu.nutrition = detail ? parseNutrition(detail) : null;
  }
  const ingredients = parseIngredients(await get('/freshInfo'));

  const source = { site: BASE, retrievedAt };
  writeFileSync(`${OUT}/menus.json`, JSON.stringify({ source, menus }, null, 2) + '\n');
  writeFileSync(`${OUT}/ingredients.json`, JSON.stringify({ source, ingredients }, null, 2) + '\n');
  console.log(`menus ${menus.length} (nutrition ${menus.filter((m) => m.nutrition).length}), ingredients ${ingredients.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
