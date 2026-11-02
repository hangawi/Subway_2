import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { interpret, type AiRoute } from '../../src/conversation/interpret.ts';
import { validateIntent } from '../../src/conversation/intent-schema.ts';
import { parseRules, parseWon } from '../../src/conversation/rules.ts';
import type { AiResult } from '../../vendor/sophia/packages/contracts/src/ai-contract.ts';

const c = loadSubwayCatalog();
const id = (name: string) => c.menus.find((m) => m.name === name)!.id;
const ROAST = id('로스트 치킨');

// 조건 말하기 정답 표 (로드맵 25번, 10/14 2-2: 예시 30개)
const TABLE: Array<[string, (r: ReturnType<typeof parseRules>) => unknown, unknown]> = [
  ['만 원 이하, 단백질 많이', (r) => [r.intent.conditions.budgetKrw, r.intent.conditions.goal], [10000, 'PROTEIN']],
  ['8천원 이하', (r) => r.intent.conditions.budgetKrw, 8000],
  ['1만5천원까지', (r) => r.intent.conditions.budgetKrw, 15000],
  ['9000원 이내', (r) => r.intent.conditions.budgetKrw, 9000],
  ['살 안 찌는 거', (r) => r.intent.conditions.goal, 'LIGHT'],
  ['다이어트 중이야', (r) => r.intent.conditions.goal, 'LIGHT'],
  ['매운 거 빼고', (r) => r.intent.conditions.avoidSpicy, true],
  ['가까운 데', (r) => r.intent.conditions.nearby, true],
  ['새우 알레르기 있어요', (r) => r.intent.conditions.allergies, ['새우']],
  ['새우 빼고', (r) => [r.intent.conditions.allergies, r.intent.menu], [['새우'], undefined]],
  ['계란 못 먹어', (r) => r.intent.conditions.allergies, ['난류']],
  ['갑각류 알레르기', (r) => r.intent.conditions.allergies, ['게', '새우']],
  ['나트륨 600 이하', (r) => [r.intent.conditions.maxSodiumMg, r.intent.conditions.budgetKrw], [600, undefined]],
  ['짜지 않게', (r) => r.intent.conditions.maxSodiumMg, 700],
  ['500칼로리 이하 샐러드', (r) => [r.intent.conditions.maxEnergyKcal, r.intent.conditions.kinds], [500, ['SALAD', 'GRAIN_SALAD']]],
  ['그레인 샐러드 8천원 이하', (r) => [r.intent.conditions.kinds, r.intent.options.bread], [['GRAIN_SALAD'], undefined]],
  ['아침 메뉴', (r) => r.intent.conditions.kinds, ['MORNING_SANDWICH', 'MORNING_WRAP']],
  ['로티 30cm 허니오트로', (r) => [r.intent.menu, r.intent.options.size, r.intent.options.bread], [id('로티세리 바비큐 치킨'), '30cm', 'bread:허니오트']],
  ['스테이크 앤 치즈', (r) => r.intent.menu, id('스테이크 & 치즈')],
  ['bmt 할라피뇨 빼', (r) => [r.intent.menu, r.intent.options.removeVegetables], [id('이탈리안 비엠티'), ['vegetable:할라피뇨']]],
  ['빵은 위트로, 소스 빼 줘', (r) => [r.intent.options.bread, r.intent.options.sauces], ['bread:위트', []]],
  ['양파 빼고 피클 많이', (r) => [r.intent.options.removeVegetables, r.intent.options.addVegetables], [['vegetable:양파'], ['vegetable:피클']]],
  ['스윗어니언이랑 랜치', (r) => r.intent.options.sauces, ['sauce:스위트 어니언', 'sauce:랜치']],
  ['올리브 오일', (r) => [r.intent.options.sauces, r.intent.options.addVegetables], [['sauce:엑스트라 버진 올리브 오일'], undefined]],
  ['치즈 빼', (r) => r.intent.options.cheese, null],
  ['모짜렐라 치즈로', (r) => r.intent.options.cheese, 'cheese:모차렐라 치즈'],
  ['에그마요 추가', (r) => [r.intent.menu, r.intent.options.toppings], [undefined, ['topping-name:에그마요']]],
  ['에그마요 주세요', (r) => r.intent.menu, id('에그마요')],
  ['쿠키 세트로', (r) => r.intent.options.set, '쿠키 음료 세트'],
  ['1번이랑 2번 비교', (r) => [r.intent.ask, r.intent.compare], ['COMPARE', [1, 2]]],
];

