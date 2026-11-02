import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { buildOrderSheet } from '../../src/order-sheet/order-sheet.ts';
import { allergyMark, markLabel, sheetWarning } from '../../src/web/allergy-marks.ts';

const c = loadSubwayCatalog();
const ing = (n: string) => {
  const i = c.ingredients.find((x) => x.name === n)!;
  return { allergens: i.allergens.contains, mayContain: i.allergens.mayContain, allergenStatus: i.allergens.status };
};

describe('고른 알레르기 표시 (막지 않고 알림)', () => {
  it('알레르기를 안 골랐으면 아무 표시 없음', () => {
    expect(markLabel(allergyMark([], ing('아메리칸 치즈')))).toBe('');
  });

  it('우유 → 우유 든 치즈·소스·빵에 "우유 들어 있음", 우유 없는 재료는 표시 없음', () => {
    for (const n of ['아메리칸 치즈', '랜치', '파마산 오레가노']) expect(markLabel(allergyMark(['우유'], ing(n)))).toBe('우유 들어 있음');
    expect(markLabel(allergyMark(['우유'], ing('양상추')))).toBe('');
    expect(markLabel(allergyMark(['우유'], ing('위트')))).toBe('우유 ★'); // 공식 표: 위트빵 우유 ★
  });

  it('★ 들어 있을 수 있음은 따로, 정보 없는 재료는 "확인 필요"', () => {
    expect(markLabel(allergyMark(['우유'], { allergens: [], mayContain: ['우유'], allergenStatus: 'KNOWN' }))).toBe('우유 ★');
    expect(markLabel(allergyMark(['우유'], { allergens: [], mayContain: [], allergenStatus: 'NEEDS_CHECK' }))).toBe('알레르기 확인 필요');
  });

  it('주문서: 우유 알레르기 → 기본(위트빵 ★)은 노란 경고, 치즈를 넣으면 빨간 경고, 알레르기 안 고르면 없음', () => {
    const menu = c.menus.find((m) => m.name === '로스트 치킨')!; // 우유가 메뉴 줄에 없는 샌드위치 (10/19: 로스트 치킨 아보카도 판매 끝)
    const plain = buildOrderSheet(menu, {}, c);
    const cheese = buildOrderSheet(menu, { cheese: 'cheese:아메리칸 치즈' }, c);
    if (!plain.ok || !cheese.ok) throw new Error('order sheet');
    expect(sheetWarning(['우유'], plain.sheet.allergens)?.level).toBe('warn'); // 위트빵 우유 ★ (10/15)
    expect(sheetWarning([], cheese.sheet.allergens)).toBeNull();
    expect(sheetWarning(['우유'], cheese.sheet.allergens)).toEqual({ level: 'bad', text: '⚠ 고른 알레르기 우유가 들어 있어요. 메뉴나 재료를 바꿔 주세요' });
  });

  it('주문서: ★만 있으면 노란 경고 (받침 있으면 "이")', () => {
    expect(sheetWarning(['대두'], { contains: [], mayContain: ['대두'] })?.level).toBe('warn');
    expect(sheetWarning(['밀'], { contains: ['밀'], mayContain: [] })?.text).toContain('밀이 들어 있어요');
  });
});
