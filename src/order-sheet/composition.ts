// 메뉴의 기본 구성과 고른 재료로 알레르기 합치기 (로드맵 2-2-1).
// 공식 메뉴 영양 기준이 "15cm, 위트빵·기본 야채"라서 기본 구성 = 메인 재료 + 위트빵 + 기본 야채 8종.
// 알레르기는 더 엄격한 쪽을 따른다: 공식 메뉴 줄의 알레르기는 그대로 두고,
// **사용자가 뺀 기본 재료에만 있고 메인 재료에는 없는 것**만 지운다 (예: 토마토를 빼면 토마토).
// (10/15) 샌드위치는 그대로 둔 기본 재료(위트빵·기본 야채)의 알레르기도 합친다 — 공식 메뉴 줄에 위트빵의 ★(우유·난류)가
// 빠진 메뉴(로스트 치킨 아보카도)가 우유 알레르기 추천 1위로 오르던 문제.
// 공식 표에 알레르기 정보가 없는 재료(피클·소금·후추)를 기본 구성 밖에서 더하면 "알레르기 확인 필요".
import type { CatalogIngredient, CatalogMain, CatalogMenu, CatalogTopping, MenuKind, SubwayCatalog } from '../catalog/subway-catalog.ts';

export const DEFAULT_BREAD = 'bread:위트';
export const DEFAULT_VEGETABLES = ['양상추', '토마토', '오이', '피망(파프리카)', '양파', '피클', '올리브', '할라피뇨'].map((n) => `vegetable:${n}`);
/** 이 메뉴의 기본 야채 (아침 샌드위치는 공식 안내대로 없음·3가지, 10/19). 나머지 샌드위치는 8가지 */
export const vegetablesOf = (menu: Pick<CatalogMenu, 'defaultVegetables'>): string[] => menu.defaultVegetables ?? DEFAULT_VEGETABLES;

/** 빵·치즈·야채를 바꿀 수 있는 종류 (샐러드는 소스·토핑만, 랩은 빵이 정해짐) */
export const SANDWICH_LIKE: readonly MenuKind[] = ['SANDWICH', 'MORNING_SANDWICH'];
export const WRAP_LIKE: readonly MenuKind[] = ['WRAP', 'MORNING_WRAP'];
export const SALAD_LIKE: readonly MenuKind[] = ['SALAD', 'GRAIN_SALAD'];

export type CatalogParts = Pick<SubwayCatalog, 'ingredients' | 'mains' | 'toppings'>;

export interface Changes {
  bread?: string | null;
  cheese?: string | null;
  removeVegetables?: string[];
  addVegetables?: string[];
  sauces?: string[];
  toppings?: string[];
}

export interface ComposedAllergens {
  contains: string[];
  mayContain: string[];
  /** 알레르기 정보가 없는 재료를 더함 → "알레르기 확인 필요" */
  unknownParts: string[];
  /** 메뉴 이름에서 메인 재료를 못 찾으면 뺀 재료로 알레르기를 지우지 않는다 */
  mainsFound: boolean;
}

/** 메뉴 이름에 들어 있는 메인 재료 (긴 이름 먼저: "스파이시 쉬림프"가 "쉬림프"보다 먼저) */
export function mainsOf(menu: CatalogMenu, mains: CatalogMain[]): CatalogMain[] {
  const found: CatalogMain[] = [];
  let rest = menu.name;
  for (const m of [...mains].sort((a, b) => b.name.length - a.name.length || (a.id < b.id ? -1 : 1))) {
    if (rest.includes(m.name)) {
      found.push(m);
      rest = rest.replace(m.name, ' ');
    }
  }
  return found;
}

const byId = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id) ?? null;
const uniq = (xs: string[]) => [...new Set(xs)];

