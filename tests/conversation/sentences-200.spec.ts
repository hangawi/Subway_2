// 말 알아듣기 정답 표 101~200 (10/16, 로드맵 29번 200문장의 나머지 100개).
// "무슨 말을 해도" — 반말·띄어쓰기 제각각·여러 가지를 한 번에·말고/빼고 같은 부정·장소·음료·메인 재료를 섞었다.
// 규칙만으로 (AI 없이). 적은 칸만 보고, 매운 것·메인 재료·장소는 적지 않았으면 없어야 한다 (반대로·쓸데없이 알아듣지 않음).
import { describe, expect, it } from 'vitest';
import { loadSubwayCatalog } from '../../src/catalog/subway-catalog.ts';
import { parseRules } from '../../src/conversation/rules.ts';

const c = loadSubwayCatalog();
const menu = (n: string) => c.menus.find((m) => m.name === n)!.id;
const V = 'vegetable:', S = 'sauce:';
const SALAD = ['SALAD', 'GRAIN_SALAD'];

interface Want {
  budget?: number;
  goal?: 'PROTEIN' | 'LIGHT' | 'FILLING';
  spicy?: 'WANT' | 'AVOID';
  mains?: string[];
  place?: string;
  drink?: string;
  /** 단품 (10/19): "콜라만" → 코카콜라 단품 */
  extras?: string[];
  allergies?: string[];
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
  followUp?: boolean;
}

