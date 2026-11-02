// 말 → 조건 해석 형식. AI·규칙이 돌려주는 값은 엔진 입력(MenuPrefs)과 주문서 선택(OrderChoices)으로 1:1로 옮겨진다.
// AI는 값을 옮기기만 한다: 순위·판단·실행은 엔진(vendor/sophia)과 주문서 규칙이 한다.
// 형식에 안 맞는 값은 버리고(dropped에 남김), 모르는 이름은 받지 않는다 (지어낸 재료·메뉴 0개).
import type { MenuKind, SubwayCatalog } from '../catalog/subway-catalog.ts';

export type Goal = 'PROTEIN' | 'LIGHT' | 'FILLING';
import { MAIN_KINDS, type MainKind } from '../subway-menu/menu-domain.ts';
import { SET_ITEMS } from '../order-sheet/order-sheet.ts';
const SET_ITEM_NAMES = Object.values(SET_ITEMS).flatMap((x) => x.names);
/** 세트 음료 (10/16: "콜라는 제로콜라로"). 공식 자료에 세트 음료 종류가 없어 주문서에는 "매장에서 확인"으로 적는다 */
/** 세트 음료 (매장 기계 음료 16oz). 환타는 공식 판매 목록에 없어 뺌 (10/19) */
export const DRINKS = ['콜라', '제로콜라', '사이다', '제로사이다', '커피'] as const;
export type Drink = (typeof DRINKS)[number];
export const KINDS: readonly MenuKind[] = ['SANDWICH', 'SALAD', 'GRAIN_SALAD', 'WRAP', 'MORNING_SANDWICH', 'MORNING_WRAP', 'SIDE'];

export interface IntentConditions {
  allergies?: string[];
  budgetKrw?: number;
  maxEnergyKcal?: number;
  maxSodiumMg?: number;
  goal?: Goal;
  /** 이 메인 재료 종류의 메뉴만 ("쇠고기 종류로") */
  wantMains?: MainKind[];
  /** 이 메인 재료 종류의 메뉴는 빼기 (10/19: "돼지고기 빼고", "쇠고기 말고" — 알레르기와 따로) */
  avoidMains?: MainKind[];
  /** 짜게(MORE)·싱겁게(LESS) (10/20) */
  salty?: 'MORE' | 'LESS';
  /** 기름기 적게 (10/23 "해장") */
  lowFat?: boolean;
  /** 말한 끼니 ("점심 추천해줘", 10/21) */
  meal?: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'LATE_NIGHT';
  /** 어디서 먹을지 말한 장소 ("강남역에서") — 화면이 장소 찾기로 */
  place?: string;
  /** 취향 말 (10/16): "평소에 소고기 좋아해"(LASTING) / "오늘은 소고기 피할래"(TODAY) — 화면이 동의한 사람만 휴대폰에 저장 */
  tastes?: Array<{ main: MainKind; sign: 1 | -1; scope: 'LASTING' | 'TODAY' }>;
  /** 오늘 상태 (10/16): "피곤해" → 든든한 쪽. 분명히 말했을 때만 (근거가 약하면 단정하지 않음) */
  mood?: 'TIRED';
  kinds?: MenuKind[];
  /** 매운 것 빼기: 할라피뇨·핫 칠리·스파이시 메뉴를 뺀다 */
  avoidSpicy?: boolean;
  /** 매운 것 넣기 (10/16): 스파이시 메뉴를 위로, 주문서에 할라피뇨 더·핫 칠리 소스. 빼기와 같이 오면 빼기를 따른다 */
  wantSpicy?: boolean;
  /** 가까운 곳 먼저 (매장은 이미 이동 시간 순이라 표시만) */
  nearby?: boolean;
}

export interface IntentOptions {
  size?: '15cm' | '30cm';
  bread?: string;
  /** null = 치즈 빼기 */
  cheese?: string | null;
  addVegetables?: string[];
  /** 뺐던 야채를 다시 넣기 ("아니 양파는 넣어줘", 10/20) — 더 넣기가 아님 */
  keepVegetables?: string[];
  /** 말한 소스를 평소 소스에 더함 ("랜치도", "랜치 추가", 10/21) — 없으면 말한 소스로 바꿈 */
  saucesAdd?: boolean;
  removeVegetables?: string[];
  /** 소스를 이것으로 (빈 배열 = 소스 빼기) */
  sauces?: string[];
  toppings?: string[];
  /** null = 세트 빼기 */
  set?: string | null;
  toasted?: boolean;
  /** 세트 음료 */
  drink?: Drink;
  /** 세트에서 고른 것 ("초코칩", "콘 수프") */
  setItem?: string;
  /** 단품 (10/19): catalog.singles 이름과 개수 — 해석이 id로 바꿈 */
  extras?: Array<{ name: string; qty: number }>;
}

