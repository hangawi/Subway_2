import { describe, expect, it } from 'vitest';
import { DomainRegistry, runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { mealTimeOf } from '../../src/time/meal-time.ts';
import {
  RECOMMEND_MENU,
  SUBWAY_MENU_DOMAIN,
  subwayMenuDomain,
  isSideLike,
  saladKey,
  AXIS_WEIGHTS,
  type MenuCandidate,
  type MenuState,
} from '../../src/subway-menu/menu-domain.ts';

// 점검 5: 김민지 공통 엔진에 공식 데이터를 넣어 실제로 돌려 본다.
const catalog = loadSubwayCatalog();
const registry = new DomainRegistry().register(subwayMenuDomain);
// 한 끼 메뉴 (사이드·음료·미니 샐러드 같은 곁들이 제외)
const meals = catalog.menus.filter((m) => !isSideLike(m));

const state = (over: Partial<MenuState> = {}): MenuState => ({
  menus: catalog.menus,
  allergies: [],
  maxEnergyKcal: null,
  maxSodiumMg: null,
  budgetKrw: null,
  kinds: null,
  goal: null,
  moment: null,
  ...over,
});
const decide = (s: MenuState) =>
  runDecision<MenuState, MenuCandidate>(
    {
      domain: SUBWAY_MENU_DOMAIN,
      action_type: RECOMMEND_MENU,
      state: s,
      state_version: 1,
      policy_version: 1,
      reference_at: '2026-10-07T12:10:00+09:00',
      requested_top_n: 3,
      evidence_refs: [],
    },
    registry,
  );

describe('subway_menu × 김민지 공통 엔진', () => {
  it('사이드·음료는 기본 추천에 안 나오고, 종류로 고르면 나온다', () => {
    const r = decide(state());
    expect(r.trace.generated_count).toBe(meals.length);
    const sides = decide(state({ kinds: ['SIDE'] }));
    for (const c of sides.candidates) expect(isSideLike(c.menu)).toBe(true);
    const mini = catalog.menus.find((m) => m.name === '미니 로티세리 치킨 샐러드')!;
    expect(r.candidates.map((c) => c.menu.id)).not.toContain(mini.id); // 42kcal 곁들이는 한 끼 추천에 안 나옴
  });

  it('조건 없이도 Top3를 낸다', () => {
    const r = decide(state());
    expect(r.status).toBe('RANKED');
    expect(r.candidates).toHaveLength(3);
    expect(r.rejected).toEqual([]);
  });

  it('새우 알레르기: ● 포함 메뉴는 전부 이유와 함께 빠지고, ★ 포함 가능 메뉴는 남되 경고', () => {
    const r = decide(state({ allergies: ['새우'] }));
    const contains = meals.filter((m) => m.allergens.contains.includes('새우'));
    const may = meals.filter((m) => !m.allergens.contains.includes('새우') && m.allergens.mayContain.includes('새우'));
    expect(contains.length).toBeGreaterThan(0);
    expect(may.length).toBeGreaterThan(0);
    for (const m of contains) expect(r.rejected.find((x) => x.candidate_id === m.id)?.reason_codes, m.name).toContain('ALLERGEN_CONTAINS');
    for (const m of may) expect(r.rejected.find((x) => x.candidate_id === m.id), m.name).toBeUndefined();
    for (const c of r.candidates) {
      expect(c.menu.allergens.contains).not.toContain('새우');
      if (c.menu.allergens.mayContain.includes('새우')) expect(c.reason_codes).toContain('ALLERGEN_MAY_CONTAIN_WARNING');
    }
  });

  it('알레르기를 말했는데 알레르기 정보가 없는 메뉴는 뺀다 (모르는 걸 안전하다고 치지 않음)', () => {
    const r = decide(state({ allergies: ['우유'], kinds: ['SIDE'] }));
    const mini = catalog.menus.find((m) => m.name === '미니 로티세리 치킨 샐러드')!;
    expect(r.rejected.find((x) => x.candidate_id === mini.id)?.reason_codes).toContain('ALLERGEN_UNKNOWN');
  });

  it('300kcal 이하: 남은 메뉴는 모두 300kcal 이하, 넘는 메뉴는 이유와 함께 빠진다', () => {
    const r = decide(state({ maxEnergyKcal: 300 }));
    for (const c of r.candidates) expect(c.menu.nutrition15cm!.energyKcal!).toBeLessThanOrEqual(300);
    const over = meals.filter((m) => m.nutrition15cm!.energyKcal! > 300);
    expect(r.rejected.filter((x) => x.reason_codes.includes('MAX_ENERGY_EXCEEDED'))).toHaveLength(over.length);
  });

  it('단백질 목표면 단백질 많은 메뉴가 1등이다', () => {
    const r = decide(state({ goal: 'PROTEIN', kinds: ['SANDWICH'] }));
    const top = r.candidates[0]!.menu;
    const maxProtein = Math.max(...meals.filter((m) => m.kind === 'SANDWICH').map((m) => m.nutrition15cm!.proteinG!));
    expect(top.nutrition15cm!.proteinG).toBeGreaterThanOrEqual(maxProtein - 3);
    expect(r.candidates[0]!.reason_codes).toContain('HIGH_PROTEIN');
  });

  it('샐러드만: 샐러드가 아닌 메뉴는 KIND_NOT_REQUESTED로 빠진다', () => {
    const r = decide(state({ kinds: ['SALAD'] }));
    for (const c of r.candidates) expect(c.menu.kind).toBe('SALAD');
    expect(r.rejected).toHaveLength(meals.filter((m) => m.kind !== 'SALAD').length);
  });

  it('예산 7,000원: 남은 메뉴는 모두 7,000원 이하, 넘는 메뉴는 OVER_BUDGET으로 빠진다', () => {
    const r = decide(state({ budgetKrw: 7000 }));
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) expect(c.menu.price.price15cm!).toBeLessThanOrEqual(7000);
    const over = meals.filter((m) => m.price.price15cm! > 7000);
    expect(r.rejected.filter((x) => x.reason_codes.includes('OVER_BUDGET'))).toHaveLength(over.length);
  });

  it('예산을 말했는데 가격을 모르는 메뉴는 빼지 않고 "가격 확인 필요"로 남긴다', () => {
    const unknownPrice = catalog.menus.map((m) => ({ ...m, price: { ...m.price, status: 'NEEDS_CHECK' as const, price15cm: null } }));
    const r = decide(state({ menus: unknownPrice, budgetKrw: 10000 }));
    expect(r.candidates).toHaveLength(3);
    for (const c of r.candidates) expect(c.reason_codes).toContain('PRICE_NEEDS_CHECK');
  });

  it('(10/16) 매운 것 넣기: 스파이시 메뉴가 위로 + 이유, 빼기와 같이 오면 빼기만', () => {
    const plain = decide(state({ kinds: ['SANDWICH'] }));
    const spicy = decide(state({ kinds: ['SANDWICH'], wantSpicy: true }));
    const top = spicy.candidates[0]!;
    expect(/스파이시|핫s*칠리/.test(top.menu.name)).toBe(true);
    expect(top.reason_codes).toContain('SPICY_WANTED');
    expect(top.score_components.spicy).toBeGreaterThan(0);
    expect(plain.candidates[0]!.menu.id).not.toBe(top.menu.id);
    const both = decide(state({ kinds: ['SANDWICH'], wantSpicy: true, avoidSpicy: true }));
    expect(both.candidates.some((x) => /스파이시/.test(x.menu.name))).toBe(false);
  });

  it('(10/16) 아침에 매운 걸 원하면: 직접 말한 매운 것이 시간대(아침 메뉴)보다 먼저 — 12,500원 이하 Top1·2는 스파이시', () => {
    const r = decide(state({ wantSpicy: true, budgetKrw: 12500, moment: mealTimeOf('2026-10-16T10:27:00+09:00') }));
    const top2 = r.candidates.slice(0, 2).map((x) => x.menu.name);
    expect(top2.every((n) => /스파이시/.test(n))).toBe(true);
    expect(r.candidates[0]!.score_components.spicy).toBeGreaterThan(r.candidates.find((x) => x.reason_codes.includes('BREAKFAST_TIME'))?.score_components.mealTime ?? 0);
  });

  it('(10/16) 매운 걸 원하는데 매운 메뉴가 없으면(쇠고기) 맵게 만들 수 있는 샌드위치가 랩보다 먼저', () => {
    const r = decide(state({ wantSpicy: true, wantMains: ['쇠고기'], goal: 'FILLING' }));
    expect(r.candidates[0]!.menu.kind).toBe('SANDWICH');
    expect(r.candidates[0]!.reason_codes).toContain('SPICY_ADDABLE');
    const wrap = r.candidates.find((x) => x.menu.kind === 'WRAP');
    if (wrap) expect(wrap.score_components.spicy).toBe(0);
  });

  it('같은 입력이면 같은 결정 ID·순서·이유', () => {
    const a = decide(state({ allergies: ['새우', '우유'], goal: 'PROTEIN' }));
    const b = decide(state({ allergies: ['새우', '우유'], goal: 'PROTEIN' }));
    expect(a.trace.decision_id).toBe(b.trace.decision_id);
    expect(a.candidates.map((c) => c.candidate_id)).toEqual(b.candidates.map((c) => c.candidate_id));
    expect(a.trace.versions.domain_function).toBe('subway.menu@0.13');
  });

  it('시간대: 점심에는 아침 메뉴가 판매 시간 밖이라 빠지고, 아침에는 아침 메뉴가 위로', () => {
    const lunch = decide(state({ moment: mealTimeOf('2026-10-12T12:10:00+09:00') }));
    const morning = catalog.menus.filter((m) => m.kind === 'MORNING_SANDWICH' || m.kind === 'MORNING_WRAP');
    for (const m of morning) expect(lunch.rejected.find((x) => x.candidate_id === m.id)?.reason_codes).toContain('NOT_ON_SALE_NOW');
    const breakfast = decide(state({ moment: mealTimeOf('2026-10-12T08:00:00+09:00') }));
    expect(breakfast.candidates[0]!.menu.kind.startsWith('MORNING')).toBe(true);
    expect(breakfast.candidates[0]!.reason_codes).toContain('BREAKFAST_TIME');
  });

  it('시간대: 같은 조건에서 점심과 저녁의 순위가 다르다 (저녁엔 가벼운 쪽)', () => {
    // 10/19: 판매 끝난 메뉴를 뺀 뒤 1~3위는 같고 4위부터 달라져서, 10위까지 순위로 비교 (저녁엔 300kcal대 메뉴가 올라옴)
    const at = (iso: string) =>
      runDecision<MenuState, MenuCandidate>(
        { domain: SUBWAY_MENU_DOMAIN, action_type: RECOMMEND_MENU, state: state({ moment: mealTimeOf(iso) }), state_version: 1, policy_version: 1, reference_at: iso, requested_top_n: 10, evidence_refs: [] },
        registry,
      ).candidates.map((c) => c.candidate_id);
    expect(at('2026-10-12T19:00:00+09:00')).not.toEqual(at('2026-10-12T12:10:00+09:00'));
  });

  it('9개 축 점수를 가중치 미리 곱해 이름 붙여 넘긴다 (감정은 아직 0, 취향은 취향이 없으면 0)', () => {
    const r = decide(state({ budgetKrw: 10000 }));
    const parts = r.candidates[0]!.score_components;
    for (const axis of Object.keys(AXIS_WEIGHTS)) expect(parts).toHaveProperty(axis);
    expect(parts.emotion).toBe(0);
    expect(parts.preference).toBe(0);
    expect(parts.budget).toBeGreaterThan(0);
    const sum = Object.values(parts).reduce((a, b) => a + b, 0);
    expect(r.candidates[0]!.score).toBeCloseTo(sum, 5); // 엔진은 더하기만
  });

  it('같은 재료의 샐러드·그레인 샐러드는 Top3에 하나만 (나머지는 비슷한 후보로)', () => {
    const r = decide(state({ kinds: ['SALAD', 'GRAIN_SALAD'], goal: 'PROTEIN' }));
    const keys = r.candidates.map((c) => saladKey(c.menu));
    expect(new Set(keys).size).toBe(keys.length);
    expect(r.pruned.length).toBeGreaterThan(0);
  });
});
