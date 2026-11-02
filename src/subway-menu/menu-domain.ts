// 메뉴 고르기 어댑터 `subway_menu` — 김민지 SOPHIA 공통 엔진에 붙는 써브웨이 판단 규칙.
//  generate: 카탈로그의 식사 메뉴 (15cm 기본 구성). 사이드·음료·미니 샐러드(곁들이)는 종류에 'SIDE'를 고른 경우에만
//  hard:     아침 메뉴는 판매 시간(06:00~11:00)에만, 알레르기 포함(●), 알레르기 정보 없음(알레르기를 말한 경우), 열량·나트륨 상한 초과,
//            상한을 말했는데 영양 정보 없음, 예산 초과(가격을 아는 경우), 고른 종류가 아님
//  evaluate: 예전 Subway의 9개 축(단백질·나트륨·열량·예산·포만감·감정·건강·신뢰도·취향)을 0~100으로 매기고
//            가중치를 **미리 곱해** 이름 붙은 점수로 넘긴다 (엔진은 더하기만). 공식 영양 6개 항목만 쓴다(식이섬유 없음).
//            감정·취향은 아직 입력이 없어 0 (10/16 개인화에서 채움). 아침 시간엔 아침 메뉴 + (mealTime)
//  similar:  같은 재료의 샐러드·그레인 샐러드는 하나 (Top3가 실제 대안이 되게)
// 모르는 것은 좋은 것으로 치지 않는다: 알레르기를 말했는데 그 메뉴의 알레르기 정보가 없으면 뺀다.
// 알레르기는 고른 재료 합으로 (src/order-sheet/composition.ts): 뺄 재료(예: 토마토)를 말하면 그 재료 몫만 지운다.
// ★ 포함 가능은 빼지 않고 경고(ALLERGEN_MAY_CONTAIN_WARNING) — 10/13 계획 (로드맵 2-2-1)
import type { DomainAdapter } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import type { CatalogMenu, MenuKind } from '../catalog/subway-catalog.ts';
import { avoidAllergens, composeAllergens, SANDWICH_LIKE, type AllergyAvoid, type CatalogParts } from '../order-sheet/composition.ts';
import { breakfastOnSale, type MealMoment } from '../time/meal-time.ts';

export const SUBWAY_MENU_DOMAIN = 'subway_menu';
export const RECOMMEND_MENU = 'RECOMMEND_MENU';
export const SUBWAY_MENU_FUNCTION_VERSION = 'subway.menu@0.13';

export interface MenuState {
  menus: CatalogMenu[];
  allergies: string[];
  maxEnergyKcal: number | null;
  maxSodiumMg: number | null;
  budgetKrw: number | null;
  kinds: MenuKind[] | null;
  /** FILLING = 든든하게 (10/16: "배고파") */
  goal: 'PROTEIN' | 'LIGHT' | 'FILLING' | null;
  /** 지금 시각 (mealTimeOf). null이면 시간 규칙을 쓰지 않는다 */
  moment: MealMoment | null;
  /** 뺄 기본 야채 id (예: 'vegetable:토마토'). 샌드위치만 뺄 수 있다 */
  removeVegetables?: string[];
  /** 재료 표 (알레르기 합산용). 없으면 공식 메뉴 줄 그대로 */
  parts?: CatalogParts;
  /** 매운 것 빼기: 이름에 "스파이시"가 든 메뉴는 뺀다 (할라피뇨는 주문서에서 뺌) */
  avoidSpicy?: boolean;
  /** 매운 것 넣기 (10/16): 스파이시 메뉴에 가점 (빼기와 같이 오면 빼기만) */
  wantSpicy?: boolean;
  /** 이 메인 재료 종류의 메뉴만 (10/16: "쇠고기 종류로") — 여러 개면 그중 하나라도 */
  wantMains?: MainKind[];
  /** 이 메인 재료 종류의 메뉴는 빼기 (10/19: "돼지고기 빼고") — 알레르기가 아니라 고른 조건 */
  avoidMains?: MainKind[];
  /** 짜게(MORE) / 싱겁게(LESS) (10/20) — 나트륨 점수에만, 거르지는 않음 */
  salty?: 'MORE' | 'LESS';
  /** 기름기 적게 (10/23 예형님 "해장"): 포화지방 낮은 메뉴를 위로 — 거르지는 않음 */
  lowFat?: boolean;
  /** 말한 끼니 (10/21 예형님: 아침에 "점심 추천해줘" → 아침 메뉴를 고르던 것). 있으면 지금 시각 대신 이 끼니로 — 점심·저녁·야식이면 아침 메뉴는 뺌 */
  meal?: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'LATE_NIGHT';
  /** 내 취향 (10/16, 로드맵 42·43번): 화면이 평소 취향(LASTING)과 오늘 상태(TODAY, 유효기간)를 합쳐 넘긴다 — 같은 대상이면 오늘이 이김.
   *  점수(preference)에 더하기만 하고, 알레르기·예산 같은 거르기(hard)는 절대 바꾸지 않는다 */
  taste?: Taste;
}

