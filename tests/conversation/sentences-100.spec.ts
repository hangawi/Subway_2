// 말 알아듣기 정답 표 100문장 (10/16, 로드맵 29번 "문장 200개" 중 100개를 당겨 옴).
// 예형님 말투(반말·띄어쓰기 제각각)와 바른 말투를 섞었다. 규칙만으로 (AI 없이) 늘 같은 결과여야 한다.
// 적은 칸만 본다 — 적지 않은 칸은 무엇이 나와도 된다. 단, 매운 것 넣기/빼기는 적지 않았으면 둘 다 없어야 한다 (반대로 알아듣는 일 0).
import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { parseRules, parseWon } from '../../src/conversation/rules.ts';

const c = loadSubwayCatalog();
const menu = (n: string) => c.menus.find((m) => m.name === n)!.id;

interface Want {
  budget?: number;
  goal?: 'PROTEIN' | 'LIGHT';
  spicy?: 'WANT' | 'AVOID';
  allergies?: string[];
  /** 10/19: 고기 "빼고" → 그 메뉴 빼기 */
  avoidMains?: string[];
  kinds?: string[];
  kcal?: number;
  sodium?: number;
  menu?: string;
  size?: string;
  bread?: string;
  cheese?: string | null;
  sauces?: string[];
  remove?: string[];
  add?: string[];
  toppings?: string[];
  set?: string | null;
  toasted?: boolean;
  ask?: 'WHY' | 'COMPARE';
  question?: RegExp;
  refusal?: boolean;
  nearby?: boolean;
  followUp?: boolean;
}

const S = 'sauce:', V = 'vegetable:';
const SALAD = ['SALAD', 'GRAIN_SALAD'];
const MORNING = ['MORNING_SANDWICH', 'MORNING_WRAP'];

