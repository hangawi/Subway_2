import { describe, expect, it } from 'vitest';
import { runDecision } from '../../vendor/sophia/pure_engine/decision-graph.ts';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { SUBWAY_DOMAINS } from '../../src/engine/registry.ts';
import { avoidAllergens, composeAllergens, mainsOf } from '../../src/order-sheet/composition.ts';
import { buildOrderSheet } from '../../src/order-sheet/order-sheet.ts';
import { RECOMMEND_MENU, SUBWAY_MENU_DOMAIN, type MenuCandidate, type MenuState } from '../../src/subway-menu/menu-domain.ts';

const catalog = loadSubwayCatalog();
const menu = (name: string) => catalog.menus.find((m) => m.name === name)!;
const topping = (name: string, appliesTo = 'SANDWICH') => catalog.toppings.find((t) => t.name === name && t.appliesTo === appliesTo)!.id;
const decide = (over: Partial<MenuState>) =>
  runDecision<MenuState, MenuCandidate>(
    {
      domain: SUBWAY_MENU_DOMAIN, action_type: RECOMMEND_MENU, reference_at: '2026-10-13T12:10:00+09:00', requested_top_n: 3, evidence_refs: [], state_version: 1, policy_version: 1,
      state: { menus: catalog.menus, allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: null, goal: null, moment: null, parts: catalog, ...over },
    },
    SUBWAY_DOMAINS,
  );

describe('알레르기를 고른 재료 합으로', () => {
  it('(10/16) 토마토 알레르기: 토마토는 메인 재료가 아니라 샌드위치는 남고 토마토만 자동으로 뺌, 메인 재료를 모르는 피자썹은 뺌', () => {
    const r = decide({ allergies: ['토마토'], kinds: ['SANDWICH'] });
    expect(r.status).toBe('RANKED');
    expect(r.candidates[0]!.reason_codes).toContain('ALLERGEN_AUTO_AVOIDED');
    expect(r.rejected.find((x) => x.candidate_id === menu('피자썹').id)?.reason_codes).toContain('ALLERGEN_CONTAINS');
    // 직접 토마토를 빼도 같은 결과 (자동으로 뺄 게 없으니 자동 표시는 없음)
    const self = decide({ allergies: ['토마토'], kinds: ['SANDWICH'], removeVegetables: ['vegetable:토마토'] });
    expect(self.candidates[0]!.reason_codes).toContain('VEGETABLES_REMOVED');
    expect(self.candidates[0]!.reason_codes).not.toContain('ALLERGEN_AUTO_AVOIDED');
  });

  it('(10/16) 메인 재료에 든 알레르기는 그 메뉴를 뺌 (닭고기 → 로스트 치킨), 모든 빵에 든 밀은 피할 수 없어 뺌', () => {
    const chicken = decide({ allergies: ['닭고기'], kinds: ['SANDWICH'] });
    expect(chicken.rejected.find((x) => x.candidate_id === menu('로스트 치킨').id)?.reason_codes).toContain('ALLERGEN_CONTAINS');
    expect(avoidAllergens(menu('로스트 치킨'), catalog, ['밀']).blocked).toEqual(['밀']);
    // 샐러드는 야채를 바꿀 수 없어 지금처럼 뺌
    expect(avoidAllergens(menu('쉬림프 아보카도 샐러드'), catalog, ['토마토']).blocked).toEqual(['토마토']);
    expect(avoidAllergens(menu('로스트 치킨'), catalog, ['토마토'])).toEqual({ removeVegetables: ['vegetable:토마토'], bread: null, notes: ['토마토 알레르기라서 토마토를 뺐어요'], blocked: [] });
  });

  it('메인 재료를 못 찾는 메뉴(피자썹 — 피자 소스)는 토마토를 빼도 지우지 않는다 (더 엄격한 쪽)', () => {
    const pizza = menu('피자썹');
    expect(mainsOf(pizza, catalog.mains)).toEqual([]);
    expect(composeAllergens(pizza, catalog, { removeVegetables: ['vegetable:토마토'] }).contains).toContain('토마토');
  });

  it('우유 알레르기: 우유(●)가 든 메뉴는 빠지고 치즈 없는 메뉴가 남는다, 빵의 ★우유는 경고', () => {
    const r = decide({ allergies: ['우유'] });
    expect(r.status).toBe('RANKED');
    for (const c of r.candidates) expect(c.menu.allergens.contains).not.toContain('우유');
    expect(r.rejected.some((x) => x.reason_codes.includes('ALLERGEN_CONTAINS'))).toBe(true);
  });

  it('(10/15) 그대로 둔 위트빵의 ★우유·난류도 합친다: 메뉴 줄에 ★가 빠진 메뉴도 경고 + 감점', () => {
    // 10/15에 찾은 경우(로스트 치킨 아보카도: 메뉴 줄에 ★ 없음)를 그대로 만든 시험용 메뉴 — 10/19 그 메뉴는 판매 끝
    const base = menu('로스트 치킨');
    const rca = { ...base, id: 'menu_test_no_star', name: '시험용 ★ 없는 메뉴', allergens: { ...base.allergens, mayContain: [] } };
    expect(rca.allergens.mayContain).toEqual([]); // 메뉴 줄에는 ★ 없음
    expect(composeAllergens(rca, catalog).mayContain).toEqual(expect.arrayContaining(['우유', '난류']));
    // 빵을 바꾸면 위트빵의 ★는 빠지고 바꾼 빵 것만 (허니오트)
    const honey = catalog.ingredients.find((i) => i.id === 'bread:허니오트')!;
    expect(composeAllergens(rca, catalog, { bread: 'bread:허니오트' }).mayContain.sort()).toEqual([...honey.allergens.mayContain].filter((a) => !rca.allergens.contains.includes(a) && !honey.allergens.contains.includes(a)).sort());
    const r = decide({ allergies: ['우유'], menus: [rca] }); // 이 메뉴 하나만 넣어 경고·감점을 봄
    const c = r.candidates.find((x) => x.menu.id === rca.id);
    expect(c?.reason_codes ?? r.rejected.find((x) => x.candidate_id === rca.id)?.reason_codes).toBeTruthy();
    if (c) expect(c.reason_codes).toContain('ALLERGEN_MAY_CONTAIN_WARNING');
    // 샐러드·랩은 기본 구성이 없어 공식 메뉴 줄 그대로
    const salad = catalog.menus.find((m) => m.kind === 'SALAD')!;
    expect(composeAllergens(salad, catalog)).toMatchObject({ contains: salad.allergens.contains, mayContain: salad.allergens.mayContain.filter((a) => !salad.allergens.contains.includes(a)) });
  });

  it('바꾼 재료의 알레르기를 더한다: 파마산 빵 → 우유, 랜치 → 난류', () => {
    const a = composeAllergens(menu('참치'), catalog, { bread: 'bread:파마산 오레가노', sauces: ['sauce:랜치'] });
    expect(a.contains).toEqual(expect.arrayContaining(['우유', '난류']));
  });

  it('공식 표에 알레르기 정보가 없는 재료(소금)를 더하면 "확인 필요"', () => {
    expect(composeAllergens(menu('참치'), catalog, { sauces: ['sauce:소금'] }).unknownParts).toEqual(['소금']);
    // 10/13 검증 ⑤: 표에 없는 재료를 "알레르기 없음"으로 치지 않는다
    expect(composeAllergens(menu('참치'), catalog, { sauces: ['sauce:없음'], toppings: ['topping_없음'] }).unknownParts).toEqual(['알 수 없는 재료(sauce:없음)', '알 수 없는 재료(topping_없음)']);
  });
});