export interface Taste {
  /** 메뉴별 -1 ~ 1 (자주 고른 메뉴 +) */
  menus?: Record<string, number>;
  /** 메인 재료 종류별 -1 ~ 1 (평소 쇠고기 좋아함 +, 오늘 쇠고기 피함 −) */
  mains?: Partial<Record<MainKind, number>>;
  /** 메인 재료 점수가 어디서 왔는지 (설명용) */
  mainsFrom?: Partial<Record<MainKind, 'LASTING' | 'TODAY'>>;
}

/** 취향 점수 -1 ~ 1: 메뉴 60% + 메인 재료 40% (설계값). 취향이 없으면 null (점수 0 그대로 — 처음 쓰는 사람은 전과 같음) */
export function tasteOf(state: MenuState, menu: CatalogMenu): { score: number; menu: number; main: number; mainKind: MainKind | null } | null {
  const t = state.taste;
  if (!t || (!Object.keys(t.menus ?? {}).length && !Object.keys(t.mains ?? {}).length)) return null;
  const m = Math.max(-1, Math.min(1, t.menus?.[menu.id] ?? 0));
  const kinds = mainKindsOf(menu);
  let main = 0;
  let mainKind: MainKind | null = null;
  // 싫어하는 재료가 하나라도 들었으면 그쪽이 이김 (10/20: "치킨 좋아함 + 돼지고기 별로"에 "로스트 치킨 베이컨"이 위로 오던 것)
  const disliked = kinds.filter((k) => (t.mains?.[k] ?? 0) < 0);
  for (const k of disliked.length ? disliked : kinds) {
    const v = t.mains?.[k];
    if (v !== undefined && Math.abs(v) > Math.abs(main)) (main = Math.max(-1, Math.min(1, v))), (mainKind = k);
  }
  return { score: m * 0.6 + main * 0.4, menu: m, main, mainKind };
}

/** 메뉴의 메인 재료 종류 (메뉴 이름으로 정함). 알레르기 표로 정하지 않는다:
 *  공식 표에서 로스트 치킨에도 쇠고기가 들어 있어(양념) "쇠고기 종류"에 치킨이 섞이기 때문 (10/16) */
export const MAIN_KINDS = ['쇠고기', '닭고기', '돼지고기', '새우', '참치', '달걀', '야채'] as const;
export type MainKind = (typeof MAIN_KINDS)[number];
const MAIN_NAME: Record<MainKind, RegExp> = {
  쇠고기: /스테이크|비프|불고기|미트볼/,
  닭고기: /치킨|로티세리/,
  돼지고기: /햄|베이컨|잠봉|풀드포크|비엠티|페퍼로니|이탈리안|피자썹|비엘티|살라미/,
  새우: /쉬림프|새우/,
  참치: /참치/,
  달걀: /에그/,
  야채: /^베지|그린 (?:그레인 )?샐러드/,
};
export const mainKindsOf = (m: CatalogMenu): MainKind[] => MAIN_KINDS.filter((k) => MAIN_NAME[k].test(m.name));

export interface MenuCandidate {
  candidate_id: string;
  menu: CatalogMenu;
}