const TABLE: Array<[string, Want]> = [
  // 예형님 문장 그대로
  ['나 지금 배고픔 매운거 넣고 콜라는 제로콜라로 먹고 싶어 그리고 쇠고기 종류로 먹고싶은데 추천해줘바', { goal: 'FILLING', spicy: 'WANT', mains: ['쇠고기'], extras: ['코카콜라 제로 (355ml)'] }], // 10/19: 세트를 안 말하면 음료는 단품
  ['강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기', { place: '강남역', menu: menu('로스트 치킨'), remove: [`${V}양파`], add: [`${V}피클`], allergies: ['우유'] }],
  // 든든하게
  ['배고파 죽겠어', { goal: 'FILLING' }],
  ['든든하게 먹고 싶어', { goal: 'FILLING' }],
  ['양 많은 걸로', { goal: 'FILLING' }],
  ['배 안 고픈데 가볍게', { goal: 'LIGHT' }],
  ['만원으로 배부르게', { budget: 10000, goal: 'FILLING' }],
  ['푸짐한 거 추천', { goal: 'FILLING' }],
  // 메인 재료 종류
  ['쇠고기 종류로', { mains: ['쇠고기'] }],
  ['소고기 들어간 샌드위치', { mains: ['쇠고기'], kinds: ['SANDWICH'] }],
  ['치킨 종류로 추천해줘', { mains: ['닭고기'] }],
  ['닭고기 들어간 거', { mains: ['닭고기'] }],
  ['새우 들어간 걸로', { mains: ['새우'] }],
  ['돼지고기 들어간 거 먹고 싶다', { mains: ['돼지고기'] }],
  ['채식 메뉴로', { mains: ['야채'] }],
  ['이만 원 이하 쇠고기', { budget: 20000, mains: ['쇠고기'] }],
  ['새우 종류 말고 닭으로', { mains: ['닭고기'] }],
  ['참치 종류', { menu: menu('참치') }],
  ['로스트 치킨으로 줘', { menu: menu('로스트 치킨') }],
  // 음료
  ['콜라 세트로', { drink: '콜라', question: /세트/ }],
  ['웨지 세트에 제로콜라', { set: '웨지 음료 세트', drink: '제로콜라' }],
  ['쿠키 세트 사이다로', { set: '쿠키 음료 세트', drink: '사이다' }],
  ['음료는 커피로 수프 세트', { set: '수프 음료 세트', drink: '커피' }],
  ['제로 콜라', { extras: ['코카콜라 제로 (355ml)'] }],
  ['펩시 제로로 칩 세트', { drink: '제로콜라', set: '칩 음료 세트' }],
  ['스프라이트', { extras: ['스프라이트 (355ml)'] }],
  // 장소
  ['홍대입구역에서', { place: '홍대입구역' }],
  ['잠실 근처', { place: '잠실' }],
  ['여기서 먹을 거야', {}],
  ['회사 근처에서 점심', {}],
  ['서울역 쪽에서 만원 이하', { place: '서울역', budget: 10000 }],
  ['집에서 먹을 건데 든든한 거', { goal: 'FILLING' }],
  ['역삼역에서 매콤한 걸로 단백질 많이', { place: '역삼역', spicy: 'WANT', goal: 'PROTEIN' }],
  ['성수역 부근에서 이만원 이하 샐러드', { place: '성수역', budget: 20000, kinds: SALAD }],
  ['강남역 써브웨이에서 먹을래', { place: '강남역' }],
  ['역삼역점에서', { place: '역삼역' }],
  // 옵션
  ['로스트 치킨 30센치 허니오트 치즈는 모짜렐라', { menu: menu('로스트 치킨'), size: '30cm', bread: 'bread:허니오트', cheese: 'cheese:모차렐라 치즈' }],
  ['토마토 빼고 양파 많이', { remove: [`${V}토마토`], add: [`${V}양파`] }],
  ['할라피뇨 빼줘', { remove: [`${V}할라피뇨`] }],
  ['할라피뇨 좀 더 넣어줘', { add: [`${V}할라피뇨`] }],
  ['소스는 스윗어니언이랑 랜치', { sauces: [`${S}스위트 어니언`, `${S}랜치`] }],
  ['빵은 화이트로 토스팅 하지마', { bread: 'bread:화이트', toasted: false }],
  ['에그마요 30cm', { menu: menu('에그마요'), size: '30cm' }],
  ['비엘티 하나 주세요', { menu: menu('비엘티') }],
  ['참치에 베이컨 추가', { menu: menu('참치'), toppings: ['topping-name:베이컨'] }],
  ['아보카도 추가해줘', { toppings: ['topping-name:아보카도'] }],
  ['피클 빼', { remove: [`${V}피클`] }],
  ['올리브 노노', { remove: [`${V}올리브`] }],
  ['오이 싫어', { remove: [`${V}오이`] }],
  ['양파는 빼주시고 피망은 많이요', { remove: [`${V}양파`], add: [`${V}피망(파프리카)`] }],
  ['야채 다 빼', { question: /야채를 전부/ }],
  ['15cm 하나', { size: '15cm' }],
  ['큰 걸로', { size: '30cm' }],
  ['세트는 됐어', { set: null }],
  ['단품으로', { set: null }],
  ['핫칠리 소스 넣어줘', { sauces: [`${S}핫 칠리`] }],
  // 알레르기
  ['우유랑 계란 못 먹어', { allergies: ['우유', '난류'] }],
  ['갑각류랑 견과류 알레르기', { allergies: ['게', '새우', '호두', '땅콩', '잣'] }],
  ['돼지고기 못 먹어', { allergies: ['돼지고기'] }],
  ['땅콩 알레르기 심해요', { allergies: ['땅콩'] }],
  ['유제품 빼고 매운 거', { allergies: ['우유'], question: /매운 걸 넣을까요/ }],
  ['견과류 빼줘', { allergies: ['호두', '땅콩', '잣'] }],
  ['밀가루 안 들어간 거', { allergies: ['밀'] }],
  ['글루텐 프리로', { allergies: ['밀'] }],
  ['계란 빼고 에그마요', { allergies: ['난류'], menu: menu('에그마요') }],
  ['우유 알레르기 있는데 치즈 넣어도 돼?', { allergies: ['우유'] }],
  // 금액·열량·나트륨
  ['만 오천 원 이하로', { budget: 15000 }],
  ['7천5백원 이하', { budget: 7500 }],
  ['팔천 원 안으로', { budget: 8000 }],
  ['가격은 만원 넘으면 안 돼', { budget: 10000 }],
  ['육천원짜리로', { budget: 6000 }],
  ['칼로리 400 이하', { kcal: 400 }],
  ['나트륨 적게', { sodium: 700 }],
  ['짜지 않고 단백질 많은 거', { sodium: 700, goal: 'PROTEIN' }],
  ['오늘 다이어트 중이라 가볍게', { goal: 'LIGHT' }],
  ['운동했으니까 단백질', { goal: 'PROTEIN' }],
  // 종류
  ['샐러드 말고 샌드위치', { kinds: ['SANDWICH'] }],
  ['샐러드는 싫어', { kinds: ['SANDWICH', 'WRAP', 'MORNING_SANDWICH', 'MORNING_WRAP'] }],
  ['랩이나 샐러드', { kinds: ['SALAD', 'GRAIN_SALAD', 'WRAP'] }],
  ['아침 메뉴 있어?', { kinds: ['MORNING_SANDWICH', 'MORNING_WRAP'] }],
  // 매운 것
  ['매운 거 땡겨', { spicy: 'WANT' }],
  ['안 매운 거', { spicy: 'AVOID' }],
  ['맵찔이라 매운 건 못 먹어', { spicy: 'AVOID' }],
  ['매운 거 넣어줘 근데 할라피뇨는 빼고', { spicy: 'WANT', remove: [`${V}할라피뇨`] }],
  ['쇠고기로 매운 거', { mains: ['쇠고기'], question: /매운 걸 넣을까요/ }],
  // 질문·거절·이어 말하기
  ['1번 왜?', { ask: 'WHY' }],
  ['2번이랑 3번 뭐가 나아?', { ask: 'COMPARE' }],
  ['배달 돼?', { refusal: true }],
  ['결제는 카드로 할게', { refusal: true }],
  ['아까 거기서 빵만 바꿔', { followUp: true, question: /빵은 어떤 걸로/ }],
  ['그걸로 30cm', { followUp: true, size: '30cm' }],
  ['방금 그 메뉴 치즈 빼줘', { followUp: true, cheese: null }],
  // 섞어서 길게
  ['선릉역에서 매운 거 빼고 쇠고기로 만이천원 이하 쿠키 세트 제로콜라', { place: '선릉역', spicy: 'AVOID', mains: ['쇠고기'], budget: 12000, set: '쿠키 음료 세트', drink: '제로콜라' }],
  ['판교역 근처에서 닭고기 들어간 거 만원 이하로', { place: '판교역', mains: ['닭고기'], budget: 10000 }],
  ['토마토 알레르기 있고 든든한 샌드위치 만오천원 안쪽', { allergies: ['토마토'], goal: 'FILLING', kinds: ['SANDWICH'], budget: 15000 }],
  ['신림역에서 가볍게 샐러드 칠천원 이하 소스는 오리엔탈', { place: '신림역', goal: 'LIGHT', kinds: SALAD, budget: 7000, sauces: [`${S}저칼로리 오리엔탈`] }],
  ['쉬림프로 쿠키 세트에 사이다', { menu: menu('쉬림프'), set: '쿠키 음료 세트', drink: '사이다' }],
  ['강남역 근처 매콤한 거 콜라랑 웨지 세트', { place: '강남역', spicy: 'WANT', drink: '콜라', set: '웨지 음료 세트' }],
  ['라이트하게 먹고 싶어', { goal: 'LIGHT' }],
  ['사당역에서 쉬림프 15cm 위트빵에 할라피뇨 빼고 사우스웨스트 치폴레', { place: '사당역', menu: menu('쉬림프'), size: '15cm', bread: 'bread:위트', remove: [`${V}할라피뇨`], sauces: [`${S}사우스웨스트 치폴레`] }],
];