const TABLE: Array<[string, Want]> = [
  // 금액 (한글 숫자·띄어쓰기·여러 말투)
  ['만 삼천원 이하 매운거 넣어서', { budget: 13000, spicy: 'WANT' }],
  ['만삼천원 이하', { budget: 13000 }],
  ['이만원 이하로', { budget: 20000 }],
  ['칠천 원 이하', { budget: 7000 }],
  ['팔천오백원 안쪽으로', { budget: 8500 }],
  ['만원 밑으로', { budget: 10000 }],
  ['예산 만오천원', { budget: 15000 }],
  ['예산은 구천원', { budget: 9000 }],
  ['만원짜리로 추천해줘', { budget: 10000 }],
  ['1만2천원 이하', { budget: 12000 }],
  ['12000원까지', { budget: 12000 }],
  ['만 원 넘지 않게', { budget: 10000 }],
  ['단백질 많이 만원 이하', { budget: 10000, goal: 'PROTEIN' }],
  ['다이어트 중인데 칠천원 이하', { budget: 7000, goal: 'LIGHT' }],
  ['오천원 이하', { budget: 5000 }],
  ['만원 정도 이하', { budget: 10000 }],
  ['육천오백원 이하', { budget: 6500 }],
  ['삼만원 이하', { budget: 30000 }],
  ['만원 미만', { budget: 10000 }],
  ['8천 원 이하 샐러드', { budget: 8000, kinds: SALAD }],
  // 매운 것: 넣기 / 빼기 / 모르면 묻기
  ['매운 거 넣어서', { spicy: 'WANT' }],
  ['매콤한 걸로', { spicy: 'WANT' }],
  ['맵게 해줘', { spicy: 'WANT' }],
  ['매운 거 좋아해', { spicy: 'WANT' }],
  ['매운맛으로 추천', { spicy: 'WANT' }],
  ['얼큰한 거', { spicy: 'WANT' }],
  ['매운 거 빼고', { spicy: 'AVOID' }],
  ['맵게 못 먹어', { spicy: 'AVOID' }],
  ['안 맵게', { spicy: 'AVOID' }],
  ['매운 건 싫어', { spicy: 'AVOID' }],
  ['매운 거 별로야', { spicy: 'AVOID' }],
  ['스파이시 쉬림프 주세요', { menu: menu('스파이시 쉬림프') }],
  ['매운 거', { question: /매운 걸 넣을까요, 뺄까요/ }],
  ['맵기는 어때?', { question: /매운 걸 넣을까요, 뺄까요/ }],
  ['스파이시 이탈리안으로', { menu: menu('스파이시 이탈리안') }],
  ['매운 거 말고 단백질 많은 거', { spicy: 'AVOID', goal: 'PROTEIN' }],
  ['매콤하게 만원 이하', { spicy: 'WANT', budget: 10000 }],
  // 알레르기
  ['우유 알레르기 있어요', { allergies: ['우유'] }],
  ['유제품 못 먹어', { allergies: ['우유'] }],
  ['계란 못 먹고 우유도 못 먹어', { allergies: ['난류', '우유'] }],
  ['견과류 알레르기', { allergies: ['호두', '땅콩', '잣'] }],
  ['갑각류 못 먹어요', { allergies: ['게', '새우'] }],
  ['밀가루 안 먹어', { allergies: ['밀'] }],
  ['땅콩 알레르기 있고 만원 이하', { allergies: ['땅콩'], budget: 10000 }],
  ['돼지고기 빼고', { avoidMains: ['돼지고기'] }], // 10/19: 알레르기가 아니라 돼지고기 메뉴 빼기
  ['닭 알레르기', { allergies: ['닭고기'] }],
  ['토마토 알레르기', { allergies: ['토마토'] }],
  ['새우 들어간 거 빼줘', { allergies: ['새우'] }],
  ['콩 못 먹어', { allergies: ['대두'] }],
  ['맵게 못 먹고 게 알레르기', { spicy: 'AVOID', allergies: ['게'] }],
  // 목표·열량·나트륨
  ['살 안 찌는 걸로', { goal: 'LIGHT' }],
  ['단백질 위주로', { goal: 'PROTEIN' }],
  ['근육 키우는 중', { goal: 'PROTEIN' }],
  ['가볍게 먹고 싶어', { goal: 'LIGHT' }],
  ['400칼로리 이하', { kcal: 400 }],
  ['짜지 않은 거', { sodium: 700 }],
  ['나트륨 낮은 걸로', { sodium: 700 }],
  ['저칼로리로', { goal: 'LIGHT' }],
  ['칼로리 낮은 거', { goal: 'LIGHT' }],
  ['500kcal 이하 단백질 많이', { kcal: 500, goal: 'PROTEIN' }],
  // 종류
  ['샐러드로', { kinds: SALAD }],
  ['그레인 샐러드', { kinds: ['GRAIN_SALAD'] }],
  ['랩 먹고 싶어', { kinds: ['WRAP'] }],
  ['아침 메뉴 있어?', { kinds: MORNING }],
  ['샌드위치 추천해줘', { kinds: ['SANDWICH'] }],
  ['샐러드 만원 이하', { kinds: SALAD, budget: 10000 }],
  // 메뉴·옵션
  ['로스트 치킨', { menu: menu('로스트 치킨') }],
  ['로티세리', { menu: menu('로티세리 바비큐 치킨') }],
  ['비엠티 30센티', { menu: menu('이탈리안 비엠티'), size: '30cm' }],
  ['에그마요 15cm', { menu: menu('에그마요'), size: '15cm' }],
  ['참치 허니오트로', { menu: menu('참치'), bread: 'bread:허니오트' }],
  ['쉬림프 위트빵', { menu: menu('쉬림프'), bread: 'bread:위트' }],
  ['클럽 할라피뇨 빼고', { menu: menu('써브웨이 클럽'), remove: [`${V}할라피뇨`] }],
  ['양파 빼고 올리브 많이', { remove: [`${V}양파`], add: [`${V}올리브`] }],
  ['소스는 랜치로', { sauces: [`${S}랜치`] }],
  ['스윗어니언 소스', { sauces: [`${S}스위트 어니언`] }],
  ['소스 빼줘', { sauces: [] }],
  ['치즈 빼고', { cheese: null }],
  ['아메리칸 치즈로', { cheese: 'cheese:아메리칸 치즈' }],
  ['토스팅 안 해도 돼', { toasted: false }],
  ['쿠키 세트', { set: '쿠키 음료 세트' }],
  ['세트 말고 단품', { set: null }],
  ['에그마요 추가', { toppings: ['topping-name:에그마요'] }],
  ['베이컨 추가해줘', { toppings: ['topping-name:베이컨'] }],
  ['할라피뇨 많이', { add: [`${V}할라피뇨`] }],
  // 질문·거절·이어 말하기
  ['왜 이거야?', { ask: 'WHY' }],
  ['1번이랑 2번 비교해줘', { ask: 'COMPARE' }],
  ['빵 바꿔줘', { question: /빵은 어떤 걸로/ }],
  ['세트로 할래', { question: /세트는 어떤 걸로/ }],
  ['배달 돼?', { refusal: true }],
  ['가까운 데로', { nearby: true }],
  ['아까 거기서 소스만 바꿔', { followUp: true, question: /소스는 어떤 걸로/ }],
  // 섞어서
  ['만 삼천원 이하로 단백질 많은 거 샐러드', { budget: 13000, goal: 'PROTEIN', kinds: SALAD }],
  ['칠천원 이하 아침 메뉴', { budget: 7000, kinds: MORNING }],
  ['우유 알레르기 있는데 만원 이하로 가볍게', { allergies: ['우유'], budget: 10000, goal: 'LIGHT' }],
  ['매운 거 넣어서 로스트 치킨', { spicy: 'WANT', menu: menu('로스트 치킨') }],
  ['이만 원 이하 매운 거 빼고', { budget: 20000, spicy: 'AVOID' }],
  ['만원 이하 매콤하게 단백질', { budget: 10000, spicy: 'WANT', goal: 'PROTEIN' }],
  ['예산이 만원인데 샌드위치로', { budget: 10000, kinds: ['SANDWICH'] }],
  ['구천 원 안쪽 그레인 샐러드 단백질 많이', { budget: 9000, kinds: ['GRAIN_SALAD'], goal: 'PROTEIN' }],
];