// 9개 축 가중치 — 예전 Subway `scoring-config.ts`의 기본값 그대로 (설계값, 측정값 아님).
export const AXIS_WEIGHTS = {
  protein: 0.18,
  sodium: 0.12,
  calorie: 0.12,
  budget: 0.1,
  satiety: 0.16,
  emotion: 0.2,
  health: 0.07,
  confidence: 0.05,
  preference: 0.15,
} as const;
export type ScoreAxis = keyof typeof AXIS_WEIGHTS;
// 점수 크기: 축 점수(0~100) × 가중치 / 100 × SCALE. 아침 메뉴 보너스는 같은 크기로.
const SCALE = 10;
const BREAKFAST_BONUS = 1.5;
// ★(포함 가능) 알레르기 메뉴는 빼지 않지만 조금 내린다: 점수가 비슷하면 ★ 없는 메뉴가 위로 (10/14 사용자 결정, 설계값)
export const MAY_CONTAIN_PENALTY = -0.5;
/** 매운 걸 원할 때 스파이시 메뉴 가점 (설계값). 직접 말한 바람이 시간대로 짐작한 것보다 세야 한다 →
 *  아침 시간 가점(1.5)의 두 배 (10/16: 아침에 "매운 거 넣어서"라고 했는데 매운 게 없는 아침 메뉴가 1·2위로 나오던 것) */
export const SPICY_BONUS = 3;
/** 취향 가점 (10/20, 3,000문장 시험에서 찾음): 취향 축(가중치 0.15)만으로는 ±0.75점이라 "자주 고른 메뉴"·"평소 소고기 좋아해"가
 *  순위를 거의 못 바꿨다 (메인 재료만이면 최대 0.4×). 메뉴 점수·메인 재료 점수(각 -1~1)에 따로 × 3을 더한다 — 직접 말한 "맵게"(3)와 같은 크기.
 *  자주 고른 메뉴 2번 = +2, 3번 = +3 / 말한 "평소 채식 좋아해" = +3, 주문 기록으로 배운 메인 재료 = +1.5 (설계값). 알레르기·예산 같은 거르기는 그대로 */
export const TASTE_BONUS = { menu: 3, main: 3 } as const;
/** 스파이시 메뉴가 아니어도 맵게 만들 수 있으면 조금 (샌드위치: 할라피뇨·핫 칠리, 샐러드: 핫 칠리 소스) */
export const SPICY_ADDABLE_BONUS = { sandwich: 1, salad: 0.5 } as const;
export const isSpicyMenu = (m: CatalogMenu) => /스파이시|핫\s*칠리/.test(m.name);
// 목표값 (예전 Subway 설계값). 단백질 22g(목표가 단백질이면 30g), 나트륨 700mg 아래, 열량은 시간대별.
const PROTEIN_TARGET = { normal: 22, goal: 30 } as const;
const SODIUM_TARGET_MG = 700;
const SALTY_MORE_MG = 900;
const SALTY_LESS_MG = 500;
/** 기름기 적게: 포화지방 3g 아래면 만점, 6g 넘으면 0 (설계값).
 *  11/02 (예형님 "기름기 없는 거"에 포화지방 7.3g 잠봉 플러스가 1위): 예전 무게(0.24 → 최대 2.4점)는 취향 가점(최대 6점)에 늘 졌다.
 *  지금 말한 조건이 평소 취향보다 세야 하므로 최대 5점 + 아래 TASTE_WHEN_ASKED로 취향을 절반으로 → 최대 3점보다 크다 */
const LOW_FAT_G = 3;
const LOW_FAT_WEIGHT = 0.5;
/** 이번 말에 바람(기름기 적게·맵게·목표·짜게/싱겁게)을 말했으면 취향 가점은 절반만 (11/02): 평소 취향은 같은 점수일 때 고르는 데 쓴다 */
const TASTE_WHEN_ASKED = 0.5;
// 저녁·야식은 가볍게 (10/12 시간대 설계): 예전 저녁 550 → 450, 야식 300
const ENERGY_TARGET: Record<string, number> = { BREAKFAST: 450, LUNCH: 600, AFTERNOON: 250, DINNER: 450, LATE_NIGHT: 300, NONE: 500 };
const LIGHT_ENERGY_TARGET = 350;
const LIGHT_BEST_KCAL = 200;
/** 든든하게: 배부른 한 끼 (설계값) */
const FILLING_ENERGY_TARGET = 650;
const MORNING: readonly MenuKind[] = ['MORNING_SANDWICH', 'MORNING_WRAP'];
const round = (n: number) => Math.round(n * 1e4) / 1e4;
const clamp = (n: number) => Math.min(100, Math.max(0, n));
// 모르는 값은 40 (예전 Subway와 같음 — 좋은 것으로 치지 않음)
const atLeast = (v: number | null | undefined, target: number) => (v == null ? 40 : clamp((v / target) * 100));
const atMost = (v: number | null | undefined, target: number) =>
  v == null ? 40 : v <= target ? 100 : v >= target * 2 ? 0 : clamp(100 - ((v - target) / target) * 100);
