import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { kakaoRouteLink, orderText, telLink } from '../../src/order-sheet/handoff.ts';
import { buildOrderSheet, buildSinglesSheet } from '../../src/order-sheet/order-sheet.ts';

const c = loadSubwayCatalog();
const menu = (n: string) => c.menus.find((m) => m.name === n)!;
const store = { name: '써브웨이 강남역점', phone: '02-555-1234', lat: 37.499, lng: 127.028 };

describe('주문서 넘겨주기', () => {
  it('주문서 글: 메뉴·크기·빵·치즈·야채·소스·토핑·세트·참고 금액', () => {
    const r = buildOrderSheet(menu('로스트 치킨'), {
      size: '30cm', bread: 'bread:허니오트', cheese: 'cheese:아메리칸 치즈', removeVegetables: ['vegetable:양파'], addVegetables: ['vegetable:피클'],
      sauces: ['sauce:랜치'], toppings: [c.toppings.find((t) => t.name === '베이컨' && t.appliesTo === 'SANDWICH')!.id], set: '쿠키 음료 세트', toasted: false,
    }, c);
    if (!r.ok) throw new Error(r.errors.join());
    const t = orderText(r.sheet, store);
    expect(t).toContain('[써브웨이 주문서] 써브웨이 강남역점');
    expect(t).toContain('로스트 치킨 30cm');
    expect(t).toContain('빵: 허니오트 (토스팅 안 함)');
    expect(t).toContain('치즈: 아메리칸 치즈');
    expect(t).toContain('야채 빼기: 양파');
    expect(t).toContain('야채 많이: 피클');
    expect(t).toContain('소스: 랜치');
    expect(t).toContain('추가 토핑: 베이컨');
    expect(t).toContain('세트: 쿠키 음료 세트');
    expect(t).toMatch(/참고 금액: [\d,]+원 — 매장에서 다를 수 있어요/);
  });

  it('가격 모르는 토핑은 금액 옆에 "매장 확인"', () => {
    const r = buildOrderSheet(menu('참치 아보카도 샐러드'), { toppings: [c.toppings.find((t) => t.name === '미트 추가' && t.appliesTo === 'SALAD')!.id] }, c);
    if (!r.ok) throw new Error(r.errors.join());
    expect(orderText(r.sheet, null)).toContain('(미트 추가 가격 매장 확인)');
    expect(orderText(r.sheet, null)).not.toContain('빵:'); // 샐러드는 빵 줄 없음
  });

  it('(10/15) 이름에 치즈가 든 메뉴는 "치즈: 없음" 대신 "메뉴 기본 치즈", 고른 알레르기는 매장에 알리는 줄', () => {
    const r = buildOrderSheet(menu('스테이크 & 치즈'), {}, c);
    if (!r.ok) throw new Error(r.errors.join());
    expect(orderText(r.sheet, null)).toContain('치즈: 메뉴 기본 치즈');
    expect(orderText(r.sheet, null)).not.toContain('알레르기가 있어요');
    expect(orderText(r.sheet, null, ['우유', '대두'])).toContain('※ 우유, 대두 알레르기가 있어요. 재료 확인 부탁드려요');
    const plain = buildOrderSheet(menu('로스트 치킨'), {}, c);
    if (!plain.ok) throw new Error(plain.errors.join());
    expect(orderText(plain.sheet, null)).toContain('치즈: 없음');
  });

  it('(10/16) 세트 음료는 주문서 글에 "매장에서 확인"과 함께', () => {
    const r = buildOrderSheet(menu('로스트 치킨'), { set: '쿠키 음료 세트', drink: '제로콜라' }, c);
    if (!r.ok) throw new Error(r.errors.join());
    expect(orderText(r.sheet, null)).toContain('세트: 쿠키 음료 세트 (음료: 제로콜라 (16oz) — 매장에서 확인)');
    const cookie = buildOrderSheet(menu('로스트 치킨'), { set: '쿠키 음료 세트', setItem: '초코칩', drink: '제로콜라' }, c);
    if (!cookie.ok) throw new Error(cookie.errors.join());
    expect(orderText(cookie.sheet, null)).toContain('세트: 쿠키 음료 세트 (초코칩, 음료: 제로콜라 (16oz) — 매장에서 확인)');
  });

  it('전화 링크: 번호가 없거나 이상하면 없음(버튼 숨김)', () => {
    expect(telLink('02-555-1234')).toBe('tel:025551234');
    expect(telLink(null)).toBeNull();
    expect(telLink('없음')).toBeNull();
  });

  it('카카오맵 길찾기 링크', () => {
    expect(kakaoRouteLink(store)).toBe('https://map.kakao.com/link/to/%EC%8D%A8%EB%B8%8C%EC%9B%A8%EC%9D%B4%20%EA%B0%95%EB%82%A8%EC%97%AD%EC%A0%90,37.499,127.028');
  });
});

describe('(10/19) 단품', () => {
  const c = loadSubwayCatalog();
  const cola = c.singles!.find((x) => x.name === '코카콜라 (355ml)')!;
  const cookie = c.singles!.find((x) => x.name === '초코칩 쿠키')!;
  it('샌드위치 없이 단품만: 금액·영양·알레르기, 주문서 글에 메뉴 줄 없음', () => {
    const r = buildSinglesSheet({ extras: [{ id: cola.id, qty: 2 }, { id: cookie.id, qty: 1 }] }, c);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.sheet.price.total).toBe(cola.price * 2 + cookie.price);
    expect(r.sheet.nutrition.energyKcal).toBe(cookie.nutrition!.energyKcal);
    expect(r.sheet.allergens.contains).toEqual(expect.arrayContaining(cookie.allergens.contains));
    const t = orderText(r.sheet, null);
    expect(t).toContain('코카콜라 (355ml) 2개, 초코칩 쿠키');
    expect(t).not.toContain('소스');
    expect(buildSinglesSheet({ extras: [] }, c).ok).toBe(false);
    expect(buildSinglesSheet({ extras: [{ id: 'single_없음', qty: 1 }] }, c).ok).toBe(false);
    expect(buildSinglesSheet({ extras: [{ id: cola.id, qty: 21 }] }, c).ok).toBe(false);
  });
  it('샌드위치 + 단품: 합계에 더하고 주문서 글에 "단품 추가"', () => {
    const menu = c.menus.find((m) => m.name === '로스트 치킨')!;
    const r = buildOrderSheet(menu, { extras: [{ id: cola.id, qty: 1 }] }, c);
    if (!r.ok) throw new Error(r.errors.join());
    expect(r.sheet.price.total).toBe(menu.price.price15cm! + cola.price);
    expect(orderText(r.sheet, null)).toContain('단품 추가: 코카콜라 (355ml)');
  });
  it('아침 샌드위치 기본 야채 (공식 안내): 잠봉 = 없음, 웨스턴 = 토마토·피망·양파', () => {
    const jambon = c.menus.find((m) => m.name === '잠봉, 에그&치즈')!;
    const western = c.menus.find((m) => m.name === '웨스턴, 에그 & 치즈')!;
    const a = buildOrderSheet(jambon, {}, c);
    const b = buildOrderSheet(western, {}, c);
    if (!a.ok || !b.ok) throw new Error('sheet');
    expect(a.sheet.vegetables.kept).toEqual([]);
    expect(b.sheet.vegetables.kept).toEqual(['토마토', '피망(파프리카)', '양파']);
    expect(buildOrderSheet(jambon, { addVegetables: ['vegetable:오이'] }, c).ok).toBe(false);
  });
});