describe('말 알아듣기 정답 표 101~200 (규칙만)', () => {
  it('표는 100문장', () => expect(TABLE).toHaveLength(100));

  for (const [text, w] of TABLE) {
    it(text, () => {
      const r = parseRules(text, c);
      const cd = r.intent.conditions, o = r.intent.options;
      const got: Record<string, unknown> = {};
      const want: Record<string, unknown> = {};
      const pick = (k: keyof Want, v: unknown) => {
        if (w[k] !== undefined || ((k === 'cheese' || k === 'set') && k in w)) {
          got[k] = v;
          want[k] = w[k];
        }
      };
      pick('budget', cd.budgetKrw);
      pick('goal', cd.goal);
      pick('allergies', cd.allergies ? [...cd.allergies].sort() : cd.allergies);
      if (w.allergies) want.allergies = [...w.allergies].sort();
      pick('kinds', cd.kinds ? [...cd.kinds].sort() : cd.kinds);
      if (w.kinds) want.kinds = [...w.kinds].sort();
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
      pick('drink', o.drink);
      pick('extras', o.extras?.map((e) => e.name));
      pick('toasted', o.toasted);
      pick('ask', r.intent.ask);
      pick('followUp', r.intent.followUp);
      expect(got).toEqual(want);
      // 적지 않았으면 없어야 하는 것 (반대로·쓸데없이 알아듣지 않음)
      expect(cd.wantSpicy ? 'WANT' : cd.avoidSpicy ? 'AVOID' : undefined).toBe(w.spicy);
      expect(cd.wantMains).toEqual(w.mains);
      expect(cd.place).toBe(w.place);
      if (w.question) expect(r.question).toMatch(w.question);
      if (w.refusal) expect(r.refusals.length).toBeGreaterThan(0);
    });
  }
});
