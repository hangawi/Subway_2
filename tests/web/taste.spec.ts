import { describe, expect, it } from 'vitest';
import { DomainRegistry, runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { parseRules } from '../../src/conversation/rules.ts';
import { explainMenu } from '../../src/subway-menu/explain.ts';
import { isSideLike, RECOMMEND_MENU, SUBWAY_MENU_DOMAIN, subwayMenuDomain, type MenuCandidate, type MenuState } from '../../src/subway-menu/menu-domain.ts';
import { buildTaste, dayEndValidUntil, habitsOf, usualChoices, type OrderLike, type TasteRecord } from '../../src/web/taste.ts';

// 개인화 (10/16~17, 로드맵 42~46번): 휴대폰이 계산한 취향 점수 → 엔진 preference 축
const catalog = loadSubwayCatalog();
const registry = new DomainRegistry().register(subwayMenuDomain);
const byName = (n: string) => catalog.menus.find((m) => m.name === n)!;
const state = (over: Partial<MenuState> = {}): MenuState => ({ menus: catalog.menus, allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: null, goal: null, moment: null, ...over });
const decide = (s: MenuState) =>
  runDecision<MenuState, MenuCandidate>(
    { domain: SUBWAY_MENU_DOMAIN, action_type: RECOMMEND_MENU, state: s, state_version: 1, policy_version: 1, reference_at: '2026-10-17T12:10:00+09:00', requested_top_n: 3, evidence_refs: [] },
    registry,
  );
const order = (name: string, choices: Record<string, unknown> = {}): OrderLike => ({ menuId: byName(name).id, menuName: name, choices });
const rec = (over: Partial<TasteRecord>): TasteRecord => ({ id: Math.random().toString(16), scope: 'LASTING', target: { type: 'main', id: '쇠고기' }, sign: 1, at: '2026-10-17T03:00:00.000Z', valid_until: null, policy: null, account_id: null, ...over });

describe('오늘 상태 유효기간 (SOPHIA validity.day_end@1)', () => {
  it('말한 서울 날짜의 다음 날 새벽 4시까지', () => {
    expect(dayEndValidUntil(new Date('2026-10-17T13:00:00+09:00'))).toBe(new Date('2026-10-18T04:00:00+09:00').toISOString());
    expect(dayEndValidUntil(new Date('2026-10-17T23:59:00+09:00'))).toBe(new Date('2026-10-18T04:00:00+09:00').toISOString());
    // 새벽 2시에 말하면 아직 "어제" → 그날 새벽 4시까지
    expect(dayEndValidUntil(new Date('2026-10-18T02:00:00+09:00'))).toBe(new Date('2026-10-18T04:00:00+09:00').toISOString());
  });
});

describe('주문 기록에서 배우기 (habitsOf·buildTaste)', () => {
  const five = [
    order('스테이크 & 치즈', { removeVegetables: ['vegetable:양파'], sauces: ['sauce:스위트 칠리'] }),
    order('스테이크 & 치즈', { removeVegetables: ['vegetable:양파'] }),
    order('스테이크 & 치즈', { removeVegetables: ['vegetable:양파'], sauces: ['sauce:스위트 칠리'] }),
    order('쉬림프'),
    order('로스트 치킨'),
  ];
  it('2번 넘게·절반 넘게면 "늘"', () => {
    const h = habitsOf(five);
    expect(h.removeVegetables).toEqual(['vegetable:양파']);
    expect(h.sauces).toEqual([]); // 5번 중 2번 = 절반 안 됨
    expect(h.mains['쇠고기']).toBe(3);
  });
  it('자주 고른 메뉴·메인 재료가 점수로, 목록에도 나온다', () => {
    const { taste, items } = buildTaste(five, [], []);
    expect(taste.menus?.[byName('스테이크 & 치즈').id]).toBe(1);
    expect(taste.menus?.[byName('쉬림프').id]).toBeUndefined(); // 1번은 아직 아님
    expect(taste.mains?.['쇠고기']).toBe(0.5);
    expect(items.map((x) => x.key)).toEqual(expect.arrayContaining([`menu:${byName('스테이크 & 치즈').id}`, 'main:쇠고기', 'remove:vegetable:양파']));
  });
  it('지운 것(suppressed)은 다시 배우지 않는다', () => {
    const { taste, items } = buildTaste(five, [], [`menu:${byName('스테이크 & 치즈').id}`, 'main:쇠고기', 'remove:vegetable:양파']);
    expect(taste.menus).toBeUndefined();
    expect(taste.mains).toBeUndefined();
    expect(items).toEqual([]);
    expect(usualChoices(five, ['remove:vegetable:양파']).removeVegetables).toEqual([]);
  });
  it('처음 쓰는 사람: 취향 없음', () => {
    expect(buildTaste([], [], []).taste).toEqual({});
  });
});

describe('말로 한 취향 (평소 LASTING / 오늘 TODAY)', () => {
  const now = new Date('2026-10-17T13:00:00+09:00');
  it('같은 재료면 오늘이 이긴다', () => {
    const t = buildTaste([], [rec({ sign: 1 }), rec({ scope: 'TODAY', sign: -1, valid_until: dayEndValidUntil(now) })], [], now).taste;
    expect(t.mains?.['쇠고기']).toBe(-1);
    expect(t.mainsFrom?.['쇠고기']).toBe('TODAY');
  });
  it('기한이 지난 오늘 상태는 안 쓴다 (다음 날 새벽 4시 뒤)', () => {
    const r = buildTaste([], [rec({ scope: 'TODAY', sign: -1, valid_until: dayEndValidUntil(now) }), rec({ target: { type: 'mood', id: 'TIRED' }, scope: 'TODAY', valid_until: dayEndValidUntil(now) })], [], new Date('2026-10-18T04:01:00+09:00'));
    expect(r.taste).toEqual({});
    expect(r.tired).toBeNull();
    expect(r.items).toEqual([]);
  });
  it('피곤함은 기한 안에서만', () => {
    const r = buildTaste([], [rec({ target: { type: 'mood', id: 'TIRED' }, scope: 'TODAY', valid_until: dayEndValidUntil(now) })], [], now);
    expect(r.tired).not.toBeNull();
    expect(r.items[0]?.text).toContain('피곤');
  });
});

describe('말 알아듣기: 취향·피곤해·지난번처럼', () => {
  const p = (t: string) => parseRules(t, catalog).intent;
  it.each([
    ['평소에 소고기 좋아해', { main: '쇠고기', sign: 1, scope: 'LASTING' }],
    ['나 원래 새우 별로야', { main: '새우', sign: -1, scope: 'LASTING' }],
    ['오늘은 소고기 피할래', { main: '쇠고기', sign: -1, scope: 'TODAY' }],
    ['오늘은 치킨 땡겨', { main: '닭고기', sign: 1, scope: 'TODAY' }],
  ])('%s', (text, want) => expect(p(text).conditions.tastes).toEqual([want]));
  it('피곤해 → 오늘 상태 + 든든하게', () => {
    const i = p('오늘 너무 피곤해');
    expect(i.conditions.mood).toBe('TIRED');
    expect(i.conditions.goal).toBe('FILLING');
  });
  it('직접 고른 목표가 있으면 피곤해도 바꾸지 않음', () => {
    expect(p('피곤한데 가볍게').conditions.goal).toBe('LIGHT');
  });
  it('피곤한데 만원 이하로 → 피곤함 + 예산', () => {
    const i = p('피곤한데 만원 이하로');
    expect(i.conditions.mood).toBe('TIRED');
    expect(i.conditions.budgetKrw).toBe(10000);
  });
  it.each(['지난번처럼', '지난번처럼 해줘', '저번거로 줘', '늘 먹던 걸로', '평소처럼 해줘', '평소대로'])('%s → 지난 주문', (t) => expect(p(t).ask).toBe('LAST'));
  it('애매한 말은 취향으로 저장하지 않음', () => {
    expect(p('소고기 메뉴 추천해줘').conditions.tastes).toBeUndefined();
    expect(p('배고파').conditions.mood).toBeUndefined();
  });
});

describe('엔진: 취향은 점수에만, 거르기는 그대로', () => {
  const steak = byName('스테이크 & 치즈');
  it('처음 쓰는 사람은 전과 같은 순위 (취향 0)', () => {
    const a = decide(state());
    const b = decide(state({ taste: {} }));
    expect(b.candidates.map((c) => c.menu.id)).toEqual(a.candidates.map((c) => c.menu.id));
    for (const c of a.candidates) expect(c.score_components.preference).toBe(0);
  });
  it('자주 고른 메뉴가 Top3로 올라오고, 이유가 나온다', () => {
    const base = decide(state());
    expect(base.candidates.map((c) => c.menu.id)).not.toContain(steak.id);
    const r = decide(state({ taste: { menus: { [steak.id]: 1 } } }));
    const c = r.candidates.find((x) => x.menu.id === steak.id);
    expect(c).toBeDefined();
    expect(explainMenu(c!)).toContain('자주 고른 메뉴예요');
  });
  it('알레르기·예산으로 빠진 메뉴는 취향이 있어도 되살리지 않는다', () => {
    const taste = { menus: { [steak.id]: 1 }, mains: { 쇠고기: 1 } as const };
    const allergy = steak.allergens.contains[0]!;
    const a = decide(state({ allergies: [allergy], taste }));
    expect(a.candidates.map((c) => c.menu.id)).not.toContain(steak.id);
    const cheap = (steak.price.price15cm ?? 0) - 1;
    const b = decide(state({ budgetKrw: cheap, taste }));
    expect(b.candidates.map((c) => c.menu.id)).not.toContain(steak.id);
    expect(b.rejected.find((x) => x.candidate_id === steak.id)?.reason_codes).toContain('OVER_BUDGET');
  });
  it('오늘 피하는 재료는 아래로 (빼지는 않음)', () => {
    const r = decide(state({ taste: { mains: { 닭고기: -1 }, mainsFrom: { 닭고기: 'TODAY' } } }));
    for (const c of r.candidates) expect(c.menu.name).not.toMatch(/치킨|닭/);
    expect(r.rejected.filter((x) => x.reason_codes.some((k) => k.startsWith('TASTE')))).toEqual([]);
  });
});

// 2-6 검수 (10/17): 같은 조건(점심·조건 없음)에서 처음 쓰는 사람 vs 주문 5번 한 사람
describe('2-6 검수: 처음 쓰는 사람 vs 다시 쓰는 사람 Top3', () => {
  const five = [order('스테이크 & 치즈'), order('스테이크 & 치즈'), order('스테이크 & 치즈'), order('풀드포크 바비큐'), order('스테이크 & 치즈')];
  it('다시 쓰는 사람 쪽 Top3에 자주 먹는 메뉴·재료가 더 많다', () => {
    const fresh = decide(state());
    const again = decide(state({ taste: buildTaste(five, [], []).taste }));
    const liked = (ids: string[]) => ids.filter((id) => five.some((o) => o.menuId === id)).length;
    const freshTop = fresh.candidates.map((c) => c.menu.id);
    const againTop = again.candidates.map((c) => c.menu.id);
    expect(againTop[0]).toBe(byName('스테이크 & 치즈').id);
    expect(liked(againTop)).toBeGreaterThan(liked(freshTop));
    // 결과 기록용
    console.log('[2-6] 처음:', fresh.candidates.map((c) => c.menu.name).join(' / '), '| 다시:', again.candidates.map((c) => c.menu.name).join(' / '));
  });
  it('한 끼 메뉴만 나온다 (취향이 곁들이를 끌어올리지 않음)', () => {
    const again = decide(state({ taste: buildTaste(five, [], []).taste }));
    for (const c of again.candidates) expect(isSideLike(c.menu)).toBe(false);
  });
});

// 10/21 예형님: 늘 고르는 소스·빵도 내 취향에 보이고, 지우면 [평소처럼]·자동 넣기에서 빠짐 / "랜치도" = 더하기
describe('늘 고르는 소스·빵 (10/21)', () => {
  const o = (menuName: string, choices: Record<string, unknown>): OrderLike => ({ menuId: `m-${menuName}`, menuName, choices });
  const orders = [o('에그마요', { sauces: ['sauce:소금', 'sauce:후추'], bread: 'bread:허니오트' }), o('로스트 치킨', { sauces: ['sauce:소금', 'sauce:후추'], bread: 'bread:허니오트' })];
  it('2번 주문 → 내 취향에 "늘 고르는 소스: 소금·후추", "늘 고르는 빵: 허니오트"', () => {
    const texts = buildTaste(orders, [], []).items.map((x) => x.text);
    expect(texts).toContain('늘 고르는 소스: 소금·후추');
    expect(texts).toContain('늘 고르는 빵: 허니오트');
    expect(usualChoices(orders, [])).toMatchObject({ sauces: ['sauce:소금', 'sauce:후추'], bread: 'bread:허니오트' });
  });
  it('1번만 주문하면 아직 아님', () => {
    expect(usualChoices(orders.slice(0, 1), [])).toMatchObject({ sauces: [], bread: null });
  });
  it('지우면 다시 안 씀', () => {
    const key = buildTaste(orders, [], []).items.find((x) => x.text.startsWith('늘 고르는 소스'))!.key;
    expect(usualChoices(orders, [key]).sauces).toEqual([]);
    expect(buildTaste(orders, [], [key]).items.some((x) => x.text.startsWith('늘 고르는 소스'))).toBe(false);
  });
  it('"랜치도 추가" = 더하기, "랜치로" = 바꾸기', () => {
    const c = loadSubwayCatalog();
    expect(parseRules('에그마요 랜치도 추가해줘', c).intent.options.saucesAdd).toBe(true);
    expect(parseRules('에그마요 소스는 랜치로', c).intent.options.saucesAdd).toBeUndefined();
  });
});