export function composeAllergens(menu: CatalogMenu, parts: CatalogParts, ch: Changes = {}): ComposedAllergens {
  const editable = SANDWICH_LIKE.includes(menu.kind);
  const ing = (id: string) => byId(parts.ingredients, id);
  const top = (id: string) => byId(parts.toppings, id);
  const mains = mainsOf(menu, parts.mains);
  const removed = editable ? (ch.removeVegetables ?? []).filter((v) => vegetablesOf(menu).includes(v)) : [];
  const breadSwapped = editable && ch.bread != null && ch.bread !== DEFAULT_BREAD;
  // 더한 것: 빵(바꿨으면)·치즈·더한 야채·소스·토핑
  const added: Array<CatalogIngredient | CatalogTopping> = [];
  if (breadSwapped) added.push(ing(ch.bread!)!);
  if (editable && ch.cheese) added.push(ing(ch.cheese)!);
  if (editable) for (const v of ch.addVegetables ?? []) added.push(ing(v)!);
  for (const s of ch.sauces ?? []) added.push(ing(s)!);
  for (const t of ch.toppings ?? []) added.push(top(t)!);
  // 표에 없는 id는 알레르기를 모르는 것 → "확인 필요" (없다고 치지 않음)
  const missing = [
    ...(breadSwapped && !ing(ch.bread!) ? [ch.bread!] : []),
    ...(editable && ch.cheese && !ing(ch.cheese) ? [ch.cheese] : []),
    ...(editable ? (ch.addVegetables ?? []).filter((v) => !ing(v)) : []),
    ...(ch.sauces ?? []).filter((s) => !ing(s)),
    ...(ch.toppings ?? []).filter((t) => !top(t)),
  ];
  const present = added.filter(Boolean);
  // 뺀 기본 재료(뺀 야채 + 바꾸기 전 위트빵)에만 있는 알레르기
  const gone = [...removed, ...(breadSwapped ? [DEFAULT_BREAD] : [])].map(ing).filter((x): x is CatalogIngredient => !!x);
  const keptDefaults = [...(editable ? vegetablesOf(menu) : DEFAULT_VEGETABLES).filter((v) => !removed.includes(v)), ...(breadSwapped ? [] : [DEFAULT_BREAD])]
    .map(ing)
    .filter((x): x is CatalogIngredient => !!x);
  const stillFrom = new Set([...mains, ...keptDefaults, ...present].flatMap((x) => x.allergens.contains));
  const droppable = mains.length ? new Set(gone.flatMap((g) => g.allergens.contains).filter((a) => !stillFrom.has(a))) : new Set<string>();
  const stillMay = new Set([...mains, ...keptDefaults, ...present].flatMap((x) => x.allergens.mayContain));
  const droppableMay = mains.length ? new Set(gone.flatMap((g) => g.allergens.mayContain).filter((a) => !stillMay.has(a))) : new Set<string>();
  const base = editable ? keptDefaults : []; // 샌드위치만 기본 구성을 바꿀 수 있음 (샐러드·랩은 공식 메뉴 줄 그대로)
  const contains = uniq([...menu.allergens.contains.filter((a) => !droppable.has(a)), ...base.flatMap((x) => x.allergens.contains), ...present.flatMap((x) => x.allergens.contains)]);
  const mayContain = uniq([
    ...menu.allergens.mayContain.filter((a) => !droppableMay.has(a)),
    ...base.flatMap((x) => x.allergens.mayContain),
    ...present.flatMap((x) => x.allergens.mayContain),
  ]).filter(
    (a) => !contains.includes(a),
  );
  const unknownParts = [...present.filter((x) => x.allergens.status !== 'KNOWN').map((x) => x.name), ...missing.map((id) => `알 수 없는 재료(${id})`)];
  return { contains, mayContain, unknownParts, mainsFound: mains.length > 0 };
}

