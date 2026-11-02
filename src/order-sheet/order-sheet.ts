// 주문서: 메뉴 + 크기 + 빵 + 치즈 + 야채(뺀 것·더한 것) + 소스 + 추가 토핑 + 세트 + 토스팅.
// 선택 규칙(공식·배민 확인, `선택규칙.csv`)에 안 맞으면 주문서를 만들지 않고 이유를 돌려준다.
// 금액: 메뉴(15/30cm) + 추가 토핑 + 세트. 가격을 모르는 것은 합계에 넣지 않고 "확인 필요"로 옆에 적는다.
// 영양: 기본은 공식 메뉴값(15cm, 위트빵·기본 야채). 바꾸면 재료 공식 열량 차이만 반영하고 "추정".
//       30cm = 15cm × 2 "추정". 추가 토핑은 공식 열량이 없어 열량에 넣지 않고 그렇게 적는다.
import type { CatalogMenu, SubwayCatalog } from '../catalog/subway-catalog.ts';
import { composeAllergens, DEFAULT_BREAD, vegetablesOf, SALAD_LIKE, SANDWICH_LIKE, WRAP_LIKE, type ComposedAllergens } from './composition.ts';

export const MAX_SAUCES = 3;

/** 세트마다 고를 수 있는 것 (공식 홈페이지 사이드 메뉴, 10/16 확인). 웨지는 기본 웨지 포테이토가 세트 값이고 치즈·베이컨은 가격 매장 확인.
 *  세트 음료는 매장 기계 음료 16oz (공식 주문 시스템 "음료(16oz)") — 고른 종류가 있는지는 매장 확인. 캔 음료·생수·커피는 단품(extras)으로. 웨지 포테이토는 오전 11시부터 판매 */
export const SET_ITEMS: Record<string, { names: string[]; extraCheck: string[] }> = {
  '쿠키 음료 세트': { names: ['초코칩', '더블 초코칩', '오트밀 레이즌', '라즈베리 치즈케익', '화이트 초코 마카다미아'], extraCheck: [] },
  '웨지 음료 세트': { names: ['웨지 포테이토', 'Cheesy 웨지 포테이토', 'Bacon Cheesy 웨지 포테이토'], extraCheck: ['Cheesy 웨지 포테이토', 'Bacon Cheesy 웨지 포테이토'] },
  '칩 음료 세트': { names: ['칩'], extraCheck: [] },
  // 10/21: 공식 주문 시스템은 "오늘의 수프(하프)+음료(16oz)" — 그날 매장 수프라 종류를 고르지 않음 (포테이토 베이컨·콘·머쉬룸은 그날 나올 수 있는 수프)
  '수프 음료 세트': { names: ['오늘의 수프'], extraCheck: [] },
};
export const MAX_TOPPINGS = { sandwich: 8, salad: 11 } as const;

export interface OrderChoices {
  size?: '15cm' | '30cm';
  bread?: string;
  cheese?: string | null;
  removeVegetables?: string[];
  addVegetables?: string[];
  sauces?: string[];
  toppings?: string[];
  set?: string | null;
  toasted?: boolean;
  /** 세트 음료 (10/16). 공식 자료에 세트 음료 종류가 없어 "매장에서 확인"으로 적는다 */
  drink?: string;
  /** 세트에서 고른 것 (사이드 메뉴 이름: "초코칩", "콘 수프") — 10/16 */
  setItem?: string;
  /** 단품 더하기 (10/19): 음료·쿠키·칩·웨지·수프 — catalog.singles 의 id 와 개수 */
  extras?: Array<{ id: string; qty: number }>;
}

/** 샌드위치 없이 단품만 주문할 때의 메뉴 id (10/19: "콜라만 줘") */
export const SINGLES_ID = 'singles';
export const MAX_EXTRA_LINES = 10;
export const MAX_EXTRA_QTY = 20;

