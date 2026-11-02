// 공식 자료(data/official) + 이름 연결표(data/mapping) + 사람이 채우는 표(data/입력표/가격.csv, 선택규칙.csv)
// → 엔진이 읽는 src/catalog/subway-catalog.json 과 엑셀로 보는 입력표(data/입력표/*.csv)를 만든다.
// 가격.csv는 처음 한 번만 빈 칸으로 만들고, 그 뒤로는 사람이 채운 값을 덮어쓰지 않는다.
// 실행: npx tsx scripts/build-catalog.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

interface OfficialNutrition {
  weightG: number | null;
  energyKcal: number | null;
  proteinG: number | null;
  saturatedFatG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
}
interface OfficialMenu {
  page: string;
  category: string;
  menuItemIdx: string | null;
  name: string;
  nameEn: string | null;
  summary: string | null;
  nutrition: OfficialNutrition | null;
}
interface OfficialIngredient {
  category: string;
  name: string;
  nameEn: string | null;
  energyKcal: number | null;
}
interface AllergenRow {
  section: string;
  name: string;
  contains: string[];
  mayContain: string[];
}
type Mapping = Record<string, string[] | null>;

const menusDoc = readJson<{ source: { retrievedAt: string }; menus: OfficialMenu[] }>('data/official/menus.json');
const ingredientsDoc = readJson<{ ingredients: OfficialIngredient[] }>('data/official/ingredients.json');
const allergenDoc = readJson<{ allergens: string[]; rows: AllergenRow[] }>('data/official/allergens.json');
const pricesDoc = readJson<{
  source: { retrievedAt: string };
  menus: Array<{ category: string; menuIdx: number; name: string; price15cm: number | null; price30cm: number | null; priceOne: number | null }>;
  sets: Array<{ name: string; item: string; addPrice: number }>;
}>('data/official/prices.json');
const mapping = readJson<{ menus: Mapping; ingredients: Mapping; toppings: Mapping }>('data/mapping/allergy-rows.json');

const allergenRows = new Map(allergenDoc.rows.map((r) => [`${r.section}/${r.name}`, r]));

export interface AllergenInfo {
  status: 'KNOWN' | 'UNKNOWN';
  contains: string[];
  mayContain: string[];
  rows: string[];
}

function allergensFor(key: string, table: Mapping): AllergenInfo {
  if (!(key in table)) throw new Error(`알레르기 연결표에 없음: ${key}`);
  const rows = table[key];
  if (rows === null || rows === undefined) return { status: 'UNKNOWN', contains: [], mayContain: [], rows: [] };
  const contains = new Set<string>();
  const may = new Set<string>();
  for (const id of rows) {
    const row = allergenRows.get(id);
    if (!row) throw new Error(`알레르기 표에 없는 줄: ${id} (${key})`);
    row.contains.forEach((a) => contains.add(a));
    row.mayContain.forEach((a) => may.add(a));
  }
  // 여러 줄을 합칠 때 한 줄이라도 "포함"이면 포함으로 본다.
  const order = (list: Iterable<string>) => allergenDoc.allergens.filter((a) => new Set(list).has(a));
  return { status: 'KNOWN', contains: order(contains), mayContain: order([...may].filter((a) => !contains.has(a))), rows };
}

// ── CSV ──
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header: string[], rows: unknown[][]) =>
  '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

const KIND: Record<string, string> = {
  'SANDWICH.NEW': 'SANDWICH',
  'SANDWICH.CLASSIC': 'SANDWICH',
  'SANDWICH.FLASH': 'SANDWICH',
  'SANDWICH.PREMIUM': 'SANDWICH',
  'SALAD.CLASSIC': 'SALAD',
  'SALAD.NEW': 'SALAD',
  'SALAD.TACO': 'SALAD',
  'MORNING.SANDWICH': 'MORNING_SANDWICH',
  'MORNING.WRAP': 'MORNING_WRAP',
  'GRAIN_SALAD.CLASSIC': 'GRAIN_SALAD',
  'GRAIN_SALAD.TACO': 'GRAIN_SALAD',
  'WRAP.SIGNATURE': 'WRAP',
  'WRAP.MINI': 'WRAP',
  'SIDEDRINK.SMILESUB': 'SIDE',
};
const KIND_KO: Record<string, string> = {
  SANDWICH: '샌드위치',
  SALAD: '샐러드',
  MORNING_SANDWICH: '아침 샌드위치',
  MORNING_WRAP: '아침 랩',
  GRAIN_SALAD: '그레인 샐러드',
  WRAP: '랩',
  SIDE: '사이드·음료',
};
const TOPPING_FOR: Record<string, string> = { SANDWICH: 'SANDWICH', SALAD: 'SALAD', GRAIN_SALAD: 'GRAIN_SALAD' };
const APPLIES_KO: Record<string, string> = { SANDWICH: '샌드위치', SALAD: '샐러드', GRAIN_SALAD: '그레인 샐러드' };
// 추가 토핑: 샌드위치·샐러드는 .TOPPING, 그레인 샐러드는 .ETC
const isTopping = (category: string) => /.(TOPPING|ETC)$/.test(category);
const ING_KO: Record<string, string> = { bread: '빵', vegetable: '야채', cheese: '치즈', sauce: '소스' };