// ── 알레르기: 메인 재료 vs 나머지 재료 (10/16 예형님 요청) ──
// 메인 재료(고기·해산물 등 메뉴 이름의 재료)에 든 알레르기 → 그 메뉴는 뺀다.
// 나머지 재료(기본 야채·빵)에서만 오는 알레르기 → 메뉴는 남기고 그 재료를 자동으로 뺀다 (야채는 빼기, 빵은 그 성분이 없는 빵으로).
// 바꿀 수 없는 메뉴(샐러드·랩), 메인 재료를 못 찾는 메뉴, 어디서 왔는지 모르는 알레르기는 지금처럼 뺀다 (더 엄격한 쪽).

// 받침에 맞는 조사 (괄호 앞 글자 기준: "피망(파프리카)" → 망)
const lastSyllable = (w: string) => w.replace(/([^)]*)s*$/, '').trim().slice(-1);
const batchim = (w: string) => {
  const c = lastSyllable(w).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0;
};
const eulReul = (w: string) => `${w}${batchim(w) ? '을' : '를'}`;
const euroRo = (w: string) => `${w}${batchim(w) && batchim(w) !== 8 ? '으로' : '로'}`; // ㄹ받침은 "로"

export interface AllergyAvoid {
  /** 자동으로 뺄 기본 야채 id */
  removeVegetables: string[];
  /** 자동으로 바꿀 빵 id (안 바꾸면 null) */
  bread: string | null;
  /** 화면에 보일 말 ("토마토 알레르기라서 토마토를 뺐어요") */
  notes: string[];
  /** 그래도 남는 알레르기 (있으면 메뉴를 뺀다) */
  blocked: string[];
}

export function avoidAllergens(menu: CatalogMenu, parts: CatalogParts, allergies: readonly string[], ch: Changes = {}): AllergyAvoid {
  const none: AllergyAvoid = { removeVegetables: [], bread: null, notes: [], blocked: [] };
  if (!allergies.length) return none;
  const first = composeAllergens(menu, parts, ch);
  const hit = allergies.filter((a) => first.contains.includes(a));
  if (!hit.length) return none;
  const editable = SANDWICH_LIKE.includes(menu.kind);
  const mains = mainsOf(menu, parts.mains);
  if (!editable || !mains.length) return { ...none, blocked: hit };
  const ing = (id: string) => parts.ingredients.find((i) => i.id === id) ?? null;
  const inMains = new Set(mains.flatMap((m) => m.allergens.contains));
  const removeVegetables: string[] = [];
  let bread: string | null = null;
  const notes: string[] = [];
  const already = new Set(ch.removeVegetables ?? []);
  for (const a of hit) {
    if (inMains.has(a)) continue; // 메인 재료 → 못 뺌
    const vegs = vegetablesOf(menu).filter((v) => !already.has(v) && ing(v)?.allergens.contains.includes(a));
    if (vegs.length) {
      removeVegetables.push(...vegs.filter((v) => !removeVegetables.includes(v)));
      notes.push(`${a} 알레르기라서 ${eulReul(vegs.map((v) => ing(v)!.name).join('·'))} 뺐어요`);
    }
    const nowBread = bread ?? ch.bread ?? DEFAULT_BREAD;
    if (ing(nowBread)?.allergens.contains.includes(a)) {
      // 고른 알레르기가 모두 없는 빵 (★까지 없는 빵을 먼저)
      const breads = parts.ingredients.filter((i) => i.category === 'BREAD' && i.allergens.status === 'KNOWN' && !allergies.some((x) => i.allergens.contains.includes(x)));
      const pick = breads.find((b) => !allergies.some((x) => b.allergens.mayContain.includes(x))) ?? breads[0];
      if (pick) {
        bread = pick.id;
        notes.push(`${a} 알레르기라서 빵을 ${euroRo(pick.name)} 바꿨어요`);
      }
    }
  }
  const after = composeAllergens(menu, parts, { ...ch, removeVegetables: [...already, ...removeVegetables], ...(bread ? { bread } : {}) });
  const blocked = allergies.filter((a) => after.contains.includes(a));
  return blocked.length ? { ...none, blocked } : { removeVegetables, bread, notes, blocked: [] };
}
