// 말로 주문하기 3,000문장 (10/20, 예형님 요청): 사람이 말할 수 있는 경우를 묶음별로 나누고, 말투를 바꿔 조합해 만든다.
// 문장마다 정답(무엇을 알아들어야 하는지)이 같이 있다. 같은 시드라 매번 같은 3,000문장.
//   npx tsx scripts/talk-3000.ts --docs        → docs/검수/3000문장_목록.md (사람이 보는 목록)
//   npx tsx scripts/talk-3000-run.ts           → 규칙만 돌려 결과 / --live <주소> → 실제 주소(규칙 + A100)
import type { SubwayCatalog } from '../src/catalog/subway-catalog.ts';
import type { Want } from './talk-cases.ts';

export interface TalkCase {
  id: string;
  group: string;
  text: string;
  want: Want;
}

// 고정 시드 난수 (mulberry32)
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hasBatchim = (w: string) => {
  const c = w.charCodeAt(w.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};
const ro = (w: string) => (hasBatchim(w) && (w.charCodeAt(w.length - 1) - 0xac00) % 28 !== 8 ? `${w}으로` : `${w}로`);
const eun = (w: string) => (hasBatchim(w) ? `${w}은` : `${w}는`);

export function make3000(catalog: SubwayCatalog): TalkCase[] {
  const r = rng(20261020);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const cases: TalkCase[] = [];
  const seen = new Set<string>();
  const add = (group: string, text: string, want: Want) => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    cases.push({ id: `${group}-${String(cases.filter((c) => c.group === group).length + 1).padStart(3, '0')}`, group, text: t, want });
  };
  // 말투 바꾸기: 그대로 / 존댓말 / 반말 / 띄어쓰기 없음 / 군말 앞에
  const PREFIX = ['', '', '음 ', '아 ', '저기 ', '그니까 ', '나 ', '저는 '];
  const styles = (base: string): string[] => {
    const out = [base];
    out.push(`${pick(PREFIX)}${base}`.trim());
    out.push(base.replace(/\s+/g, ''));
    return out;
  };

  // ── 데이터 ──
  const sandwiches = catalog.menus.filter((m) => m.kind === 'SANDWICH');
  const meals = catalog.menus.filter((m) => !['SIDE'].includes(m.kind) && !/^미니/.test(m.name));
  const MENU_ALIAS: Array<[string, string]> = [
    ['로티', '로티세리 바비큐 치킨'], ['비엠티', '이탈리안 비엠티'], ['bmt', '이탈리안 비엠티'], ['스테치', '스테이크 & 치즈'], ['스테이크치즈', '스테이크 & 치즈'],
    ['스테이크 앤 치즈', '스테이크 & 치즈'], ['에마', '에그마요'], ['튜나', '참치'], ['치데', '치킨 데리야끼'], ['데리야끼', '치킨 데리야끼'], ['클럽', '써브웨이 클럽'],
    ['풀드포크', '풀드포크 바비큐'], ['blt', '비엘티'], ['야채샌드위치', '베지'], ['피자', '피자썹'],
  ];
  const TYPO: Array<[string, string]> = [
    ['에그마오', '에그마요'], ['로티쎄리 바비큐 치킨', '로티세리 바비큐 치킨'], ['이탈리안 비엠티이', '이탈리안 비엠티'], ['스테이크 앤 치스', '스테이크 & 치즈'],
    ['써브웨이 클롭', '써브웨이 클럽'], ['치킨 데리야키', '치킨 데리야끼'], ['풀드포크 바베큐', '풀드포크 바비큐'], ['스파이시 이딸리안', '스파이시 이탈리안'],
    ['치킨 베이컨 아보까도', '치킨 베이컨 아보카도'], ['안창 비푸', '안창 비프'], ['로스트 치퀸', '로스트 치킨'], ['스파이시 쉬림쁘', '스파이시 쉬림프'],
  ];
  const ENDS = ['', ' 줘', ' 주세요', ' 먹을래', ' 하나 주세요', ' 할게요', ' 부탁해요', ' 먹고 싶어'];
  const BREADS: Array<[string, string]> = [['화이트', '화이트'], ['위트', '위트'], ['허니오트', '허니오트'], ['허오', '허니오트'], ['파마산 오레가노', '파마산 오레가노'], ['파마산', '파마산 오레가노'], ['플랫브레드', '플랫브레드'], ['플랫', '플랫브레드']];
  const CHEESES: Array<[string, string]> = [['아메리칸', '아메리칸 치즈'], ['아메리칸 치즈', '아메리칸 치즈'], ['슈레드', '슈레드 치즈'], ['모짜렐라', '모차렐라 치즈'], ['모차렐라 치즈', '모차렐라 치즈']];
  const VEGS: Array<[string, string]> = [['양상추', '양상추'], ['상추', '양상추'], ['토마토', '토마토'], ['오이', '오이'], ['피망', '피망(파프리카)'], ['파프리카', '피망(파프리카)'], ['양파', '양파'], ['피클', '피클'], ['올리브', '올리브'], ['할라피뇨', '할라피뇨']];
  const SAUCES: Array<[string, string]> = [
    ['랜치', '랜치'], ['스위트 어니언', '스위트 어니언'], ['스윗어니언', '스위트 어니언'], ['마요네즈', '마요네즈'], ['스위트 칠리', '스위트 칠리'], ['스모크 바비큐', '스모크 바비큐'],
    ['핫 칠리', '핫 칠리'], ['허니 머스터드', '허니 머스터드'], ['머스타드', '허니 머스터드'], ['사우스웨스트 치폴레', '사우스웨스트 치폴레'], ['홀스래디쉬', '홀스래디쉬'],
    ['오리엔탈', '저칼로리 오리엔탈'], ['올리브오일', '엑스트라 버진 올리브 오일'], ['레드와인식초', '레드 와인 식초'],
  ];
  const REMOVE = (v: string) => pick([`${v} 빼줘`, `${v} 빼고`, `${eun(v)} 빼주세요`, `노${v.replace(/\s/g, '')}`, `${v} 넣지마`, `${v} 없이`]);
  const ADD = (v: string) => pick([`${v} 많이`, `${v} 추가`, `${v} 더`, `${v} 듬뿍`, `${v} 두배로`, `${v} 많이 넣어줘`]);
  const SAUCE = (s: string) => pick([`${s} 소스로`, `소스는 ${s}`, `${ro(s)} 해줘`]);
  const BUDGETS: Array<[string, number]> = [['만원 이하', 10000], ['만 원 이하', 10000], ['1만원 이하', 10000], ['8천원 이하', 8000], ['팔천원 이하', 8000], ['7000원 이하', 7000], ['만 삼천원 이하', 13000], ['12000원 안쪽으로', 12000], ['만오천원 안으로', 15000], ['9천원까지', 9000], ['구천원 이하로', 9000], ['만이천원 이하', 12000]];
  const GOALS: Array<[string, 'PROTEIN' | 'LIGHT' | 'FILLING']> = [
    ['단백질 많이', 'PROTEIN'], ['단백질 많은 거', 'PROTEIN'], ['고단백으로', 'PROTEIN'], ['운동해서 단백질 많은 걸로', 'PROTEIN'],
    ['가볍게', 'LIGHT'], ['살 안 찌는 거', 'LIGHT'], ['다이어트 중이야', 'LIGHT'], ['칼로리 낮은 걸로', 'LIGHT'], ['가볍게 먹고 싶어', 'LIGHT'],
    ['든든하게', 'FILLING'], ['배고파', 'FILLING'], ['배불리 먹고 싶어', 'FILLING'], ['양 많은 거', 'FILLING'], ['배고픔', 'FILLING'], ['든든한 걸로', 'FILLING'],
  ];
  const SPICY_WANT = ['매운 거 넣어줘', '맵게 해줘', '매콤하게', '얼큰한 걸로', '매운 거 좋아', '맵게'];
  const SPICY_AVOID = ['안 맵게', '매운 거 빼고', '맵게 못 먹어', '매운 건 싫어', '안 매운 걸로', '매운 거 빼줘'];
  const MAINS_WANT: Array<[string, string]> = [['쇠고기 종류로', '쇠고기'], ['소고기 들어간 거', '쇠고기'], ['치킨으로', '닭고기'], ['닭고기 메뉴', '닭고기'], ['돼지고기 들어간 거', '돼지고기'], ['소고기로', '쇠고기'], ['닭고기 들어간 걸로', '닭고기']];
  const MAINS_AVOID: Array<[string, string]> = [['쇠고기 말고', '쇠고기'], ['돼지고기 빼고', '돼지고기'], ['치킨 말고', '닭고기'], ['닭고기는 별로', '닭고기'], ['소고기는 빼고', '쇠고기']];
  const KINDS: Array<[string, string]> = [['샐러드로', 'SALAD'], ['샌드위치로', 'SANDWICH'], ['랩으로', 'WRAP'], ['아침 메뉴', 'MORNING_SANDWICH'], ['샐러드 먹을래', 'SALAD']];
  const SALTY: Array<[string, 'MORE' | 'LESS']> = [['짜게 먹고 싶어', 'MORE'], ['짭짤한 거', 'MORE'], ['좀 짜게', 'MORE'], ['간 세게', 'MORE'], ['싱겁게', 'LESS'], ['덜 짜게', 'LESS'], ['나트륨 적은 거', 'LESS'], ['안 짜게', 'LESS']];
  const ALLERGY_WORDS: Array<[string, string]> = [
    ['우유', '우유'], ['계란', '난류'], ['달걀', '난류'], ['메밀', '메밀'], ['땅콩', '땅콩'], ['대두', '대두'], ['밀가루', '밀'], ['고등어', '고등어'], ['게', '게'], ['새우', '새우'],
    ['복숭아', '복숭아'], ['토마토', '토마토'], ['호두', '호두'], ['오징어', '오징어'], ['조개', '조개류'], ['잣', '잣'], ['콩', '대두'], ['밀', '밀'], ['갑각류', '게'], ['견과류', '호두'],
  ];
  const ALLERGY = (w: string) => pick([`${w} 알레르기 있어요`, `${w} 알레르기`, `${w} 못 먹어요`, `${w} 알러지 있어`, `${w} 못먹어`]);
  const DRINKS: Array<[string, string, string | null]> = [
    ['콜라', '코카콜라 (355ml)', '콜라'], ['제로콜라', '코카콜라 제로 (355ml)', '제로콜라'], ['코카콜라 제로', '코카콜라 제로 (355ml)', '제로콜라'], ['사이다', '스프라이트 (355ml)', '사이다'],
    ['스프라이트', '스프라이트 (355ml)', '사이다'], ['제로 사이다', '스프라이트 제로 (355ml)', '제로사이다'], ['닥터페퍼', '닥터페퍼 (355ml)', null], ['탄산수', '씨그램', null],
    ['오렌지 주스', '미닛메이드', null], ['토레타', '토레타', null], ['생수', '생수', null], ['아메리카노', '아메리카노', '커피'], ['아아', '아이스 아메리카노', '커피'],
    ['아이스 아메리카노', '아이스 아메리카노', '커피'], ['라떼', '바리스타룰스 저당 라떼(350ml)', null], ['코카콜라', '코카콜라 (355ml)', '콜라'],
  ];
  const SIDES: Array<[string, string, string, string | null]> = [
    // [말, 단품 이름, 세트 이름, 세트에서 고른 것]
    ['초코칩 쿠키', '초코칩 쿠키', '쿠키 음료 세트', '초코칩'], ['더블 초코칩 쿠키', '더블 초코칩 쿠키', '쿠키 음료 세트', '더블 초코칩'], ['오트밀 레이즌 쿠키', '오트밀 레이즌 쿠키', '쿠키 음료 세트', '오트밀 레이즌'],
    ['마카다미아 쿠키', '화이트 초코 마카다미아 쿠키', '쿠키 음료 세트', '화이트 초코 마카다미아'], ['웨지감자', '웨지 포테이토', '웨지 음료 세트', '웨지 포테이토'], ['감자칩', '칩 (랜덤발송)', '칩 음료 세트', '칩'],
    ['치즈 웨지', 'Cheesy 웨지 포테이토', '웨지 음료 세트', 'Cheesy 웨지 포테이토'],
  ];
  const PLACES = ['강남역', '홍대입구역', '판교역', '역삼역', '잠실역', '서울역', '신논현역', '사당역', '선릉역', '시청역', '여의도역', '건대입구역', '합정역', '수원역', '부산역', '광화문역', '신림역', '노원역'];
  const PLACE = (p: string) => pick([`${p}에서`, `${p} 근처에서`, `${p} 쪽`, `${p} 써브웨이`, `${p} 근처`]);
  const NOT_SUBWAY: Array<[string, string[] | null]> = [
    ['생선회', ['새우', '참치']], ['초밥', ['새우', '참치']], ['연어', ['새우', '참치']], ['햄버거', ['쇠고기']], ['버거', ['쇠고기']], ['돈까스', ['돼지고기']], ['삼겹살', ['돼지고기']],
    ['짜장면', null], ['짬뽕', null], ['라면', null], ['떡볶이', null], ['김밥', null], ['비빔밥', null], ['국밥', null], ['파스타', null], ['냉면', null], ['마라탕', null], ['카레', null], ['핫도그', null], ['양념치킨', ['닭고기']],
  ];
  const sw = sandwiches.filter((m) => m.price.price30cm != null);
  const name = (m: { name: string }) => m.name;

  // ── A. 메뉴 고르기 ──
  for (const m of meals) for (const e of [pick(ENDS), pick(ENDS)]) for (const t of styles(`${m.name}${e}`).slice(0, 2)) add('A메뉴', t, { menu: m.name });
  for (const [a, n] of MENU_ALIAS) for (const t of styles(`${a}${pick(ENDS)}`)) add('A메뉴', t, { menu: n });
  for (const [a, n] of TYPO) for (const t of styles(`${a}${pick(ENDS)}`)) add('A메뉴', t, { menu: n });

  // ── B. 옵션 (샌드위치) ──
  for (let i = 0; i < 260; i++) {
    const m = pick(sw);
    const kind = Math.floor(r() * 8);
    if (kind === 0) {
      const [w, b] = pick(BREADS);
      add('B옵션', `${m.name} ${pick([`${w}빵으로`, `빵은 ${w}`, `${w}빵`])}`, { menu: m.name, bread: b });
    } else if (kind === 1) {
      const [w, c] = pick(CHEESES);
      add('B옵션', `${m.name} ${pick([`치즈는 ${w}`, `${ro(w)}`, `${w} 넣어줘`])}`, { menu: m.name, cheese: c });
    } else if (kind === 2) {
      const [w, v] = pick(VEGS);
      add('B옵션', `${m.name} ${REMOVE(w)}`, { menu: m.name, remove: [v] });
    } else if (kind === 3) {
      const [w, v] = pick(VEGS);
      add('B옵션', `${m.name} ${ADD(w)}`, { menu: m.name, add: [v] });
    } else if (kind === 4) {
      const a = pick(VEGS);
      let b = pick(VEGS);
      if (b[1] === a[1]) b = VEGS[(VEGS.indexOf(a) + 3) % VEGS.length]!;
      const j = pick([' ', '랑 ', ', ', '하고 ']);
      add('B옵션', `${m.name} ${a[0]}${j}${b[0]} ${pick(['빼줘', '빼주세요', '빼', '없이'])}`, { menu: m.name, remove: [a[1], b[1]] });
    } else if (kind === 5) {
      const [w, s] = pick(SAUCES);
      add('B옵션', `${m.name} ${SAUCE(w)}`, { menu: m.name, sauces: [s] });
    } else if (kind === 6) {
      const size = pick([['30cm', '30cm'], ['30센치', '30cm'], ['삼십센치', '30cm'], ['15cm', '15cm'], ['십오센치', '15cm']] as const);
      add('B옵션', `${m.name} ${size[0]}${pick(['', '로', ' 주세요'])}`, { menu: m.name, size: size[1] });
    } else {
      add('B옵션', `${m.name} ${pick(['토스팅 하지마', '토스팅 안 해도 돼', '안 구워도 돼', '굽지마'])}`, { menu: m.name, toasted: false });
    }
  }
  for (const m of sw.slice(0, 12)) add('B옵션', `${m.name} 소스 빼줘`, { menu: m.name, noSauce: true });
  for (const m of sw.filter((x) => /치즈/.test(x.name) === false).slice(0, 8)) add('B옵션', `${m.name} 치즈 빼고`, { menu: m.name, cheese: null });

  // ── C. 조건 ──
  for (const [w, b] of BUDGETS) for (const t of styles(`${w}${pick(['', ' 추천해줘', '로 골라줘'])}`)) add('C조건', t, { budget: b });
  for (const [w, g] of GOALS) for (const t of styles(`${w}${pick(['', ' 추천해줘', ''])}`)) add('C조건', t, { goal: g });
  for (const w of SPICY_WANT) for (const t of styles(w)) add('C조건', t, { spicy: 'want' });
  for (const w of SPICY_AVOID) for (const t of styles(w)) add('C조건', t, { spicy: 'avoid' });
  for (const [w, k] of MAINS_WANT) for (const t of styles(`${w}${pick(['', ' 추천해줘'])}`)) add('C조건', t, { mains: [k] });
  for (const [w, k] of MAINS_AVOID) for (const t of styles(w)) add('C조건', t, { avoid: [k] });
  for (const [w, k] of KINDS) for (const t of styles(w)) add('C조건', t, { kinds: [k] });
  for (const [w, s] of SALTY) for (const t of styles(`${w}${pick(['', ' 먹고 싶어', ''])}`)) add('C조건', t, { salty: s });
  for (const [w, b] of BUDGETS.slice(0, 6)) {
    const [gw, g] = pick(GOALS);
    add('C조건', `${w} ${gw}`, { budget: b, goal: g });
  }

  // ── D. 알레르기 ──
  for (const [w, a] of ALLERGY_WORDS) for (let k = 0; k < 3; k++) add('D알레르기', ALLERGY(w), { allergies: [a] });
  for (let i = 0; i < 40; i++) {
    const x = pick(ALLERGY_WORDS.filter(([w]) => w.length >= 2));
    let y = pick(ALLERGY_WORDS.filter(([w]) => w.length >= 2));
    if (y[1] === x[1]) y = ['땅콩', '땅콩'];
    if (y[1] === x[1]) continue;
    const j = pick(['랑 ', ' ', '하고 ', ', ']);
    add('D알레르기', `${x[0]}${j}${y[0]} ${pick(['알레르기 있어요', '알레르기', '못 먹어'])}`, { allergies: [x[1], y[1]] });
  }

  // ── E. 세트·단품 ──
  for (const [w, s] of DRINKS) for (const t of [`${w}만 줘`, `${w} 하나`, `${w} 하나만 주세요`]) add('E단품', t, { menu: 'singles', extras: [s] });
  for (const [w, s] of DRINKS.slice(0, 6)) add('E단품', `${w} 두개`, { menu: 'singles', extras: [s] });
  for (const [w, s] of SIDES) add('E단품', `${w} 하나`, { menu: 'singles', extras: [s] });
  for (let i = 0; i < 25; i++) {
    const [dw, ds] = pick(DRINKS);
    const [sw2, ss] = pick(SIDES);
    add('E단품', `${dw}랑 ${sw2}만`, { menu: 'singles', extras: [ds, ss] });
  }
  for (let i = 0; i < 40; i++) {
    const m = pick(sw);
    const [dw, ds] = pick(DRINKS);
    add('E단품', `${m.name}에 ${dw}${pick(['', ' 하나', ' 주세요'])}`, { menu: m.name, extras: [ds] });
  }
  for (let i = 0; i < 40; i++) {
    const m = pick(sw);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    const [sw2, , setName, item] = pick(SIDES);
    add('E세트', `${m.name}에 ${dw}랑 ${sw2}`, { menu: m.name, set: setName, drink: setDrink!, ...(item ? {} : {}) });
  }
  for (let i = 0; i < 30; i++) {
    const m = pick(sw);
    const [sname, setName] = pick([['쿠키 세트', '쿠키 음료 세트'], ['웨지 세트', '웨지 음료 세트'], ['칩 세트', '칩 음료 세트'], ['수프 세트', '수프 음료 세트']] as const);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    // "머쉬룸 수프 세트"는 사람도 머쉬룸 수프로 들음 → "머쉬룸에 수프 세트"로
    const join = sname === '수프 세트' && /머쉬룸$/.test(m.name) ? '에' : '';
    add('E세트', `${m.name}${join} ${sname}${pick(['로', '에'])} ${dw}`, { menu: m.name, set: setName, drink: setDrink! });
  }
  add('E세트', '환타 있어?', { refuse: '환타는 써브웨이에 없어요' });
  add('E세트', '환타로 주세요', { refuse: '환타는 써브웨이에 없어요' });

  // ── F. 장소 ──
  for (const p of PLACES) {
    const m = pick(meals);
    add('F장소', `${PLACE(p)} ${m.name}`, { place: p, menu: m.name });
    const [gw, g] = pick(GOALS.filter(([w]) => !/중이야|먹고 싶어/.test(w)));
    add('F장소', `${PLACE(p)} ${gw}`, { place: p, goal: g });
    add('F장소', `${PLACE(p)} ${pick(['추천해줘', '먹을 거 추천', '뭐 먹지'])}`, { place: p });
  }
  for (const w of ['저번거에서 소스만 랜치로', '아까 거기서 30으로', '집에서 먹을 거', '회사에서 먹을래', '여기서 먹을게']) add('F장소', w, { place: null });

  // ── G. 없는 음식 ──
  for (const [w, mains] of NOT_SUBWAY) {
    add('G없는음식', `${w} 먹고 싶어`, { refuse: `${eun(w)} 써브웨이 메뉴에 없어요`, ...(mains ? { mains } : {}) });
    add('G없는음식', `${w}${pick(['에 맵게 해줘', ' 줘', ' 있어?', ' 하나요'])}`, { refuse: `${eun(w)} 써브웨이 메뉴에 없어요`, ...(mains ? { mains } : {}) });
  }
  add('G없는음식', '회 먹고싶어', { refuse: '회는 써브웨이 메뉴에 없어요', mains: ['새우', '참치'] });

  // ── H. 질문·이어 말하기 ──
  for (const w of ['왜 이거 추천했어', '이거 왜 1등이야', '왜?', '이유가 뭐야']) add('H질문', w, { ask: 'WHY' });
  for (const w of ['1번이랑 2번 비교해줘', '1번 2번 뭐가 달라', '1번이랑 2번 차이', '첫번째랑 두번째 비교']) add('H질문', w, { ask: 'COMPARE' });
  for (const w of ['지난번처럼', '저번이랑 똑같이', '늘 먹던 걸로', '평소처럼 해줘', '지난번 거로 줘', '저번거로']) add('H질문', w, { ask: 'LAST' });
  for (const w of ['소스 바꿀래', '빵 뭐있어', '세트 뭐 있어']) add('H질문', w, { question: true });

  // ── I. 취향·상태 (말을 알아듣는지 — 저장·추천 반영은 취향 이야기에서) ──
  const TASTE: Array<[string, string]> = [['소고기', '쇠고기'], ['쇠고기', '쇠고기'], ['치킨', '닭고기'], ['닭고기', '닭고기'], ['돼지고기', '돼지고기'], ['새우', '새우'], ['참치', '참치'], ['계란', '달걀']];
  for (const [w, k] of TASTE) {
    add('I취향', `평소에 ${w} 좋아해`, { taste: [`${k}:1:LASTING`] });
    add('I취향', `나 원래 ${w} 별로야`, { taste: [`${k}:-1:LASTING`] });
    add('I취향', `오늘은 ${w} 피할래`, { taste: [`${k}:-1:TODAY`] });
    add('I취향', `오늘은 ${w} 땡겨`, { taste: [`${k}:1:TODAY`] });
  }
  for (const w of ['오늘 너무 피곤해', '피곤한데 든든한 거', '지쳤어', '오늘 힘들어', '기운 없어']) add('I취향', w, { mood: 'TIRED' });

  // ── J. 안 되는 요청 ──
  for (const w of ['배달해줘', '결제해줘', '카드로 할게', '예약해줘', '주문 넣어줘', '배달 되나요', '결제까지 해줘']) add('J안되는것', w, { refuse: '배달·결제' });

  // ── K. 이상한 말 (엉뚱하게 지어내지 않는지만) ──
  for (const w of ['ㅁㄴㅇㄹ', 'asdf', '123', '!!!', 'ㅋㅋㅋㅋ', 'hello', '아무거나', '뭐 먹지', '음...', '?', '그냥', '몰라', '배불러', '오늘 날씨 좋다', '너 누구야', '고마워', '써브웨이', '샌드위치', '메뉴', '추천']) add('K이상한말', w, {});
  add('K이상한말', '메뉴 추천 '.repeat(29).trim(), {});
  add('K이상한말', '샌드위치'.repeat(20), { kinds: ['SANDWICH'] });

  // ── L. 섞기 (2~5가지를 한 문장에) ──
  const target = 3000 - 100; // 취향 이야기 100개는 따로
  let guard = 0;
  while (cases.length < target && guard++ < 20000) {
    const parts: Array<{ text: string; want: Want }> = [];
    const useMenu = r() < 0.55;
    const m = useMenu ? pick(sw) : null;
    if (r() < 0.25) {
      const p = pick(PLACES);
      parts.push({ text: PLACE(p), want: { place: p } });
    }
    if (m) parts.push({ text: m.name, want: { menu: m.name } });
    const used = new Set<string>();
    let vegUsed = ''; // 같은 야채를 빼고 더하는 말은 안 만든다 ("양상추 빼고 상추 듬뿍")
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const c = Math.floor(r() * (m ? 11 : 7));
      const key = m ? ['budget', 'goal', 'spicy', 'mains', 'allergy', 'drink', 'salty', 'bread', 'remove', 'add', 'sauce'][c]! : ['budget', 'goal', 'spicy', 'mains', 'allergy', 'drink', 'salty'][c]!;
      if (used.has(key) || (key === 'mains' && m) || (key === 'spicy' && (used.has('remove') || used.has('add')))) continue;
      if ((key === 'remove' || key === 'add') && used.has('spicy')) continue;
      used.add(key);
      if (key === 'budget') {
        const [w, b] = pick(BUDGETS);
        parts.push({ text: w, want: { budget: b } });
      } else if (key === 'goal') {
        const [w, g] = pick(GOALS.filter(([x]) => !/중이야/.test(x)));
        parts.push({ text: w, want: { goal: g } });
      } else if (key === 'spicy') {
        const want = r() < 0.6;
        parts.push({ text: pick(want ? SPICY_WANT.filter((x) => x !== '맵게') : SPICY_AVOID), want: { spicy: want ? 'want' : 'avoid' } });
      } else if (key === 'mains') {
        const [w, k2] = pick(MAINS_WANT);
        parts.push({ text: w, want: { mains: [k2] } });
      } else if (key === 'allergy') {
        // 메뉴가 있으면 그 메뉴에 안 든 알레르기로 (든 걸 고르면 "다른 메뉴를 골라 주세요"가 맞는 답이라 따로 시험)
        const ok = ALLERGY_WORDS.filter(([w, a]) => w.length >= 2 && (!m || (!m.allergens.contains.includes(a) && !m.allergens.mayContain.includes(a))) && a !== '토마토');
        if (!ok.length) continue;
        const [w, a] = pick(ok);
        parts.push({ text: ALLERGY(w), want: { allergies: [a] } });
      } else if (key === 'drink') {
        const [w, s] = pick(DRINKS);
        parts.push({ text: pick([`${w} 하나`, `음료는 ${w}`, `${w}도`]), want: { extras: [s] } });
      } else if (key === 'salty') {
        const [w, s] = pick(SALTY);
        parts.push({ text: w, want: { salty: s } });
      } else if (key === 'bread') {
        const [w, b] = pick(BREADS);
        parts.push({ text: `${w}빵으로`, want: { bread: b } });
      } else if (key === 'remove') {
        const [w, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨' && x[1] !== vegUsed));
        vegUsed = v;
        parts.push({ text: REMOVE(w), want: { remove: [v] } });
      } else if (key === 'add') {
        const [w, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨' && x[1] !== vegUsed));
        vegUsed = v;
        parts.push({ text: ADD(w), want: { add: [v] } });
      } else if (key === 'sauce') {
        const [w, s] = pick(SAUCES.filter((x) => x[1] !== '핫 칠리'));
        parts.push({ text: SAUCE(w), want: { sauces: [s] } });
      }
    }
    if (parts.length < 2) continue;
    // 장소는 앞, 나머지는 섞음
    const head = parts.filter((p) => p.want.place);
    const rest = parts.filter((p) => !p.want.place);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    // 메뉴는 옵션보다 앞에 (사람은 "에그마요 양파 빼고"라고 말함)
    rest.sort((a, b) => (a.want.menu ? -1 : 0) - (b.want.menu ? -1 : 0));
    const all = [...head, ...rest];
    const text = `${pick(PREFIX)}${all.map((p) => p.text).join(pick([' ', ', ', ' 그리고 ']))}${pick(['', ' 추천해줘', ' 줘', ''])}`;
    const want: Want = {};
    for (const p of all) {
      for (const [k, v] of Object.entries(p.want)) {
        const cur = (want as Record<string, unknown>)[k];
        (want as Record<string, unknown>)[k] = Array.isArray(v) && Array.isArray(cur) ? [...cur, ...v] : v;
      }
    }
    add('L섞기', text, want);
  }
  return cases;
}

// --docs: 사람이 보는 목록
if (process.argv[1]?.endsWith('talk-3000.ts') && process.argv.includes('--docs')) {
  const { loadSubwayCatalog } = await import('../src/catalog/subway-catalog.ts');
  const { writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const list = make3000(loadSubwayCatalog());
  const res: Record<string, string> = existsSync('var/talk-3000-result.json') ? JSON.parse(readFileSync('var/talk-3000-result.json', 'utf8')) : {};
  const groups = [...new Set(list.map((c) => c.group))];
  const lines = [
    '# 말로 주문하기 3,000문장 목록',
    '',
    `> 만든 곳: \`scripts/talk-3000.ts\` (같은 시드라 매번 같은 문장) + 취향 이야기 \`scripts/taste-stories.ts\`. 결과 칸: ✅ 맞음 / ❌ 틀림 (마지막으로 돌린 결과, \`scripts/talk-3000-run.ts\`)`,
    `> 정답 칸: 메뉴·옵션·조건·알레르기·세트/단품·장소·질문·안내 중 그 문장이 알아들어야 하는 것만`,
    '',
    '| 묶음 | 개수 |',
    '|---|---|',
    ...groups.map((g) => `| ${g} | ${list.filter((c) => c.group === g).length} |`),
    `| 합계 | ${list.length} |`,
    '',
  ];
  for (const g of groups) {
    lines.push(`## ${g}`, '', '| 번호 | 문장 | 정답 | 결과 |', '|---|---|---|---|');
    for (const c of list.filter((x) => x.group === g)) lines.push(`| ${c.id} | ${c.text.replace(/\|/g, '/')} | ${JSON.stringify(c.want).replace(/\|/g, '/')} | ${res[c.id] ?? ''} |`);
    lines.push('');
  }
  writeFileSync('docs/검수/3000문장_목록.md', lines.join('\n'));
  console.log(`docs/검수/3000문장_목록.md — ${list.length}문장`);
}