describe('조건 말하기 30문장 (규칙, AI 없음)', () => {
  it('정답 표가 30개', () => expect(TABLE).toHaveLength(30));
  for (const [text, pick, want] of TABLE) it(text, () => expect(pick(parseRules(text, c))).toEqual(want));

  it('돈 읽기', () => {
    expect(parseWon('만원')).toBe(10000);
    expect(parseWon('1만5천원')).toBe(15000);
    expect(parseWon('8천원')).toBe(8000);
    expect(parseWon('7,500원')).toBe(7500);
  });

  it('애매하면 질문 하나만', () => {
    expect(parseRules('빵 바꿔줘', c).question).toContain('빵은 어떤 걸로');
    expect(parseRules('세트로 해줘', c).question).toContain('세트는 어떤 걸로');
  });
});

describe('(10/15 점검) 한 글자 알레르기 말이 다른 낱말에 걸리지 않음', () => {
  const c = loadSubwayCatalog();
  it('"맵게 못 먹어"·"짜게 안 먹어요"·"달게 안 먹어"·"시원하게 빼줘"는 게(꽃게) 알레르기가 아님', () => {
    for (const t of ['맵게 못 먹어', '짜게 안 먹어요', '달게 안 먹어', '시원하게 빼줘', '맛있게 없는 거']) expect(parseRules(t, c).intent.conditions.allergies).toBeUndefined();
  });
  it('"맵게 못 먹어" → 매운 것 빼기, "짜게 안 먹어요" → 짜지 않게', () => {
    expect(parseRules('맵게 못 먹어', c).intent.conditions.avoidSpicy).toBe(true);
    expect(parseRules('짜게 안 먹어요', c).intent.conditions.maxSodiumMg).toBe(700);
  });
  it('따로 말한 한 글자는 그대로 알레르기: 게·콩·밀·잣·닭', () => {
    expect(parseRules('저 게 알레르기 있어요', c).intent.conditions.allergies).toEqual(['게']);
    expect(parseRules('콩 못 먹어', c).intent.conditions.allergies).toEqual(['대두']);
    expect(parseRules('밀 알레르기', c).intent.conditions.allergies).toEqual(['밀']);
    expect(parseRules('잣 알레르기', c).intent.conditions.allergies).toEqual(['잣']);
    // 10/19: 고기 "빼고"는 알레르기가 아니라 그 메뉴 빼기
    expect(parseRules('닭 못 먹어', c).intent.conditions.allergies).toEqual(['닭고기']);
    expect(parseRules('닭 빼고', c).intent.conditions.avoidMains).toEqual(['닭고기']);
    expect(parseRules('땅콩 알레르기', c).intent.conditions.allergies).toEqual(['땅콩']);
  });
});

describe('해석 → 엔진 조건·주문서', () => {
  it('안 되는 수정은 거절하고 앞 선택 그대로: 샐러드는 빵을 못 고름', async () => {
    const r = await interpret('빵은 허니오트로', c, { menuId: id('참치 아보카도 샐러드'), choices: { sauces: ['sauce:랜치'] } });
    expect(r.refusals).toContain('샐러드는 빵·치즈·야채를 바꿀 수 없어요 (소스·토핑만 바꿀 수 있어요)');
    expect(r.choices).toEqual({ sauces: ['sauce:랜치'] });
  });

  it('이어지는 대화: "아까 거기서 소스만 바꿔" → 앞 메뉴·선택에 소스만 바뀜', async () => {
    const r = await interpret('아까 거기서 소스만 스위트 칠리로 바꿔', c, { menuId: ROAST, choices: { bread: 'bread:위트', sauces: ['sauce:랜치'] } });
    expect(r.menuId).toBe(ROAST);
    expect(r.choices).toEqual({ bread: 'bread:위트', sauces: ['sauce:스위트 칠리'] });
  });

  it('앞 대화 조건은 이어지고 이번 말이 더해짐', async () => {
    const r = await interpret('새우 알레르기도 있어', c, { prefs: { budgetKrw: 10000, allergies: ['난류'] } });
    expect(r.prefs).toMatchObject({ budgetKrw: 10000, allergies: ['난류', '새우'] });
  });

  it('매운 거 빼고 → 엔진은 스파이시 메뉴를 빼고, 주문서는 할라피뇨를 뺌', async () => {
    const r = await interpret('매운 거 빼고 로스트 치킨', c);
    expect(r.prefs.avoidSpicy).toBe(true);
    expect(r.choices?.removeVegetables).toContain('vegetable:할라피뇨');
  });

  it('메뉴 없이 옵션만 말하면 먼저 메뉴를 고르라고', async () => {
    expect((await interpret('소스 빼 줘', c)).refusals).toContain('먼저 메뉴를 골라 주세요. 그다음 빵·소스를 바꿀 수 있어요');
  });

  it('배달·결제는 거절', async () => {
    expect((await interpret('배달해줘', c)).refusals[0]).toContain('배달·결제');
  });
});