describe('말 알아듣기 정답 표 100문장 (규칙만)', () => {
  it('표는 100문장', () => expect(TABLE).toHaveLength(100));

  for (const [text, w] of TABLE) {
    it(text, () => {
      const r = parseRules(text, c);
      const cd = r.intent.conditions, o = r.intent.options;
      const got: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      const pick = (k: keyof Want, v: unknown) => {
        if (w[k] !== undefined || (k === 'cheese' && 'cheese' in w) || (k === 'set' && 'set' in w)) {
          got[k] = v;
          want[k] = w[k];
        }
      };
      pick('budget', cd.budgetKrw);
      pick('goal', cd.goal);
      pick('allergies', cd.allergies);
      pick('avoidMains', cd.avoidMains);
      pick('kinds', cd.kinds);
      pick('kcal', cd.maxEnergyKcal);
      pick('sodium', cd.maxSodiumMg);
      pick('menu', r.intent.menu);
      pick('size', o.size);
      pick('bread', o.bread);
      pick('cheese', o.cheese);
      pick('sauces', o.sauces);
      pick('remove', o.removeVegetables);
      pick('add', o.addVegetables);
      pick('toppings', o.toppings);
      pick('set', o.set);
      pick('toasted', o.toasted);
      pick('ask', r.intent.ask);
      pick('nearby', cd.nearby);
      pick('followUp', r.intent.followUp);
      expect(got).toEqual(want);
      // 매운 것은 적은 대로만 (반대로·쓸데없이 알아듣지 않음)
      expect(cd.wantSpicy ? 'WANT' : cd.avoidSpicy ? 'AVOID' : undefined).toBe(w.spicy);
      if (w.question) expect(r.question).toMatch(w.question);
      if (w.refusal) expect(r.refusals.length).toBeGreaterThan(0);
    });
  }
});

describe('금액 읽기 (한글 숫자)', () => {
  it('여러 모양', () => {
    expect(['만원', '만 삼천원', '이만원', '칠천오백원', '1만5천원', '8천원', '7,500원', '1.5만', '삼만', '십만원'].map(parseWon)).toEqual([
      10000, 13000, 20000, 7500, 15000, 8000, 7500, 15000, 30000, 100000,
    ]);
  });
  it('이상한 말은 모름', () => {
    expect(['', '원', '삼사천원', '사과'].map(parseWon)).toEqual([null, null, null, null]);
  });
});

describe('못 알아들은 남은 말 (있으면 AI에게 그 부분만 물음)', () => {
  it('다 알아들으면 남은 말 없음', () => {
    for (const t of ['만 삼천원 이하 매운거 넣어서', '단백질 많이 만원 이하로 추천해줘', '샐러드로 주세요']) expect(parseRules(t, c).leftover).toBe('');
  });
  it('모르는 말이 섞이면 남음', () => {
    expect(parseRules('만원 이하 오늘 기분이 꿀꿀해', c).leftover).not.toBe('');
    expect(parseRules('든든하게 국물 있는 걸로', c).leftover).toBe('국물');
  });
  it('(10/21) 읽은 낱말의 조각은 남은 말이 아님 → AI를 안 부름', () => {
    for (const t of ['든든하게 먹고 싶어', '오늘 너무 피곤한데 든든한거 추천해줘', '새우 못먹어 매운것도 못먹고', '이탈리안비엠티 노양파 노피클', '피클 두배로'])
      expect(parseRules(t, c).leftover, t).toBe('');
  });
});

describe('(10/16) 한 글자 오타 (로드맵 26번)', () => {
  const W: Array<[string, (r: ReturnType<typeof parseRules>) => unknown, unknown]> = [
    ['에그마오', (r) => r.intent.menu, menu('에그마요')],
    ['로티쎄리 30센치', (r) => [r.intent.menu, r.intent.options.size], [menu('로티세리 바비큐 치킨'), '30cm']],
    ['스윗어니온 소스로', (r) => r.intent.options.sauces, ['sauce:스위트 어니언']],
    ['모짜렐나 치즈', (r) => r.intent.options.cheese, 'cheese:모차렐라 치즈'],
    ['십오센치로', (r) => r.intent.options.size, '15cm'],
  ];
  for (const [t, get, want] of W) it(t, () => expect(get(parseRules(t, c))).toEqual(want));
  it('짧은 말·전혀 다른 말은 고치지 않음 (엉뚱하게 고치느니 안 고침)', () => {
    expect(parseRules('오늘 기분 좋아', c).intent.menu).toBeUndefined();
    expect(parseRules('참치', c).intent.menu).toBe(menu('참치'));
  });
  it('흔한 말(소스·치즈·빵)은 남은 말로 치지 않음 → 쓸데없이 AI를 부르지 않음', () => {
    for (const t of ['랜치소스로', '모짜렐나 치즈', '쉬림프 위트빵']) expect(parseRules(t, c).leftover).toBe('');
  });
});

