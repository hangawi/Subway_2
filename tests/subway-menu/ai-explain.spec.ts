import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { aiExplain } from '../../src/subway-menu/ai-explain.ts';

// Top3 AI 한마디 (10/21): 값에 없는 숫자·장담하는 말은 버림, 늦으면 없이, 같은 요청은 다시 안 물음
const c = loadSubwayCatalog();
const salad = c.menus.find((m) => m.name === '스테이크 & 머쉬룸 샐러드')!;
const beef = c.menus.find((m) => m.name === '안창 비프')!;
const egg = c.menus.find((m) => m.name === '에그마요')!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fake = (lines: Array<{ id: string; text: string }>, delay = 0) => {
  let calls = 0;
  return {
    calls: () => calls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    route: async (req: any) => {
      calls++;
      expect(req.task).toBe('explanation');
      expect(req.input).toContain('가볍게');
      await new Promise((r) => setTimeout(r, delay));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { code: 'SUCCESS', output: { lines } } as any;
    },
  };
};

describe('Top3 AI 한마디', () => {
  it('값 안의 숫자는 남기고, 지어낸 숫자·장담하는 말은 버림', async () => {
    const ai = fake([
      { id: salad.id, text: `소고기를 원하시면서 가볍게 드시기 좋아요. ${salad.nutrition15cm!.energyKcal}kcal예요` },
      { id: beef.id, text: '단백질이 45g이나 들어 있어 든든해요' },
      { id: egg.id, text: '건강에 좋고 다이어트 효과가 있어요' },
    ]);
    const out = await aiExplain(ai, c, [salad.id, beef.id, egg.id], { goal: 'LIGHT', wantMains: ['쇠고기'] });
    expect(Object.keys(out)).toEqual([salad.id]);
    expect(out[salad.id]).toContain(`${salad.nutrition15cm!.energyKcal}kcal`);
  });
  it('그 메뉴에 없는 메인 재료·알레르기를 말하면 버림 (10/21: 머쉬룸에 "쇠고기와 버섯")', async () => {
    const mush = c.menus.find((m) => m.name === '머쉬룸')!;
    const ai = fake([{ id: mush.id, text: '쇠고기와 버섯의 조합으로 가볍게 즐기기 좋아요' }, { id: salad.id, text: '알레르기 걱정 적은 가벼운 샐러드예요' }]);
    expect(await aiExplain(ai, c, [mush.id, salad.id], { goal: 'LIGHT', wantMains: ['쇠고기'], maxSodiumMg: 900 })).toEqual({});
  });
  it('11/02: 추천 메뉴를 깎는 말은 버림 ("포화지방이 상대적으로 높아 덜 적합해요")', async () => {
    const ai = fake([{ id: beef.id, text: '가볍게 드시기에는 열량이 상대적으로 높아 덜 적합해요' }, { id: egg.id, text: '가볍게 원하시면 아쉬운 선택이에요' }]);
    expect(await aiExplain(ai, c, [beef.id, egg.id], { goal: 'LIGHT', lowFat: true })).toEqual({});
  });
  it('말한 조건과 반대되는 말은 버림 (가볍게인데 "든든하게")', async () => {
    const ai = fake([{ id: beef.id, text: '단백질이 들어있는 쇠고기 샌드위치로 든든하게 즐겨보세요' }]);
    expect(await aiExplain(ai, c, [beef.id], { goal: 'LIGHT', wantMains: ['쇠고기'], salty: 'LESS' })).toEqual({});
  });
  it('같은 요청은 저장해 둔 답 (AI 다시 안 부름)', async () => {
    const ai = fake([{ id: beef.id, text: '소고기 메뉴 중에서 가볍게 먹기 좋은 편이에요' }]);
    const a = await aiExplain(ai, c, [beef.id], { goal: 'LIGHT', budgetKrw: 12000 });
    const b = await aiExplain(ai, c, [beef.id], { goal: 'LIGHT', budgetKrw: 12000 });
    expect(a).toEqual(b);
    expect(ai.calls()).toBe(1);
  });
  it('늦으면 설명 없이', async () => {
    const ai = fake([{ id: egg.id, text: '가볍게 먹기 좋은 메뉴예요' }], 300);
    expect(await aiExplain(ai, c, [egg.id], { goal: 'LIGHT', kinds: ['SANDWICH'] }, 50)).toEqual({});
  });
});