const fakeAi = (output: unknown, code: AiResult['code'] = 'SUCCESS'): AiRoute & { calls: number } => {
  const f = {
    calls: 0,
    async route() {
      f.calls++;
      return { code, output, provider_id: 'fake', execution_location: 'external', model: 'fake', model_version: null, refusal: null, usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, request_bytes: 0, response_bytes: 0 }, message: '', request_id: 'r', attempts: 1, queued_ms: 0, run_ms: 0, fallback_from: null } as AiResult;
    },
  };
  return f;
};

describe('AI (값만 옮김)', () => {
  it('규칙이 알아들으면 AI를 부르지 않는다 (같은 말 같은 결과)', async () => {
    const ai = fakeAi({ conditions: { budgetKrw: 99999 } });
    const r = await interpret('만 원 이하', c, {}, ai);
    expect(ai.calls).toBe(0);
    expect(r.prefs.budgetKrw).toBe(10000);
  });

  it('규칙이 못 알아들으면 AI 값을 검사해서 씀, 목록 밖 값은 버림', async () => {
    const ai = fakeAi({ conditions: { goal: 'LIGHT', allergies: ['외계인', '우유'] }, options: { bread: 'bread:없는빵' }, menu: 'menu_없음' });
    const r = await interpret('오늘은 좀 산뜻하게 먹고 싶네', c, {}, ai);
    expect(ai.calls).toBe(1);
    expect(r.source).toBe('RULES+AI');
    expect(r.prefs.goal).toBe('LIGHT');
    expect(r.prefs.allergies).toEqual([]); // 말에 알레르기 근거가 없으면 AI 알레르기는 안 받음 (10/17)
    expect(r.menuId).toBeNull();
  });

  it('(10/17) AI가 취향을 알레르기·소스 빼기로 지어내지 않음 — 말에 근거가 있을 때만', async () => {
    const ai = fakeAi({ conditions: { allergies: ['닭고기'] }, options: { sauces: [] } });
    const r = await interpret('나 원래 치킨 안 좋아해', c, {}, ai);
    expect(r.prefs.allergies).toEqual([]);
    expect(r.understood).not.toContain('닭고기 알레르기');
    expect(r.understood).not.toContain('소스 빼기');
    expect(r.tastes).toEqual([{ main: '닭고기', sign: -1, scope: 'LASTING' }]);
    const r2 = await interpret('땅콩 먹으면 두드러기 나', c, {}, fakeAi({ conditions: { allergies: ['땅콩'] } }));
    expect(r2.prefs.allergies).toEqual(['땅콩']);
  });

  it('(10/16) 규칙이 일부만 읽으면 남은 말만 AI가 보탬 — 규칙 값이 우선, 보탠 것도 "이렇게 이해했어요"에', async () => {
    const ai = fakeAi({ conditions: { budgetKrw: 99999, goal: 'PROTEIN' } });
    const r = await interpret('만원 이하 힘이 펄펄 솟게', c, {}, ai);
    expect(ai.calls).toBe(1);
    expect(r.prefs.budgetKrw).toBe(10000); // 규칙이 읽은 값 그대로
    expect(r.prefs.goal).toBe('PROTEIN'); // AI가 보탬
    expect(r.understood).toEqual(['예산 10,000원 이하', '단백질 많은 쪽']);
  });

  it('(10/16) 다 알아들었으면(남은 말 없음) AI를 부르지 않음', async () => {
    const ai = fakeAi({ conditions: { goal: 'LIGHT' } });
    const r = await interpret('만 삼천원 이하 매운거 넣어서', c, {}, ai);
    expect(ai.calls).toBe(0);
    expect([r.prefs.budgetKrw, r.prefs.wantSpicy, r.prefs.avoidSpicy]).toEqual([13000, true, undefined]);
  });

  it('(10/16) AI만 알아들어도 화면에 무엇을 알아들었는지 보임 (전엔 "잘 못 알아들었어요")', async () => {
    const r = await interpret('오늘은 좀 산뜻하게 먹고 싶네', c, {}, fakeAi({ conditions: { goal: 'LIGHT' } }));
    expect(r.understood).toEqual(['가벼운 쪽 (열량 낮게)']);
  });

  it('(10/16) 매운 것: 규칙이 "넣기"로 읽었으면 AI가 "빼기"라 해도 넣기, 규칙이 방향을 물었는데 AI가 알면 묻지 않음', async () => {
    const r1 = await interpret('매콤하게 든든한 걸로', c, {}, fakeAi({ conditions: { avoidSpicy: true } }));
    expect([r1.prefs.wantSpicy, r1.prefs.avoidSpicy]).toEqual([true, undefined]);
    const r2 = await interpret('매운 거 땡기는데 어떡하지', c, {}, fakeAi({ conditions: { wantSpicy: true } }));
    expect(r2.prefs.wantSpicy).toBe(true);
    expect(r2.question).toBeNull();
  });

  it('(10/16) 매운 것 넣기: 샌드위치는 할라피뇨 더 + 핫 칠리, 샐러드는 핫 칠리만, 다음 말 "빼"면 넣기는 꺼짐', async () => {
    const s = await interpret('매운 거 넣어서 로스트 치킨', c);
    expect(s.choices).toMatchObject({ addVegetables: ['vegetable:할라피뇨'], sauces: ['sauce:핫 칠리'] });
    const salad = await interpret('매콤하게 참치 아보카도 샐러드', c);
    expect(salad.choices?.addVegetables).toBeUndefined();
    expect(salad.choices?.sauces).toEqual(['sauce:핫 칠리']);
    const next = await interpret('아니 매운 거 빼줘', c, { prefs: s.prefs });
    expect([next.prefs.avoidSpicy, next.prefs.wantSpicy]).toEqual([true, undefined]);
  });

  it('(10/16) AI가 말에 없는 메뉴를 고르면 안 씀 ("에그마오"에 엉뚱한 랩) — 규칙이 오타로 바른 메뉴를 찾음', async () => {
    const wrap = c.menus.find((m) => m.name === '잠봉, 에그 & 치즈 랩')!.id;
    const r1 = await interpret('오늘 점심 뭐 먹지 힘 나는 걸로', c, {}, fakeAi({ menu: wrap, conditions: { goal: 'PROTEIN' } }));
    expect(r1.menuId).toBeNull();
    expect(r1.prefs.goal).toBe('PROTEIN');
    const r2 = await interpret('에그마오 주세요', c, {}, fakeAi({ menu: wrap }));
    expect(r2.menuId).toBe(id('에그마요'));
  });

  it('(10/16) 말: 메뉴 + 토마토 알레르기 → 토마토를 자동으로 빼고 알림, 메인 재료 알레르기면 다른 메뉴를 고르라고', async () => {
    const r = await interpret('토마토 알레르기 있어 로스트 치킨', c);
    expect(r.choices?.removeVegetables).toEqual(['vegetable:토마토']);
    expect(r.understood).toContain('토마토 알레르기라서 토마토를 뺐어요');
    const chicken = await interpret('닭고기 알레르기 로스트 치킨', c);
    expect(chicken.refusals.some((x) => x.startsWith('로스트 치킨에는 닭고기가 들어 있어요'))).toBe(true);
  });

  it('(10/16) 한 번에 말하기: 장소·든든하게·메인 재료·매운 것·음료가 엔진 조건과 주문서로', async () => {
    const r = await interpret('나 지금 배고픔 매운거 넣고 콜라는 제로콜라로 먹고 싶어 그리고 쇠고기 종류로 먹고싶은데 추천해줘바', c);
    expect(r.prefs).toMatchObject({ goal: 'FILLING', wantSpicy: true, wantMains: ['쇠고기'] });
    expect(r.place).toBeNull();
    expect(r.intent.options.extras).toEqual([{ name: '코카콜라 제로 (355ml)', qty: 1 }]); // 10/19: 세트를 안 말하면 제로콜라 단품
    const where = await interpret('강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기', c);
    expect(where.place).toBe('강남역');
    expect(where.menuId).toBe(ROAST);
    expect(where.choices).toMatchObject({ removeVegetables: ['vegetable:양파'], addVegetables: ['vegetable:피클'] });
    expect(where.prefs.allergies).toEqual(['우유']);
    // 메뉴를 안 말했어도 화면이 1위 메뉴로 다시 보내면 같은 말의 옵션이 그 메뉴에 붙음 (skipAi)
    const again = await interpret('쿠키 세트에 제로콜라 양파 빼줘', c, { menuId: ROAST, choices: {} });
    expect(again.choices).toMatchObject({ set: '쿠키 음료 세트', drink: '제로콜라', removeVegetables: ['vegetable:양파'] });
    // "매운 거 넣어줘 근데 할라피뇨는 빼고": 직접 뺀 게 이김
    const j = await interpret('로스트 치킨 매운 거 넣어줘 근데 할라피뇨는 빼고', c);
    expect(j.choices?.removeVegetables).toContain('vegetable:할라피뇨');
    expect(j.choices?.addVegetables ?? []).not.toContain('vegetable:할라피뇨');
  });

  it('(10/16) 말로 세트 고르기: "쿠키는 초코칩", "콘수프로" → 그 세트와 고른 것', async () => {
    // 10/19: 세트를 말하지 않으면 단품 ("쿠키는 초코칩으로" → 초코칩 쿠키 단품), 세트를 이미 골랐으면 그 세트의 쿠키
    expect(parseRules('쿠키는 초코칩으로', c).intent.options.extras).toEqual([{ name: '초코칩 쿠키', qty: 1 }]);
    const lc = c.menus.find((m) => m.name === '로스트 치킨')!.id;
    const inSet = await interpret('쿠키는 초코칩으로', c, { menuId: lc, choices: { set: '쿠키 음료 세트' } });
    expect(inSet.choices).toMatchObject({ set: '쿠키 음료 세트', setItem: '초코칩' });
    expect(inSet.choices?.extras).toBeUndefined();
    expect(parseRules('콘수프 세트로 할게', c).intent.options).toMatchObject({ set: '수프 음료 세트' });
    expect(parseRules('치즈 웨지 세트에 콜라', c).intent.options).toMatchObject({ set: '웨지 음료 세트', setItem: 'Cheesy 웨지 포테이토', drink: '콜라' });
    const r = await interpret('로스트 치킨 더블초코 쿠키 세트에 제로콜라', c);
    expect(r.choices).toMatchObject({ set: '쿠키 음료 세트', setItem: '더블 초코칩', drink: '제로콜라' });
  });

  it('AI가 실패해도 규칙만으로 진행', async () => {
    const r = await interpret('오늘은 좀 산뜻하게', c, {}, fakeAi(null, 'PROVIDER_DOWN'));
    expect(r.aiStatus).toBe('FAILED');
    expect(r.source).toBe('RULES');
  });

  it('(10/16) AI의 null은 "말 안 함" — 치즈·세트를 빼지 않음, 빼기는 NONE일 때만', () => {
    expect(validateIntent({ options: { cheese: null, set: null } }, c).intent.options).toEqual({});
    expect(validateIntent({ options: { cheese: 'NONE', set: 'NONE' } }, c).intent.options).toEqual({ cheese: null, set: null });
  });

  it('검사: 이상한 모양은 버림', () => {
    expect(validateIntent('문자열', c).dropped).toEqual(['NOT_AN_OBJECT']);
    expect(validateIntent({ conditions: { budgetKrw: -5, maxEnergyKcal: 1e9 } }, c).intent.conditions).toEqual({});
  });

  it('AI가 응답하지 않으면 기다리지 않고 규칙만으로 (화면이 안 멈춤)', async () => {
    const hang: AiRoute = { route: () => new Promise<AiResult>(() => undefined) };
    const started = Date.now();
    const r = await interpret('오늘은 좀 산뜻하게', c, {}, hang, 50);
    expect(r.aiStatus).toBe('FAILED');
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('(10/19) 판매가 끝난 메뉴·토핑 (data/입력표/판매끝.csv)', () => {
  it.each(['아기맹새우 먹을래', '로스트 치킨 아보카도로 줘', '에그 슬라이스 추가해줘', '아기맹 새우'])('%s → 판매 끝 안내, 비슷한 메뉴로 바꾸지 않음', async (t) => {
    const r = await interpret(t, c, {}, null);
    expect(r.refusals.some((x) => x.includes('판매가 끝났어요'))).toBe(true);
    expect(r.menuId).toBeNull();
  });
  it('AI가 비슷한 메뉴를 골라도 받지 않음', async () => {
    const shrimp = c.menus.find((m) => m.name === '쉬림프')!;
    const ai = fakeAi({ menu: shrimp.id });
    const r = await interpret('아기맹새우 같은 거 먹을래', c, {}, ai);
    expect(r.menuId).toBeNull();
  });
  it('판매 중인 비슷한 이름은 그대로 (로스트 치킨·쉬림프·에그마요)', async () => {
    for (const [t, n] of [['로스트 치킨으로', '로스트 치킨'], ['쉬림프 먹을래', '쉬림프'], ['에그마요로', '에그마요']] as const) {
      const r = await interpret(t, c, {}, null);
      expect(r.menuId, t).toBe(c.menus.find((m) => m.name === n)!.id);
      expect(r.refusals.join(), t).not.toContain('판매가 끝났어요');
    }
  });
});
