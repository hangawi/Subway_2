import { describe, expect, it } from 'vitest';
import { runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { SUBWAY_DOMAINS } from '../../src/engine/registry.ts';
import { compareMenus, explainMenu, explainRejection, josa } from '../../src/subway-menu/explain.ts';
import { RECOMMEND_MENU, SUBWAY_MENU_DOMAIN, type MenuCandidate, type MenuState } from '../../src/subway-menu/menu-domain.ts';
import { mealTimeOf } from '../../src/time/meal-time.ts';

const catalog = loadSubwayCatalog();
const state = (over: Partial<MenuState> = {}): MenuState => ({
  menus: catalog.menus, allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: null, goal: null, moment: null, ...over,
});
const decide = (s: MenuState) =>
  runDecision<MenuState, MenuCandidate>(
    { domain: SUBWAY_MENU_DOMAIN, action_type: RECOMMEND_MENU, state: s, state_version: 1, policy_version: 1, reference_at: '2026-10-13T12:10:00+09:00', requested_top_n: 3, evidence_refs: [] },
    SUBWAY_DOMAINS,
  );

describe('추천 설명 (엔진 근거만)', () => {
  it('단백질 목표: 공식 단백질 숫자로 설명', () => {
    const top = decide(state({ goal: 'PROTEIN', kinds: ['SANDWICH'] })).candidates[0]!;
    const lines = explainMenu(top);
    expect(lines.some((l) => l.includes(`${top.menu.nutrition15cm!.proteinG}g`))).toBe(true);
  });

  it('아침: 아침 메뉴를 먼저 고른 이유', () => {
    const top = decide(state({ moment: mealTimeOf('2026-10-13T08:10:00+09:00') })).candidates[0]!;
    expect(explainMenu(top)[0]).toContain('아침');
  });

  it('뺀 이유: 어떤 알레르기 때문인지 말한다', () => {
    const s = state({ allergies: ['새우'] });
    const r = decide(s);
    const x = r.rejected.find((y) => y.reason_codes.includes('ALLERGEN_CONTAINS'))!;
    const menu = catalog.menus.find((m) => m.id === x.candidate_id)!;
    expect(explainRejection(x.reason_codes, menu, s)[0]).toBe('새우 알레르기라서 뺐어요');
  });

  it('(10/15) 뺀 이유 숫자: 원은 쉼표, mg은 "으로", 알레르기 이름을 못 찾으면 "고른 알레르기"', () => {
    const menu = catalog.menus.find((m) => m.price.price15cm !== null && m.price.price15cm > 7000)!;
    const s = state({ budgetKrw: 7000, maxSodiumMg: 10 });
    expect(explainRejection(['OVER_BUDGET'], menu, s)[0]).toBe(`${menu.price.price15cm!.toLocaleString('ko-KR')}원으로 예산(7,000원)을 넘어요`);
    expect(explainRejection(['MAX_SODIUM_EXCEEDED'], menu, s)[0]).toContain('mg으로 상한(10mg)을 넘어요');
    expect(explainRejection(['ALLERGEN_CONTAINS'], menu, state({ allergies: ['잣'] }))[0]).toBe('고른 알레르기라서 뺐어요');
  });

  it('1번이랑 2번: 차이가 큰 순서 2개, 숫자는 공식값', () => {
    const [a, b] = decide(state({ goal: 'PROTEIN' })).candidates;
    const lines = compareMenus(a!, b!);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.length).toBeLessThanOrEqual(2);
    expect(lines.every((l) => l.includes('더 좋아요'))).toBe(true);
  });

  it('같은 메뉴끼리 비교하면 "거의 같아요"', () => {
    const [a] = decide(state()).candidates;
    expect(compareMenus(a!, a!)[0]).toContain('거의 같아요');
  });

  it('★ 포함 가능 메뉴는 남지만 설명 맨 앞에 경고 (어떤 알레르기인지)', () => {
    const s = state({ allergies: ['우유'] });
    const r = decide(s);
    const warned = r.candidates.find((c) => c.reason_codes.includes('ALLERGEN_MAY_CONTAIN_WARNING'));
    expect(warned).toBeDefined();
    expect(explainMenu(warned!, s.allergies)[0]).toBe('⚠ 우유가 들어 있을 수 있어요 (공식 표 ★ 포함 가능) — 매장에서 꼭 확인하세요');
  });

  it('조사를 받침에 맞게', () => {
    expect(josa('참치', '이', '가')).toBe('참치가');
    expect(josa('로스트 치킨', '이', '가')).toBe('로스트 치킨이');
    expect(josa('잠봉 플러스', '은', '는')).toBe('잠봉 플러스는');
  });

  it('★ 포함 가능 메뉴는 조금 내림 (−0.5): 점수가 비슷하면 ★ 없는 메뉴가 위로', () => {
    const s = state({ allergies: ['우유'], goal: 'PROTEIN' });
    const r = decide(s);
    const may = r.candidates.filter((c) => c.reason_codes.includes('ALLERGEN_MAY_CONTAIN_WARNING'));
    for (const c of may) expect(c.score_components.allergyRisk).toBe(-0.5);
    for (const c of r.candidates.filter((x) => !x.reason_codes.includes('ALLERGEN_MAY_CONTAIN_WARNING'))) expect(c.score_components.allergyRisk).toBe(0);
    // 알레르기를 말하지 않으면 깎지 않는다
    expect(decide(state({ goal: 'PROTEIN' })).candidates.every((c) => c.score_components.allergyRisk === 0)).toBe(true);
  });
});