describe('주문서', () => {
  it('기본 주문서: 15cm 위트빵·기본 야채 8종, 공식 영양·가격 그대로', () => {
    const r = buildOrderSheet(menu('로스트 치킨'), {}, catalog);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.sheet.bread).toBe('위트');
    expect(r.sheet.vegetables.kept).toHaveLength(8);
    expect(r.sheet.price.total).toBe(menu('로스트 치킨').price.price15cm);
    expect(r.sheet.nutrition.status).toBe('OFFICIAL');
    expect(r.sheet.nutrition.energyKcal).toBe(300);
    expect(r.sheet.toasted).toBe(true);
  });

  it('빵·치즈·소스를 바꾸면 공식 열량 차이만 반영하고 "추정"', () => {
    const r = buildOrderSheet(menu('로스트 치킨'), { bread: 'bread:허니오트', cheese: 'cheese:아메리칸 치즈', sauces: ['sauce:스위트 어니언'], removeVegetables: ['vegetable:양파'] }, catalog);
    if (!r.ok) throw new Error(r.errors.join());
    // 300 + (237 − 195) + 35.3 + 40.1 − 2.8 = 414.6
    expect(r.sheet.nutrition.energyKcal).toBe(414.6);
    expect(r.sheet.nutrition.status).toBe('ESTIMATE');
    expect(r.sheet.vegetables.removed).toEqual(['양파']);
  });

  it('30cm = 15cm × 2 "추정", 금액은 30cm 가격, 토핑은 30cm 가격', () => {
    const m = menu('로스트 치킨');
    const r = buildOrderSheet(m, { size: '30cm', toppings: [topping('베이컨')] }, catalog);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.sheet.nutrition.energyKcal).toBe(600);
    expect(r.sheet.nutrition.notes.join()).toContain('15cm × 2');
    expect(r.sheet.price.total).toBe(m.price.price30cm! + 3800);
  });

  it('세트 + 가격 모르는 토핑: 합계엔 아는 것만, 모르는 건 "확인 필요"', () => {
    const r = buildOrderSheet(menu('참치 아보카도 샐러드'), { toppings: [topping('미트 추가', 'SALAD')], set: '쿠키 음료 세트' }, catalog);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.sheet.price.total).toBe(menu('참치 아보카도 샐러드').price.price15cm! + 3000);
    expect(r.sheet.price.needsCheck).toEqual(['미트 추가']);
  });

  it('(10/15) 15cm·30cm 말고 다른 크기는 주문서를 만들지 않는다', () => {
    const r = buildOrderSheet(menu('로스트 치킨'), { size: '45cm' as never }, catalog);
    expect(r).toEqual({ ok: false, errors: ['UNKNOWN_SIZE'] });
  });

  it('(10/16) 세트에서 고른 쿠키·웨지·수프의 공식 영양을 더함, 칩은 정보 없음, 그 세트 것만, 치즈 웨지는 가격 확인', () => {
    const plain = buildOrderSheet(menu('로스트 치킨'), {}, catalog);
    const cookie = buildOrderSheet(menu('로스트 치킨'), { set: '쿠키 음료 세트', setItem: '초코칩' }, catalog);
    if (!plain.ok || !cookie.ok) throw new Error('sheet');
    expect(cookie.sheet.nutrition.energyKcal).toBe(Math.round((plain.sheet.nutrition.energyKcal! + 228) * 10) / 10);
    expect(cookie.sheet.nutrition.notes.some((x) => x.includes('초코칩 공식 영양을 더했어요'))).toBe(true);
    const chip = buildOrderSheet(menu('로스트 치킨'), { set: '칩 음료 세트', setItem: '칩' }, catalog);
    if (!chip.ok) throw new Error('chip');
    expect(chip.sheet.nutrition.energyKcal).toBe(plain.sheet.nutrition.energyKcal);
    expect(buildOrderSheet(menu('로스트 치킨'), { set: '쿠키 음료 세트', setItem: '콘 수프' }, catalog)).toEqual({ ok: false, errors: ['SET_ITEM_NOT_IN_SET'] });
    const cheesy = buildOrderSheet(menu('로스트 치킨'), { set: '웨지 음료 세트', setItem: 'Cheesy 웨지 포테이토' }, catalog);
    if (!cheesy.ok) throw new Error('cheesy');
    expect(cheesy.sheet.price.needsCheck).toContain('Cheesy 웨지 포테이토 세트');
  });

  it('규칙에 안 맞으면 주문서를 만들지 않는다', () => {
    const bad = (m: string, c: Parameters<typeof buildOrderSheet>[1]) => {
      const r = buildOrderSheet(menu(m), c, catalog);
      return r.ok ? [] : r.errors;
    };
    expect(bad('로스트 치킨', { sauces: ['sauce:랜치', 'sauce:마요네즈', 'sauce:핫 칠리', 'sauce:스위트 칠리'] })).toContain('TOO_MANY_SAUCES');
    expect(bad('참치 아보카도 샐러드', { bread: 'bread:허니오트' })).toContain('SALAD_ONLY_SAUCE_AND_TOPPING');
    expect(bad('쉬림프 에그마요 랩', { size: '30cm' })).toContain('SIZE_NOT_AVAILABLE');
    expect(bad('로스트 치킨', { toppings: [topping('그레인 믹스', 'SALAD')] })).toContain('TOPPING_NOT_FOR_THIS_MENU');
    expect(bad('로스트 치킨', { cheese: 'sauce:랜치' })).toContain('UNKNOWN_CHEESE');
    expect(bad('로스트 치킨', { removeVegetables: ['vegetable:아보카도'] })).toContain('NOT_A_DEFAULT_VEGETABLE');
    expect(bad('로스트 치킨', { sauces: ['sauce:랜치', 'sauce:랜치'] })).toContain('DUPLICATE_SAUCE'); // 10/13 검증 ⑤
    expect(bad('로스트 치킨', { removeVegetables: ['vegetable:양파', 'vegetable:양파'] })).toContain('DUPLICATE_VEGETABLE');
  });
});