export interface OrderSheet {
  menu: { id: string; name: string; kind: CatalogMenu['kind'] };
  size: '15cm' | '30cm';
  bread: string | null;
  cheese: string | null;
  vegetables: { kept: string[]; removed: string[]; added: string[] };
  sauces: string[];
  toppings: string[];
  set: string | null;
  /** 세트일 때만 */
  drink: string | null;
  /** 세트에서 고른 것 (세트일 때만) */
  setItem: string | null;
  toasted: boolean | null;
  price: { total: number; lines: Array<{ item: string; won: number | null }>; needsCheck: string[] };
  nutrition: {
    energyKcal: number | null;
    proteinG: number | null;
    sodiumMg: number | null;
    sugarG: number | null;
    saturatedFatG: number | null;
    status: 'OFFICIAL' | 'ESTIMATE' | 'UNKNOWN';
    notes: string[];
  };
  allergens: ComposedAllergens;
  /** 단품 (10/19) */
  extras: Array<{ id: string; name: string; qty: number; won: number }>;
}

export type OrderResult = { ok: true; sheet: OrderSheet } | { ok: false; errors: string[] };

const nameOf = (catalog: SubwayCatalog, id: string) =>
  catalog.ingredients.find((i) => i.id === id)?.name ?? catalog.toppings.find((t) => t.id === id)?.name ?? id;

/** 단품 검사·금액·영양·알레르기 (샌드위치 주문서와 단품만 주문서가 같이 씀) */
function extrasOf(choices: OrderChoices, catalog: SubwayCatalog) {
  const errors: string[] = [];
  const list = choices.extras ?? [];
  if (list.length > MAX_EXTRA_LINES) errors.push('TOO_MANY_EXTRAS');
  const lines: OrderSheet['extras'] = [];
  for (const e of list) {
    const s = catalog.singles?.find((x) => x.id === e.id);
    if (!s) {
      errors.push('UNKNOWN_EXTRA');
      continue;
    }
    if (!Number.isInteger(e.qty) || e.qty < 1 || e.qty > MAX_EXTRA_QTY) {
      errors.push('BAD_EXTRA_QTY');
      continue;
    }
    if (lines.some((l) => l.id === s.id)) {
      errors.push('DUPLICATE_EXTRA');
      continue;
    }
    lines.push({ id: s.id, name: s.name, qty: e.qty, won: s.price * e.qty });
  }
  const singles = lines.map((l) => ({ l, s: catalog.singles!.find((x) => x.id === l.id)! }));
  const sum = (k: 'energyKcal' | 'proteinG' | 'sodiumMg' | 'sugarG' | 'saturatedFatG') => singles.reduce((acc, { l, s }) => acc + (s.nutrition?.[k] ?? 0) * l.qty, 0);
  const noNutrition = singles.filter(({ s }) => !s.nutrition).map(({ s }) => s.name);
  const allergens = {
    contains: [...new Set(singles.flatMap(({ s }) => s.allergens.contains))],
    mayContain: [...new Set(singles.flatMap(({ s }) => s.allergens.mayContain))],
    unknownParts: singles.filter(({ s }) => s.allergens.status !== 'KNOWN').map(({ s }) => s.name),
  };
  return { errors, lines, sum, noNutrition, allergens };
}