export interface Intent {
  conditions: IntentConditions;
  options: IntentOptions;
  /** 말한 메뉴 id */
  menu?: string;
  /** LAST = "지난번처럼" (지난 주문서 그대로) */
  ask?: 'WHY' | 'COMPARE' | 'LAST';
  compare?: [number, number];
  /** "아까 거기서", "그걸로" — 앞 대화의 메뉴·선택을 이어 받는다 */
  followUp?: boolean;
  /** ③에서 "2번으로 할게" (10/21 4차) — 화면이 추천 N번째를 고름 */
  pickRank?: number;
  /** 샌드위치 없이 단품만 ("콜라만 줘", 10/19) */
  singlesOnly?: boolean;
  /** 막연한 추천 요청 ("뭐 먹지?", "오늘 뭐 먹을지 추천해줘", 10/20) — 화면이 지금 시간·취향에 맞는 한마디와 Top3 */
  vague?: boolean;
}

export const emptyIntent = (): Intent => ({ conditions: {}, options: {} });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined);

/** AI가 돌려준 값을 검사한다. 맞는 값만 남기고, 버린 것은 이유와 함께 */
export function validateIntent(raw: unknown, catalog: SubwayCatalog): { intent: Intent; dropped: string[] } {
  const dropped: string[] = [];
  const intent = emptyIntent();
  if (!isObj(raw)) return { intent, dropped: ['NOT_AN_OBJECT'] };
  const ids = (kind: string) => new Set(catalog.ingredients.filter((i) => i.category === kind).map((i) => i.id));
  const breads = ids('BREAD'), cheeses = ids('CHEESE'), vegs = ids('VEGETABLE'), sauces = ids('SAUCE');
  const toppings = new Set(catalog.toppings.map((t) => t.id));
  const menus = new Set(catalog.menus.map((m) => m.id));
  const sets = new Set(catalog.sets.map((s) => s.name));
  const list = (v: unknown, allowed: Set<string> | readonly string[], name: string) => {
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v)) return void dropped.push(name);
    const ok = v.filter((x): x is string => typeof x === 'string' && (allowed instanceof Set ? allowed.has(x) : allowed.includes(x)));
    if (ok.length !== v.length) dropped.push(name);
    return ok.length ? [...new Set(ok)] : undefined;
  };
  const c = isObj(raw.conditions) ? raw.conditions : {};
  const o = isObj(raw.options) ? raw.options : {};
  const put = <T extends object, K extends keyof T>(t: T, k: K, v: T[K] | undefined) => {
    if (v !== undefined) t[k] = v;
  };
  put(intent.conditions, 'allergies', list(c.allergies, catalog.allergenList, 'allergies'));
  put(intent.conditions, 'budgetKrw', num(c.budgetKrw, 1000, 200_000));
  put(intent.conditions, 'maxEnergyKcal', num(c.maxEnergyKcal, 50, 3000));
  put(intent.conditions, 'maxSodiumMg', num(c.maxSodiumMg, 50, 5000));
  if (c.goal === 'PROTEIN' || c.goal === 'LIGHT' || c.goal === 'FILLING') intent.conditions.goal = c.goal;
  put(intent.conditions, 'wantMains', list(c.wantMains, MAIN_KINDS, 'wantMains') as MainKind[] | undefined);
  put(intent.conditions, 'avoidMains', list(c.avoidMains, MAIN_KINDS, 'avoidMains') as MainKind[] | undefined);
  // 장소는 글자·숫자·띄어쓰기만 (10/19: AI가 "\u0000null" 같은 값을 낸 적 있음)
  if (typeof c.place === 'string' && /^[가-힣A-Za-z0-9 ]+$/.test(c.place.trim()) && c.place.trim().length >= 2 && c.place.trim().length <= 30 && !/^(?:여기|거기|저기|집|우리집|회사|학교|어디|매장|써브웨이|서브웨이|근처|이근처)$/.test(c.place.trim())) intent.conditions.place = c.place.trim();
  else if (c.place != null) dropped.push('place');
  else if (c.goal != null) dropped.push('goal');
  put(intent.conditions, 'kinds', list(c.kinds, KINDS, 'kinds') as MenuKind[] | undefined);
  if (c.avoidSpicy === true) intent.conditions.avoidSpicy = true;
  else if (c.wantSpicy === true) intent.conditions.wantSpicy = true;
  if (c.nearby === true) intent.conditions.nearby = true;
  if (c.lowFat === true) intent.conditions.lowFat = true; // 10/27: 젬마 명령의 "감기·해장 → 기름기 적게"
  if (o.size === '15cm' || o.size === '30cm') intent.options.size = o.size;
  if (typeof o.bread === 'string') breads.has(o.bread) ? (intent.options.bread = o.bread) : dropped.push('bread');
  // AI 형식은 모든 칸을 채워야 해서 null = '말 안 함'. 빼기는 'NONE'으로만 (10/16: AI를 쓰면 늘 치즈·세트가 빠지던 것)
  if (o.cheese === 'NONE') intent.options.cheese = null;
  else if (typeof o.cheese === 'string') cheeses.has(o.cheese) ? (intent.options.cheese = o.cheese) : dropped.push('cheese');
  put(intent.options, 'addVegetables', list(o.addVegetables, vegs, 'addVegetables'));
  put(intent.options, 'removeVegetables', list(o.removeVegetables, vegs, 'removeVegetables'));
  if (Array.isArray(o.sauces) && o.sauces.length === 0) intent.options.sauces = [];
  else put(intent.options, 'sauces', list(o.sauces, sauces, 'sauces'));
  put(intent.options, 'toppings', list(o.toppings, toppings, 'toppings'));
  if (o.set === 'NONE') intent.options.set = null;
  else if (typeof o.set === 'string') sets.has(o.set) ? (intent.options.set = o.set) : dropped.push('set');
  if (typeof o.drink === 'string') (DRINKS as readonly string[]).includes(o.drink) ? (intent.options.drink = o.drink as Drink) : dropped.push('drink');
  if (typeof o.setItem === 'string') SET_ITEM_NAMES.includes(o.setItem) ? (intent.options.setItem = o.setItem) : dropped.push('setItem');
  if (typeof raw.menu === 'string') menus.has(raw.menu) ? (intent.menu = raw.menu) : dropped.push('menu');
  if (raw.ask === 'WHY' || raw.ask === 'COMPARE' || raw.ask === 'LAST') intent.ask = raw.ask;
  if (raw.followUp === true) intent.followUp = true;
  return { intent, dropped };
}