mkdirSync('data/입력표', { recursive: true });
mkdirSync('src/catalog', { recursive: true });

// ── 가격 (사람이 채움) ──
const PRICE_CSV = 'data/입력표/가격.csv';
// 공식 주문 시스템 단품 이름 → 공식 홈페이지 사이드 이름 (영양·알레르기를 이어 붙이려고). 오늘의 수프는 날마다 달라 안 붙임
const SINGLE_TO_SITE: Record<string, string> = {
  '초코칩 쿠키': '초코칩', '더블 초코칩 쿠키': '더블 초코칩', '오트밀 레이즌 쿠키': '오트밀 레이즌', '라즈베리 치즈케익 쿠키': '라즈베리 치즈케익',
  '화이트 초코 마카다미아 쿠키': '화이트 초코 마카다미아', '칩 (랜덤발송)': '칩', '탄산음료 16oz': '탄산음료', 아메리카노: '커피',
};
// 판매가 끝난 것 (사람이 적음, 10/19): 공식 홈페이지 목록에서 빠진 메뉴·토핑은 메뉴판에서 뺀다. 다시 나오면 이 표에서 지운다
const ENDED_CSV = 'data/입력표/판매끝.csv';
const endedRows = existsSync(ENDED_CSV)
  ? readFileSync(ENDED_CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1).map((l) => l.split(',').map((x) => x.trim())).filter((r) => r[0])
  : [];
const ended = new Set(endedRows.map((r) => r[0]!));
const onSale = (m: OfficialMenu) => !(m.menuItemIdx && ended.has(m.menuItemIdx));
const toppingItems = menusDoc.menus.filter((m) => isTopping(m.category) && onSale(m));
// 사이드 목록에도 같은 메뉴(치킨 베이컨 미니 랩)가 다시 나온다 → 앞에 나온 것 하나만 쓴다.
const seenNames = new Set<string>();
const menuItems = menusDoc.menus.filter((m) => {
  if (isTopping(m.category) || seenNames.has(m.name) || !onSale(m)) return false;
  seenNames.add(m.name);
  return true;
});
const priceKey = (m: OfficialMenu) => `${m.category}/${m.name}`;
if (!existsSync(PRICE_CSV)) {
  writeFileSync(
    PRICE_CSV,
    toCsv(
      ['구분', '이름', '15cm 가격(원)', '30cm 가격(원)', '확인한 곳', '확인한 날'],
      [...menuItems, ...toppingItems].map((m) => [m.category, m.name, '', '', '', '']),
    ),
  );
}
// 새 메뉴가 생기면 가격.csv 끝에 빈 줄로 더한다 (채워진 줄은 그대로).
{
  const text = readFileSync(PRICE_CSV, 'utf8');
  const have = new Set(parseCsv(text).slice(1).map(([c, n]) => `${c}/${n}`));
  const missing = [...menuItems, ...toppingItems].filter((m) => !have.has(priceKey(m)));
  if (missing.length)
    writeFileSync(PRICE_CSV, text.replace(/\r?\n?$/, '\r\n') + missing.map((m) => [m.category, m.name, '', '', '', ''].map(cell).join(',')).join('\r\n') + '\r\n');
}
const prices = new Map<string, { p15: number | null; p30: number | null; source: string; date: string }>();
for (const [cat, name, p15, p30, source, date] of parseCsv(readFileSync(PRICE_CSV, 'utf8')).slice(1)) {
  const n = (s: string | undefined) => (s && s.trim() ? Number(s.replace(/[^\d]/g, '')) : null);
  prices.set(`${cat}/${name}`, { p15: n(p15), p30: n(p30), source: source ?? '', date: date ?? '' });
}
const priceOf = (m: OfficialMenu) => {
  const p = prices.get(priceKey(m));
  const known = p && p.p15 !== null;
  return {
    status: known ? 'KNOWN' : 'NEEDS_CHECK',
    price15cm: p?.p15 ?? null,
    price30cm: p?.p30 ?? null,
    checkedAt: p?.date || null,
    checkedWhere: p?.source || null,
  };
};