const near = (v: number | null | undefined, target: number) => (v == null ? 40 : clamp(100 - (Math.abs(v - target) / target) * 100));

/** 미니 샐러드처럼 한 끼가 아닌 곁들이 메뉴 (공식 분류는 샐러드지만 42kcal). 사이드와 같이 다룬다 */
export const isSideLike = (m: CatalogMenu) => m.kind === 'SIDE' || (m.kind === 'SALAD' && m.name.startsWith('미니 '));
/** 같은 재료의 샐러드·그레인 샐러드를 묶는 열쇠 ("로티세리 치킨 더블치즈 (그레인) 샐러드" → 같은 열쇠) */
export const saladKey = (m: CatalogMenu) =>
  m.kind === 'SALAD' || m.kind === 'GRAIN_SALAD' ? m.name.replace(/\s*(그레인\s*)?샐러드$/, '').trim() : null;

/** 고른 알레르기 때문에 자동으로 뺄 재료 (10/16: 메인 재료가 아니면 메뉴 대신 그 재료만 뺌) */
export function allergyAvoidOf(state: MenuState, menu: CatalogMenu): AllergyAvoid | null {
  if (!state.parts || !state.allergies.length) return null;
  return avoidAllergens(menu, state.parts, state.allergies, { removeVegetables: state.removeVegetables ?? [] });
}

/** 이 메뉴를 (뺄 재료 + 알레르기로 자동으로 뺀 재료를 반영해) 먹을 때의 알레르기 */
export function allergensOf(state: MenuState, menu: CatalogMenu): { contains: string[]; mayContain: string[] } {
  if (!state.parts) return menu.allergens;
  const av = allergyAvoidOf(state, menu);
  return composeAllergens(menu, state.parts, {
    removeVegetables: [...(state.removeVegetables ?? []), ...(av?.removeVegetables ?? [])],
    ...(av?.bread ? { bread: av.bread } : {}),
  });
}

/** 축 점수 (0~100) — 설명(explain.ts)도 이 값을 쓴다 */
export function axisScores(state: MenuState, menu: CatalogMenu): Record<ScoreAxis, number> {
  const n = menu.nutrition15cm;
  const proteinFit = atLeast(n?.proteinG, state.goal === 'PROTEIN' ? PROTEIN_TARGET.goal : PROTEIN_TARGET.normal);
  const healthSodium = atMost(n?.sodiumMg, state.maxSodiumMg ?? SODIUM_TARGET_MG);
  // 짜게: 나트륨 높을수록 (900mg까지), 싱겁게: 500mg 아래일수록 — 건강 점수는 그대로 보통 기준 (10/20)
  const sodiumFit = state.salty === 'MORE' ? atLeast(n?.sodiumMg, SALTY_MORE_MG) : state.salty === 'LESS' ? atMost(n?.sodiumMg, SALTY_LESS_MG) : healthSodium;
  const energyTarget = state.goal === 'LIGHT' ? LIGHT_ENERGY_TARGET : state.goal === 'FILLING' ? FILLING_ENERGY_TARGET : ENERGY_TARGET[state.meal ?? state.moment?.meal ?? 'NONE']!;
  // 가볍게는 "가까울수록"이 아니라 "낮을수록" (200kcal 이하 만점) — 10/21: 193kcal 샐러드보다 338kcal이 위로 오던 것
  const calorieFit = state.goal === 'LIGHT' ? atMost(n?.energyKcal, LIGHT_BEST_KCAL) : near(n?.energyKcal, energyTarget);
  const price = menu.price.price15cm;
  const budgetFit =
    state.budgetKrw === null ? 0 : price === null ? 40 : price > state.budgetKrw ? 0 : clamp(75 + ((state.budgetKrw - price) / state.budgetKrw) * 25);
  const satietyFit = clamp(proteinFit * 0.5 + atLeast(n?.energyKcal, energyTarget * 0.7) * 0.5);
  const healthFit = (proteinFit + healthSodium + calorieFit) / 3;
  const known = [n !== null, menu.allergens.status === 'KNOWN', menu.price.status === 'KNOWN'].filter(Boolean).length;
  return {
    protein: proteinFit,
    sodium: sodiumFit,
    calorie: calorieFit,
    budget: budgetFit,
    satiety: satietyFit,
    emotion: 0, // 10/16: 기분·상황
    health: healthFit,
    confidence: (known / 3) * 100,
    // 10/16 취향: 취향이 있으면 50(보통) ± 50, 없으면 0 (처음 쓰는 사람은 전과 같은 순위)
    preference: (() => {
      const ts = tasteOf(state, menu);
      return ts === null ? 0 : clamp(50 + 50 * ts.score);
    })(),
  };
}

