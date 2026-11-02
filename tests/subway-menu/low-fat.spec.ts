import { describe, expect, it } from 'vitest';
import { DomainRegistry, runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { explainMenu } from '../../src/subway-menu/explain.ts';
import { RECOMMEND_MENU, SUBWAY_MENU_DOMAIN, subwayMenuDomain, type MenuCandidate, type MenuState } from '../../src/subway-menu/menu-domain.ts';

// 10/23 예형님 "해장" = 오늘의 수프 세트 + 기름기(포화지방)·나트륨 덜한 메뉴를 위로 — 엔진은 lowFat·salty LESS (거르지 않고 점수만)
const catalog = loadSubwayCatalog();
const registry = new DomainRegistry().register(subwayMenuDomain);
const state = (over: Partial<MenuState> = {}): MenuState => ({ menus: catalog.menus, allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: ['SANDWICH'], goal: null, moment: null, ...over });
const decide = (s: MenuState) =>
  runDecision<MenuState, MenuCandidate>({ domain: SUBWAY_MENU_DOMAIN, action_type: RECOMMEND_MENU, state: s, state_version: 1, policy_version: 1, reference_at: '2026-10-26T12:10:00+09:00', requested_top_n: 3, evidence_refs: [] }, registry);
const fat = (id: string) => catalog.menus.find((m) => m.id === id)!.nutrition15cm?.saturatedFatG ?? 99;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('기름기 적게 (해장, 10/26)', () => {
  it('Top3 포화지방이 안 켰을 때보다 낮고, 이유에 "기름기가 적은 편"', () => {
    const plain = decide(state()).candidates.map((c) => c.menu.id);
    const r = decide(state({ lowFat: true, salty: 'LESS' }));
    const top = r.candidates.map((c) => c.menu.id);
    expect(avg(top.map(fat))).toBeLessThan(avg(plain.map(fat)));
    expect(explainMenu(r.candidates[0]!).join(' ')).toMatch(/기름기\(포화지방 [\d.]+g\)가 적은 편이에요/);
  });

  it('11/02: 자주 고른 기름진 메뉴(잠봉 플러스 7.3g)·좋아하는 돼지고기보다 지금 말한 "기름기 적게"가 세다', () => {
    const jambon = catalog.menus.find((m) => m.name === '잠봉 플러스')!.id;
    const taste = { menus: { [jambon]: 1 }, mains: { 돼지고기: 1 }, mainsFrom: { 돼지고기: 'LASTING' as const } };
    const before = decide(state({ kinds: null, taste } as Partial<MenuState>));
    expect(before.candidates[0]!.menu.id).toBe(jambon); // 아무 말 없으면 취향대로
    const r = decide(state({ kinds: null, taste, lowFat: true } as Partial<MenuState>));
    expect(r.candidates.map((c) => c.menu.id)).not.toContain(jambon);
    expect(fat(r.candidates[0]!.menu.id)).toBeLessThanOrEqual(3);
    for (const c of r.candidates) expect(fat(c.menu.id)).toBeLessThan(4);
  });

  it('거르지는 않음: 뺀 메뉴 수가 같음', () => {
    expect(decide(state({ lowFat: true })).rejected.length).toBe(decide(state()).rejected.length);
  });
});