// ── 선택 규칙 (사람이 채움, 공식 안내 근거) ──
const RULES_CSV = 'data/입력표/선택규칙.csv';
const rules = parseCsv(readFileSync(RULES_CSV, 'utf8'))
  .slice(1)
  .map(([group, appliesTo, min, max, note, status, source]) => ({
    group: group ?? '',
    appliesTo: appliesTo ?? '',
    min: min === '' || min === undefined ? null : Number(min),
    max: max === '' || max === undefined ? null : Number(max),
    note: note ?? '',
    status: status === '확인됨' ? 'CONFIRMED' : 'NEEDS_CHECK',
    source: source ?? '',
  }));

// ── 카탈로그 ──
const menus = menuItems.map((m) => {
  const kind = KIND[m.category];
  if (!kind) throw new Error(`모르는 메뉴 구분: ${m.category}`);
  return {
    id: `menu_${m.menuItemIdx}`,
    officialIdx: m.menuItemIdx,
    name: m.name,
    nameEn: m.nameEn,
    kind,
    label: m.category.split('.')[1] ?? null,
    summary: m.summary,
    nutrition15cm: m.nutrition
      ? { ...m.nutrition, basis: kind === 'SANDWICH' || kind === 'MORNING_SANDWICH' ? '15cm, 위트빵·기본 야채 기준' : kind === 'WRAP' || kind === 'MORNING_WRAP' ? '랩 1개' : '1회 제공량' }
      : null,
    allergens: allergensFor(m.name, mapping.menus),
    price: priceOf(m),
    // 아침 샌드위치는 기본 야채가 다름 (공식 안내, 10/19): "본 메뉴에는 야채가 포함되지 않습니다" / "토마토, 피망, 양파 이외의 야채가 포함되지 않습니다"
    ...(kind === 'MORNING_SANDWICH'
      ? { defaultVegetables: /야채가 포함되지 않습니다/.test(m.summary ?? '') && !/이외의 야채/.test(m.summary ?? '') ? [] : /토마토, 피망, 양파 이외/.test(m.summary ?? '') ? ['vegetable:토마토', 'vegetable:피망(파프리카)', 'vegetable:양파'] : null }
      : {}),
  };
});
const toppings = toppingItems.map((m) => ({
  id: `topping_${m.menuItemIdx}`,
  officialIdx: m.menuItemIdx,
  name: m.name,
  appliesTo: TOPPING_FOR[m.category.split('.')[0] ?? ''] ?? 'SANDWICH',
  allergens: allergensFor(`${m.category}/${m.name}`, mapping.toppings),
  price: priceOf(m),
}));
const ingredients = ingredientsDoc.ingredients.map((i) => ({
  id: `${i.category}:${i.name}`,
  category: i.category.toUpperCase(),
  name: i.name,
  nameEn: i.nameEn,
  // 공식 홈페이지는 재료별로 열량만 공개한다. 나머지 영양 항목은 공식 미공개.
  energyKcal: i.energyKcal,
  allergens: allergensFor(i.name, mapping.ingredients),
}));
const mains = allergenDoc.rows
  .filter((r) => r.section === '미트류')
  .map((r) => ({
    id: `main:${r.name}`,
    name: r.name,
    allergens: { status: 'KNOWN', contains: r.contains, mayContain: r.mayContain, rows: [`미트류/${r.name}`] },
  }));