const axisWeight = (state: MenuState, axis: ScoreAxis) =>
  (axis === 'satiety' && state.goal === 'LIGHT' ? 0 : 1) *
  AXIS_WEIGHTS[axis] *
  ((axis === 'protein' && state.goal === 'PROTEIN') || (axis === 'calorie' && state.goal === 'LIGHT') || (axis === 'satiety' && state.goal === 'FILLING') || (axis === 'sodium' && !!state.salty) ? 2 : 1);

export const subwayMenuDomain: DomainAdapter<MenuState, MenuCandidate> = {
  domain: SUBWAY_MENU_DOMAIN,
  function_version: SUBWAY_MENU_FUNCTION_VERSION,
  action_types: [RECOMMEND_MENU],

  *generate(state) {
    const wantSides = state.kinds?.includes('SIDE') ?? false;
    for (const menu of state.menus) {
      if (isSideLike(menu) && !wantSides) continue;
      yield { candidate_id: menu.id, menu };
    }
  },

  hard(state, { menu }) {
    const reasons: string[] = [];
    if (state.kinds && !state.kinds.includes(menu.kind) && !(isSideLike(menu) && state.kinds.includes('SIDE')))
      reasons.push('KIND_NOT_REQUESTED');
    if (state.avoidSpicy && isSpicyMenu(menu)) reasons.push('TOO_SPICY');
    if (state.wantMains?.length && !mainKindsOf(menu).some((k) => state.wantMains!.includes(k))) reasons.push('NOT_WANTED_MAIN');
    if (state.avoidMains?.length && mainKindsOf(menu).some((k) => state.avoidMains!.includes(k))) reasons.push('AVOIDED_MAIN');
    // 아침 메뉴는 공식 판매 시간(06:00~11:00)에만
    if (state.meal && state.meal !== 'BREAKFAST' && MORNING.includes(menu.kind)) reasons.push('NOT_FOR_THAT_MEAL');
    else if (state.moment && MORNING.includes(menu.kind) && !breakfastOnSale(state.moment) && state.meal !== 'BREAKFAST') reasons.push('NOT_ON_SALE_NOW');
    if (state.allergies.length) {
      if (menu.allergens.status !== 'KNOWN') reasons.push('ALLERGEN_UNKNOWN');
      else if (state.allergies.some((a) => allergensOf(state, menu).contains.includes(a))) reasons.push('ALLERGEN_CONTAINS');
    }
    const n = menu.nutrition15cm;
    if (state.maxEnergyKcal !== null) {
      if (n?.energyKcal == null) reasons.push('NUTRITION_UNKNOWN');
      else if (n.energyKcal > state.maxEnergyKcal) reasons.push('MAX_ENERGY_EXCEEDED');
    }
    if (state.maxSodiumMg !== null) {
      if (n?.sodiumMg == null) reasons.push('NUTRITION_UNKNOWN');
      else if (n.sodiumMg > state.maxSodiumMg) reasons.push('MAX_SODIUM_EXCEEDED');
    }
    if (state.budgetKrw !== null && menu.price.price15cm !== null && menu.price.price15cm > state.budgetKrw)
      reasons.push('OVER_BUDGET');
    return [...new Set(reasons)];
  },

  evaluate(state, { menu }) {
    const n = menu.nutrition15cm;
    const axes = axisScores(state, menu);
    const parts: Record<string, number> = {};
    for (const axis of Object.keys(AXIS_WEIGHTS) as ScoreAxis[]) parts[axis] = round((axes[axis] * axisWeight(state, axis) * SCALE) / 100);
    const meal = state.meal ?? state.moment?.meal ?? null;
    parts.mealTime = meal === 'BREAKFAST' && MORNING.includes(menu.kind) ? BREAKFAST_BONUS : 0;
    parts.lowFat = state.lowFat ? round((atMost(n?.saturatedFatG, LOW_FAT_G) * LOW_FAT_WEIGHT * SCALE) / 100) : 0;
    const mayRisk = state.allergies.some((a) => allergensOf(state, menu).mayContain.includes(a));
    parts.allergyRisk = mayRisk ? MAY_CONTAIN_PENALTY : 0;
    // 매운 걸 원하면: 스파이시 메뉴가 가장 좋고, 아니어도 맵게 만들 수 있는 메뉴가 그다음
    //  (샌드위치는 할라피뇨 더 + 핫 칠리, 샐러드는 핫 칠리 소스만, 랩은 구성이 정해져 있어 못 함) — 10/16: 랩이 골라져 "매운 것"이 사라지던 것
    const wantsHot = !!state.wantSpicy && !state.avoidSpicy;
    const spicyWanted = wantsHot && isSpicyMenu(menu);
    const spicyAddable = wantsHot && !spicyWanted && (SANDWICH_LIKE.includes(menu.kind) || menu.kind === 'SALAD' || menu.kind === 'GRAIN_SALAD');
    parts.spicy = spicyWanted ? SPICY_BONUS : spicyAddable ? (SANDWICH_LIKE.includes(menu.kind) ? SPICY_ADDABLE_BONUS.sandwich : SPICY_ADDABLE_BONUS.salad) : 0;
    const reason_codes: string[] = [];
    if (meal === 'BREAKFAST' && MORNING.includes(menu.kind)) reason_codes.push('BREAKFAST_TIME');
    if (spicyWanted) reason_codes.push('SPICY_WANTED');
    else if (spicyAddable) reason_codes.push('SPICY_ADDABLE');
    const ts = tasteOf(state, menu);
    const asked = state.lowFat || state.wantSpicy || state.goal || state.salty ? TASTE_WHEN_ASKED : 1;
    if (ts) parts.preference = round(parts.preference! + (ts.menu * TASTE_BONUS.menu + ts.main * TASTE_BONUS.main) * asked);
    if (ts) {
      if (ts.menu >= 0.5) reason_codes.push('TASTE_FAVORITE_MENU');
      if (ts.main > 0 && ts.mainKind) reason_codes.push(`TASTE_LIKED_MAIN:${ts.mainKind}:${state.taste?.mainsFrom?.[ts.mainKind] ?? 'LASTING'}`);
      if (ts.main < 0 && ts.mainKind) reason_codes.push(`TASTE_AVOID_MAIN:${ts.mainKind}:${state.taste?.mainsFrom?.[ts.mainKind] ?? 'LASTING'}`);
    }
    if ((meal === 'DINNER' || meal === 'LATE_NIGHT') && (n?.energyKcal ?? Infinity) <= 350) reason_codes.push('LIGHTER_FOR_EVENING');
    if ((n?.proteinG ?? 0) >= 25) reason_codes.push('HIGH_PROTEIN');
    if (state.goal === 'LIGHT' && (n?.energyKcal ?? Infinity) <= LIGHT_ENERGY_TARGET) reason_codes.push('LIGHT_MEAL');
    if (state.salty === 'MORE') {
      if (axes.sodium >= 80) reason_codes.push('SALTY_WANTED');
    } else if (axes.sodium >= 100) reason_codes.push('LOW_SODIUM');
    if (axes.satiety >= 80 && state.goal !== 'LIGHT') reason_codes.push('FILLING');
    if (state.lowFat && n?.saturatedFatG != null && n.saturatedFatG <= LOW_FAT_G) reason_codes.push('LOW_FAT');
    if (state.budgetKrw !== null && axes.budget >= 75) reason_codes.push('WITHIN_BUDGET');
    if (!n) reason_codes.push('NUTRITION_UNKNOWN');
    if (state.allergies.some((a) => allergensOf(state, menu).mayContain.includes(a))) reason_codes.push('ALLERGEN_MAY_CONTAIN_WARNING');
    const av = allergyAvoidOf(state, menu);
    if (av && (av.removeVegetables.length || av.bread)) reason_codes.push('ALLERGEN_AUTO_AVOIDED');
    if (state.removeVegetables?.length && SANDWICH_LIKE.includes(menu.kind)) reason_codes.push('VEGETABLES_REMOVED');
    if (state.budgetKrw !== null && menu.price.status !== 'KNOWN') reason_codes.push('PRICE_NEEDS_CHECK');
    return { score_components: parts, reason_codes };
  },

  tieBreak: (a, b) => (a.menu.name < b.menu.name ? -1 : a.menu.name > b.menu.name ? 1 : 0),
  similar: (a, b) => {
    const k = saladKey(a.menu);
    return k !== null && k === saladKey(b.menu);
  },
};