/** AI에 주는 JSON 형식 (값은 정해진 목록 안에서만) */
export function intentJsonSchema(catalog: SubwayCatalog): Record<string, unknown> {
  const ids = (kind: string) => catalog.ingredients.filter((i) => i.category === kind).map((i) => i.id);
  const nul = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });
  const arr = (e: string[]) => nul({ type: 'array', items: { type: 'string', enum: e } });
  const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  return obj({
    conditions: obj({
      allergies: arr(catalog.allergenList),
      budgetKrw: nul({ type: 'integer' }),
      maxEnergyKcal: nul({ type: 'integer' }),
      maxSodiumMg: nul({ type: 'integer' }),
      goal: nul({ type: 'string', enum: ['PROTEIN', 'LIGHT', 'FILLING'] }),
      wantMains: arr([...MAIN_KINDS]),
      place: nul({ type: 'string' }),
      kinds: arr([...KINDS]),
      avoidSpicy: nul({ type: 'boolean' }),
      wantSpicy: nul({ type: 'boolean' }),
      nearby: nul({ type: 'boolean' }),
    }),
    options: obj({
      size: nul({ type: 'string', enum: ['15cm', '30cm'] }),
      bread: nul({ type: 'string', enum: ids('BREAD') }),
      cheese: nul({ type: 'string', enum: [...ids('CHEESE'), 'NONE'] }),
      addVegetables: arr(ids('VEGETABLE')),
      removeVegetables: arr(ids('VEGETABLE')),
      sauces: arr(ids('SAUCE')),
      toppings: arr(catalog.toppings.map((t) => t.id)),
      set: nul({ type: 'string', enum: [...catalog.sets.map((s) => s.name), 'NONE'] }),
      drink: nul({ type: 'string', enum: [...DRINKS] }),
      setItem: nul({ type: 'string', enum: SET_ITEM_NAMES }),
    }),
    menu: nul({ type: 'string', enum: catalog.menus.map((m) => m.id) }),
    ask: nul({ type: 'string', enum: ['WHY', 'COMPARE', 'LAST'] }),
    followUp: nul({ type: 'boolean' }),
  });
}
