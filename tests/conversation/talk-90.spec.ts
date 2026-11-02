import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { interpret } from '../../src/conversation/interpret.ts';
import { CASES, judge, needsSecondPass } from '../../scripts/talk-cases.ts';

// 말로 주문하기 정답 표 90문장 (10/19, 로드맵 7.6-2) — 규칙만(AI 없이). AI가 있어야 되는 문장은 실제 주소 점검(scripts/talk-check.ts)에서 본다
const c = loadSubwayCatalog();
const nameOf = (id: string | null) => (id ? (c.menus.find((m) => m.id === id)?.name ?? id) : null);
const ing = (id: string) => c.ingredients.find((x) => x.id === id)?.name ?? c.singles?.find((x) => x.id === id)?.name ?? id;
const sample = c.menus.find((m) => m.name === '로스트 치킨')!.id;
// AI가 있어야 알아듣는 문장 (규칙에 없는 말투) — 규칙만 시험에서는 뺀다
const NEEDS_AI = new Set<string>(AI_ONLY());
function AI_ONLY(): string[] {
  return [];
}

describe('말로 주문하기 90문장 (규칙만)', () => {
  it('90문장 이상 (10/19 단품·없는 음식 20개 더함)', () => expect(CASES.length).toBeGreaterThanOrEqual(110));
  for (const [text, want] of CASES) {
    if (NEEDS_AI.has(text)) continue;
    it(text, async () => {
      const r = await interpret(text, c, {}, null);
      let ch = r.choices ?? {};
      if (needsSecondPass({ ...r, ask: r.intent.ask })) ch = (await interpret(text, c, { menuId: sample, prefs: r.prefs }, null)).choices ?? {};
      expect(judge(text, want, { ...r, ask: r.intent.ask }, ch, nameOf, ing)).toEqual([]);
    });
  }
});