/** 샌드위치 없이 단품만 (10/19: "콜라만 줘", "쿠키 두 개") */
export function buildSinglesSheet(choices: OrderChoices, catalog: SubwayCatalog): OrderResult {
  const x = extrasOf(choices, catalog);
  if (!x.lines.length && !x.errors.length) x.errors.push('NO_EXTRAS');
  if (x.errors.length) return { ok: false, errors: [...new Set(x.errors)] };
  const r = (v: number) => Math.round(v * 10) / 10;
  const known = x.noNutrition.length < x.lines.length;
  return {
    ok: true,
    sheet: {
      menu: { id: SINGLES_ID, name: '단품', kind: 'SIDE' },
      size: '15cm',
      bread: null, cheese: null, vegetables: { kept: [], removed: [], added: [] }, sauces: [], toppings: [], set: null, drink: null, setItem: null, toasted: null,
      price: { total: x.lines.reduce((a, l) => a + l.won, 0), lines: x.lines.map((l) => ({ item: `${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''}`, won: l.won })), needsCheck: [] },
      nutrition: {
        energyKcal: known ? r(x.sum('energyKcal')) : null, proteinG: known ? r(x.sum('proteinG')) : null, sodiumMg: known ? r(x.sum('sodiumMg')) : null,
        sugarG: known ? r(x.sum('sugarG')) : null, saturatedFatG: known ? r(x.sum('saturatedFatG')) : null,
        status: !known ? 'UNKNOWN' : x.noNutrition.length ? 'ESTIMATE' : 'OFFICIAL',
        notes: x.noNutrition.length ? [`${x.noNutrition.join('·')}은(는) 공식 영양 정보가 없어 더하지 않았어요`] : [],
      },
      allergens: { contains: x.allergens.contains, mayContain: x.allergens.mayContain.filter((a) => !x.allergens.contains.includes(a)), unknownParts: x.allergens.unknownParts, mainsFound: true },
      extras: x.lines,
    },
  };
}

