import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';

// 점검 4: 상식 검사 — 공식 데이터라면 당연히 맞아야 하는 것들.
const catalog = loadSubwayCatalog();
const menu = (name: string) => catalog.menus.find((m) => m.name === name)!;

describe('써브웨이 공식 카탈로그', () => {
  // 10/19: 공식 홈페이지에서 빠진 메뉴 3개·토핑 3개는 data/입력표/판매끝.csv 로 뺌 (67 → 64, 26 → 23)
  it('공식 홈페이지 개수와 같다 (메뉴 64, 추가 토핑 23, 재료 33 — 판매 끝난 것 뺌)', () => {
    const kind = (k: string) => catalog.menus.filter((m) => m.kind === k).length;
    expect(catalog.menus).toHaveLength(64);
    expect([kind('SANDWICH'), kind('SALAD'), kind('GRAIN_SALAD'), kind('WRAP'), kind('SIDE')]).toEqual([22, 11, 10, 3, 14]);
    expect(catalog.menus.filter((m) => m.kind.startsWith('MORNING'))).toHaveLength(4);
    expect(catalog.toppings).toHaveLength(23);
    for (const n of ['로스트 치킨 아보카도', '아기맹새우', '에그 슬라이스']) expect(catalog.menus.map((m) => m.name)).not.toContain(n);
    expect(catalog.toppings.map((t) => t.name)).not.toContain('에그 슬라이스');
    const by = (c: string) => catalog.ingredients.filter((i) => i.category === c).length;
    expect([by('BREAD'), by('VEGETABLE'), by('CHEESE'), by('SAUCE')]).toEqual([6, 9, 3, 15]);
  });

  it('시험용 가짜 값이 들어 있지 않다', () => {
    const text = JSON.stringify(catalog);
    expect(text).not.toMatch(/TEST_FIXTURE|MVP_TEST_DATA|ESTIMATED/);
  });

  it('ID가 겹치지 않는다', () => {
    const ids = [...catalog.menus, ...catalog.toppings, ...catalog.ingredients, ...catalog.mains].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('식사 메뉴는 모두 공식 영양값이 있고, 숫자가 말이 된다', () => {
    for (const m of catalog.menus.filter((x) => x.kind !== 'SIDE')) {
      const n = m.nutrition15cm!;
      expect(n, m.name).not.toBeNull();
      for (const v of [n.weightG, n.energyKcal, n.proteinG, n.saturatedFatG, n.sugarG, n.sodiumMg]) {
        expect(v, m.name).not.toBeNull();
        expect(v!, m.name).toBeGreaterThanOrEqual(0);
      }
      // 열량은 중량 1g당 9kcal(지방만 있을 때)를 넘을 수 없다.
      expect(n.energyKcal!, m.name).toBeLessThanOrEqual(n.weightG! * 9);
      // 단백질 1g = 4kcal: 단백질 열량이 전체 열량을 넘을 수 없다.
      expect(n.proteinG! * 4, m.name).toBeLessThanOrEqual(n.energyKcal!);
      // 단백질·당류·포화지방 무게 합이 전체 중량을 넘을 수 없다.
      expect(n.proteinG! + n.sugarG! + n.saturatedFatG!, m.name).toBeLessThan(n.weightG!);
    }
  });

  it('공식 페이지에서 본 값과 같다 (표본)', () => {
    expect(menu('스테이크 & 치즈').nutrition15cm).toMatchObject({ weightG: 245, energyKcal: 355, proteinG: 28.1, sodiumMg: 780 });
    expect(menu('안창 비프&머쉬룸').nutrition15cm?.weightG).toBe(235);
    expect(menu('그린 샐러드').nutrition15cm?.energyKcal).toBe(91.8);
  });

  it('새우가 들어간 메뉴는 새우 "포함"이다', () => {
    for (const m of catalog.menus.filter((x) => /쉬림프|새우/.test(x.name)))
      expect(m.allergens.contains, m.name).toContain('새우');
  });

  it('빵은 모두 밀 "포함", 치즈는 모두 우유 "포함"이다', () => {
    for (const i of catalog.ingredients.filter((x) => x.category === 'BREAD')) expect(i.allergens.contains, i.name).toContain('밀');
    for (const i of catalog.ingredients.filter((x) => x.category === 'CHEESE')) expect(i.allergens.contains, i.name).toContain('우유');
  });

  it('빵이 들어간 샌드위치는 밀 "포함"이다', () => {
    for (const m of catalog.menus.filter((x) => x.kind === 'SANDWICH' || x.kind === 'MORNING_SANDWICH'))
      expect(m.allergens.contains, m.name).toContain('밀');
  });

  it('닭·소·돼지 메뉴는 그 고기를 "포함"한다', () => {
    expect(menu('로스트 치킨').allergens.contains).toContain('닭고기');
    expect(menu('안창 비프').allergens.contains).toContain('쇠고기');
    expect(menu('비엘티').allergens.contains).toContain('돼지고기');
    expect(menu('잠봉').allergens.contains).toContain('돼지고기');
  });

  it('포함과 포함 가능성이 한 메뉴에서 겹치지 않는다', () => {
    for (const m of catalog.menus) expect(m.allergens.contains.filter((a) => m.allergens.mayContain.includes(a)), m.name).toEqual([]);
  });

  it('그레인 샐러드는 알레르기 표의 (G) 줄, 일반 샐러드는 (G) 없는 줄을 쓴다', () => {
    for (const m of catalog.menus.filter((x) => x.kind === 'GRAIN_SALAD')) expect(m.allergens.rows.every((r) => r.endsWith('(G)')), m.name).toBe(true);
    for (const m of catalog.menus.filter((x) => x.kind === 'SALAD' && x.allergens.status === 'KNOWN')) expect(m.allergens.rows.some((r) => r.endsWith('(G)')), m.name).toBe(false);
    expect(menu('그린 그레인 샐러드').price.price15cm).toBe(8600);
    expect(menu('치킨 베이컨 미니 랩').price.price15cm).toBe(3900);
  });

  it('같은 이름의 메뉴가 두 번 들어가지 않는다 (사이드 목록의 미니 랩)', () => {
    const names = catalog.menus.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('알레르기 정보가 없는 것은 "확인 필요"로 표시돼 있다 (지어내지 않음)', () => {
    expect(menu('미니 로티세리 치킨 샐러드').allergens.status).toBe('UNKNOWN');
    const unknown = catalog.ingredients.filter((i) => i.allergens.status === 'UNKNOWN').map((i) => i.name);
    expect(unknown.sort()).toEqual(['소금', '피클', '후추'].sort());
  });

  it('메뉴 64개 모두 공식 주문 시스템 가격이 있고, 30cm는 15cm보다 비싸다', () => {
    for (const m of catalog.menus) {
      expect(m.price.status, m.name).toBe('KNOWN');
      expect(m.price.price15cm!, m.name).toBeGreaterThan(1000);
      expect(m.price.checkedWhere, m.name).toMatch(/공식 주문 API/);
      if (m.price.price30cm !== null) {
        expect(m.price.price30cm, m.name).toBeGreaterThan(m.price.price15cm!);
        expect(m.price.price30cm, m.name).toBeLessThan(m.price.price15cm! * 2);
      }
    }
  });

  it('가격이 2026년 5월 인상 기사와 같다 (다른 출처 대조)', () => {
    // 뉴시스·아시아경제 2026-04-30: 에그마요 5,900→6,200원, 이탈리안 BMT 7,200→7,500원 (15cm)
    expect(menu('에그마요').price.price15cm).toBe(6200);
    expect(menu('이탈리안 비엠티').price.price15cm).toBe(7500);
  });

  it('추가 토핑 가격: 21개는 배민 캡처 값, 샐러드·그레인 샐러드 미트 추가만 확인 필요', () => {
    const known = catalog.toppings.filter((t) => t.price.status === 'KNOWN');
    expect(known).toHaveLength(21);
    for (const t of known) expect(t.price.checkedWhere, t.name).toMatch(/배달의민족/);
    expect(catalog.toppings.filter((t) => t.price.status !== 'KNOWN').map((t) => `${t.appliesTo}/${t.name}`)).toEqual(['SALAD/미트 추가', 'GRAIN_SALAD/미트 추가']);
  });

  it('샌드위치 추가 토핑의 30cm 가격은 15cm의 정확히 2배 (캡처 값)', () => {
    for (const t of catalog.toppings.filter((x) => x.appliesTo === 'SANDWICH'))
      expect(t.price.price30cm, t.name).toBe(t.price.price15cm! * 2);
    const top = (n: string) => catalog.toppings.find((t) => t.appliesTo === 'SANDWICH' && t.name === n)!.price.price15cm;
    expect([top('미트 추가'), top('에그마요'), top('베이컨'), top('아보카도')]).toEqual([3500, 2500, 1900, 1800]);
  });

  it('세트 5종의 추가 가격이 있다 (10/19 "음료 콤보" 생김)', () => {
    expect(catalog.sets.map((s) => [s.name, s.addPrice])).toEqual([
      ['음료 콤보', 1500],
      ['쿠키 음료 세트', 3000],
      ['웨지 음료 세트', 3500],
      ['칩 음료 세트', 3000],
      ['수프 음료 세트', 3900],
    ]);
  });
});