const catalog = {
  source: {
    site: 'https://www.subway.co.kr',
    retrievedAt: menusDoc.source.retrievedAt,
    notes: [
      '메뉴별 영양: 공식 메뉴 상세의 영양성분표 (중량·열량·단백질·포화지방·당류·나트륨)',
      '재료별 영양: 공식 신선한 재료 소개의 열량만',
      '알레르기: 공식 알레르기 유발성분 표(이미지) — ● 포함 / ★ 포함 가능성',
      '가격: 공식 주문 API의 매장 선택 전 기본가 (data/입력표/가격.csv). 매장마다 다를 수 있음. 추가 토핑 가격은 배달의민족 앱 캡처 (배달·픽업 같음, 2026-10-08)',
    ],
  },
  allergenList: allergenDoc.allergens,
  menus,
  toppings,
  ingredients,
  mains,
  optionRules: rules,
  sets: pricesDoc.sets.map((x) => ({ name: x.name, item: x.item, addPrice: x.addPrice, checkedAt: pricesDoc.source.retrievedAt.slice(0, 10) })),
  // 단품 (10/19): 공식 주문 시스템 "사이드.음료"의 음료·쿠키·칩·웨지·수프 — 샌드위치 없이도, 샌드위치에 더해서도 주문서에 담는다.
  // 영양·알레르기는 공식 홈페이지의 같은 사이드 메뉴에서 (없으면 null = "확인 필요"). 웨지는 오전 11시부터 (공식 홈페이지)
  singles: pricesDoc.menus
    .filter((p) => p.category === '사이드.음료' && p.priceOne !== null)
    .map((p) => {
      const group = /쿠키/.test(p.name) ? 'COOKIE' : /^칩/.test(p.name) ? 'CHIP' : /웨지/.test(p.name) ? 'WEDGE' : /수프/.test(p.name) ? 'SOUP' : 'DRINK';
      const site = menus.find((m) => m.kind === 'SIDE' && m.name === (SINGLE_TO_SITE[p.name] ?? p.name));
      return {
        id: `single_${p.menuIdx}`,
        name: p.name,
        group,
        price: p.priceOne!,
        checkedAt: pricesDoc.source.retrievedAt.slice(0, 10),
        nutrition: site?.nutrition15cm ?? null,
        allergens: site ? site.allergens : { status: 'NEEDS_CHECK', contains: [], mayContain: [], rows: [] },
        ...(group === 'WEDGE' ? { fromMinute: 660 } : {}),
      };
    }),
  // 판매 끝 (같은 이름이 여러 줄이면 하나만 — 말로 찾을 때 쓰는 목록)
  ended: [...new Map(endedRows.map((r) => [r[1]!, { officialIdx: r[0]!, name: r[1]!, kind: r[2] ?? '', checkedAt: r[4] ?? '' }])).values()],
};
writeFileSync('src/catalog/subway-catalog.json', JSON.stringify(catalog, null, 2) + '\n');

// ── 엑셀로 보는 입력표 (만들어지는 파일, 직접 고치지 않음) ──
const join = (a: string[]) => a.join(' ');
writeFileSync(
  'data/입력표/메뉴.csv',
  toCsv(
    ['ID', '종류', '구분', '이름', '중량(g)', '열량(kcal)', '단백질(g)', '포화지방(g)', '당류(g)', '나트륨(mg)', '알레르기 포함', '알레르기 포함 가능', '알레르기 상태', '15cm 가격', '30cm 가격', '가격 상태'],
    menus.map((m) => [
      m.id, KIND_KO[m.kind], m.label, m.name,
      m.nutrition15cm?.weightG, m.nutrition15cm?.energyKcal, m.nutrition15cm?.proteinG, m.nutrition15cm?.saturatedFatG, m.nutrition15cm?.sugarG, m.nutrition15cm?.sodiumMg,
      join(m.allergens.contains), join(m.allergens.mayContain), m.allergens.status === 'KNOWN' ? '확인됨' : '확인 필요',
      m.price.price15cm, m.price.price30cm, m.price.status === 'KNOWN' ? '확인됨' : '메뉴판 확인 필요',
    ]),
  ),
);
writeFileSync(
  'data/입력표/재료.csv',
  toCsv(
    ['ID', '종류', '이름', '영문', '열량(kcal)', '알레르기 포함', '알레르기 포함 가능', '알레르기 상태'],
    [
      ...ingredients.map((i) => [i.id, ING_KO[i.category.toLowerCase()], i.name, i.nameEn, i.energyKcal, join(i.allergens.contains), join(i.allergens.mayContain), i.allergens.status === 'KNOWN' ? '확인됨' : '확인 필요']),
      ...mains.map((m) => [m.id, '메인(미트류)', m.name, '', '', join(m.allergens.contains), join(m.allergens.mayContain), '확인됨']),
    ],
  ),
);
writeFileSync(
  'data/입력표/추가토핑.csv',
  toCsv(
    ['ID', '적용', '이름', '알레르기 포함', '알레르기 포함 가능', '알레르기 상태', '가격', '가격 상태'],
    toppings.map((t) => [t.id, APPLIES_KO[t.appliesTo], t.name, join(t.allergens.contains), join(t.allergens.mayContain), t.allergens.status === 'KNOWN' ? '확인됨' : '확인 필요 (고른 메인·치즈에 따라 다름)', t.price.price15cm, t.price.status === 'KNOWN' ? '확인됨' : '메뉴판 확인 필요']),
  ),
);
writeFileSync(
  'data/입력표/알레르기표.csv',
  toCsv(
    ['구역', '이름', ...allergenDoc.allergens],
    allergenDoc.rows.map((r) => [r.section, r.name, ...allergenDoc.allergens.map((a) => (r.contains.includes(a) ? '●' : r.mayContain.includes(a) ? '★' : ''))]),
  ),
);

console.log(
  `menus ${menus.length}, toppings ${toppings.length}, ingredients ${ingredients.length}, mains ${mains.length}, rules ${rules.length}`,
);