export function buildOrderSheet(menu: CatalogMenu, choices: OrderChoices, catalog: SubwayCatalog): OrderResult {
  const errors: string[] = [];
  const sandwich = SANDWICH_LIKE.includes(menu.kind);
  const wrap = WRAP_LIKE.includes(menu.kind);
  const salad = SALAD_LIKE.includes(menu.kind);
  const ing = (id: string) => catalog.ingredients.find((i) => i.id === id);
  const size = choices.size ?? '15cm';
  // 크기는 둘뿐 (10/15 점검: "45cm"를 보내면 그대로 주문서에 찍히고 15cm 가격이 나가던 것)
  if (size !== '15cm' && size !== '30cm') errors.push('UNKNOWN_SIZE');
  if (size === '30cm' && (!sandwich || menu.price.price30cm === null)) errors.push('SIZE_NOT_AVAILABLE');
  if (menu.kind === 'SIDE') errors.push('NOT_A_MEAL');

  // 빵·치즈·야채는 샌드위치만 (샐러드는 소스·토핑만, 랩은 빵이 정해짐)
  const changesFixedPart = choices.bread !== undefined || choices.cheese != null || choices.removeVegetables?.length || choices.addVegetables?.length;
  if ((salad || wrap) && changesFixedPart) errors.push(salad ? 'SALAD_ONLY_SAUCE_AND_TOPPING' : 'WRAP_BREAD_FIXED');
  const bread = sandwich ? (choices.bread ?? DEFAULT_BREAD) : null;
  if (bread && ing(bread)?.category !== 'BREAD') errors.push('UNKNOWN_BREAD');
  const cheese = sandwich ? (choices.cheese ?? null) : null;
  if (cheese && ing(cheese)?.category !== 'CHEESE') errors.push('UNKNOWN_CHEESE');
  const removed = sandwich ? (choices.removeVegetables ?? []) : [];
  const added = sandwich ? (choices.addVegetables ?? []) : [];
  for (const v of [...removed, ...added]) if (ing(v)?.category !== 'VEGETABLE') errors.push('UNKNOWN_VEGETABLE');
  if (removed.some((v) => !vegetablesOf(menu).includes(v))) errors.push('NOT_A_DEFAULT_VEGETABLE');
  // 아침 샌드위치처럼 기본 야채가 적은 메뉴는 그 야채만 더할 수 있음 (10/19)
  if (menu.defaultVegetables && added.some((v) => !menu.defaultVegetables!.includes(v))) errors.push('NOT_A_DEFAULT_VEGETABLE');

  const sauces = choices.sauces ?? [];
  if (sauces.length > MAX_SAUCES) errors.push('TOO_MANY_SAUCES');
  if (new Set(sauces).size !== sauces.length) errors.push('DUPLICATE_SAUCE');
  if (new Set([...removed, ...added]).size !== removed.length + added.length) errors.push('DUPLICATE_VEGETABLE');
  for (const s of sauces) if (ing(s)?.category !== 'SAUCE') errors.push('UNKNOWN_SAUCE');
  if (menu.kind === 'MORNING_WRAP' || menu.kind === 'WRAP') if (sauces.length) errors.push('WRAP_SAUCE_FIXED');

  const toppingKind = salad ? menu.kind : 'SANDWICH';
  const toppings = choices.toppings ?? [];
  const tops = toppings.map((t) => catalog.toppings.find((x) => x.id === t));
  if (tops.some((t) => !t || t.appliesTo !== toppingKind)) errors.push('TOPPING_NOT_FOR_THIS_MENU');
  if (toppings.length > (salad ? MAX_TOPPINGS.salad : MAX_TOPPINGS.sandwich)) errors.push('TOO_MANY_TOPPINGS');
  if (wrap && toppings.length) errors.push('WRAP_TOPPING_FIXED');

  const set = choices.set ?? null;
  const setInfo = set ? catalog.sets.find((s) => s.name === set) : null;
  if (set && (!setInfo || !(sandwich || salad))) errors.push('SET_NOT_AVAILABLE');
  const setItem = set && choices.setItem ? choices.setItem : null;
  if (setItem && !SET_ITEMS[set!]?.names.includes(setItem)) errors.push('SET_ITEM_NOT_IN_SET');
  if (choices.toasted !== undefined && !sandwich) errors.push('TOASTING_ONLY_SANDWICH');
  const extra = extrasOf(choices, catalog);
  errors.push(...extra.errors);

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };

  // 금액
  const lines: Array<{ item: string; won: number | null }> = [];
  const needsCheck: string[] = [];
  const base = size === '30cm' ? menu.price.price30cm : menu.price.price15cm;
  lines.push({ item: `${menu.name} ${size}`, won: base });
  if (base === null || menu.price.status !== 'KNOWN') needsCheck.push(menu.name);
  for (const t of tops) {
    const won = t!.price.status !== 'KNOWN' ? null : size === '30cm' ? (t!.price.price30cm ?? (t!.price.price15cm !== null ? t!.price.price15cm * 2 : null)) : t!.price.price15cm;
    lines.push({ item: `추가 토핑: ${t!.name}`, won });
    if (won === null) needsCheck.push(t!.name);
  }
  if (setInfo) lines.push({ item: setItem ? `${setInfo.name} (${setItem})` : setInfo.name, won: setInfo.addPrice });
  if (setItem && SET_ITEMS[set!]!.extraCheck.includes(setItem)) needsCheck.push(`${setItem} 세트`);
  for (const l of extra.lines) lines.push({ item: `${l.name}${l.qty > 1 ? ` × ${l.qty}` : ''}`, won: l.won });
  const total = lines.reduce((s, l) => s + (l.won ?? 0), 0);

  // 영양
  const n = menu.nutrition15cm;
  const notes: string[] = [];
  let kcal = n?.energyKcal ?? null;
  let estimate = false;
  const delta = (id: string, sign: 1 | -1) => {
    const k = ing(id)?.energyKcal;
    if (k == null) notes.push(`${nameOf(catalog, id)} 열량 정보 없음`);
    else if (kcal !== null) kcal += sign * k;
    estimate = true;
  };
  if (bread && bread !== DEFAULT_BREAD) {
    delta(bread, 1);
    delta(DEFAULT_BREAD, -1);
  }
  if (cheese) delta(cheese, 1);
  for (const v of removed) delta(v, -1);
  for (const v of added) delta(v, 1);
  for (const s of sauces) delta(s, 1);
  if (toppings.length) {
    notes.push('추가 토핑은 공식 열량이 없어 열량에 넣지 않았어요');
    estimate = true;
  }
  const mult = size === '30cm' ? 2 : 1;
  if (mult === 2) {
    notes.push('30cm는 15cm × 2로 계산했어요');
    estimate = true;
  }
  const side = setItem ? catalog.menus.find((m) => m.kind === 'SIDE' && m.name === setItem)?.nutrition15cm ?? null : null;
  if (set) {
    if (!setItem) notes.push('세트에서 쿠키·웨지·수프 종류를 고르면 그 열량도 더해요');
    else if (side) {
      notes.push(`세트 ${setItem} 공식 영양을 더했어요 (음료는 영양 정보 없음)`);
      estimate = true;
    } else notes.push(setItem === '오늘의 수프' ? '오늘의 수프는 날마다 달라 열량에 넣지 않았어요' : `${setItem}는 공식 영양 정보가 없어 더하지 않았어요`);
  }
  if (extra.lines.length) {
    notes.push(extra.noNutrition.length ? `단품 영양을 더했어요 (${extra.noNutrition.join('·')}은 공식 영양 정보 없음)` : '단품 공식 영양을 더했어요');
    if (extra.lines.length > extra.noNutrition.length) estimate = true;
  }
  const plus = (v: number | null | undefined, add: number | null | undefined, k?: 'energyKcal' | 'proteinG' | 'sodiumMg' | 'sugarG' | 'saturatedFatG') =>
    v == null ? null : Math.round((v * mult + (add ?? 0) + (k ? extra.sum(k) : 0)) * 10) / 10;
  const nutrition: OrderSheet['nutrition'] = {
    energyKcal: kcal === null ? null : plus(kcal, side?.energyKcal, 'energyKcal'),
    proteinG: plus(n?.proteinG, side?.proteinG, 'proteinG'),
    sodiumMg: plus(n?.sodiumMg, side?.sodiumMg, 'sodiumMg'),
    sugarG: plus(n?.sugarG, side?.sugarG, 'sugarG'),
    saturatedFatG: plus(n?.saturatedFatG, side?.saturatedFatG, 'saturatedFatG'),
    status: !n ? 'UNKNOWN' : estimate ? 'ESTIMATE' : 'OFFICIAL',
    notes: estimate && (bread !== DEFAULT_BREAD || cheese || removed.length || added.length || sauces.length) ? ['바꾼 재료의 공식 열량 차이만 반영했어요 (다른 영양은 공식 메뉴값)', ...notes] : notes,
  };

  const composed = composeAllergens(menu, catalog, { ...(bread ? { bread } : {}), cheese, removeVegetables: removed, addVegetables: added, sauces, toppings });
  // 단품 알레르기도 합침 (10/19)
  const allContains = [...new Set([...composed.contains, ...extra.allergens.contains])];
  const allergens: ComposedAllergens = {
    ...composed,
    contains: allContains,
    mayContain: [...new Set([...composed.mayContain, ...extra.allergens.mayContain])].filter((a) => !allContains.includes(a)),
    unknownParts: [...composed.unknownParts, ...extra.allergens.unknownParts],
  };
  return {
    ok: true,
    sheet: {
      menu: { id: menu.id, name: menu.name, kind: menu.kind },
      size,
      bread: bread ? nameOf(catalog, bread) : null,
      cheese: cheese ? nameOf(catalog, cheese) : null,
      vegetables: sandwich
        ? { kept: vegetablesOf(menu).filter((v) => !removed.includes(v)).map((v) => nameOf(catalog, v)), removed: removed.map((v) => nameOf(catalog, v)), added: added.map((v) => nameOf(catalog, v)) }
        : { kept: [], removed: [], added: [] },
      sauces: sauces.map((s) => nameOf(catalog, s)),
      toppings: tops.map((t) => t!.name),
      set,
      drink: set && choices.drink ? choices.drink : null,
      setItem,
      toasted: sandwich ? (choices.toasted ?? true) : null,
      price: { total, lines, needsCheck },
      nutrition,
      allergens,
      extras: extra.lines,
    },
  };
}
