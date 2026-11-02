// 말로 주문하기 3,000문장 2차 (10/20 저녁, 예형님 요청): 1차(talk-3000.ts)와 겹치지 않는 새 말투로.
// 반말·명령형·말투 오타·줄임말·순서 뒤집기·말 고치기·숫자 표기·대화 이어 말하기·막연한 말("뭐 먹지?")·세트 구성품 꾸밈말·
// 메인 재료 오타("돼직고기")·이상한 입력·시간대. 문장마다 정답이 같이 있고, 대화는 turns(앞 말들)로.
//   npx tsx scripts/talk-3000-2.ts --docs   → docs/검수/3000문장_목록_2차.md
//   npx tsx scripts/talk-3000-run.ts --set 2 [--live 주소]
import type { SubwayCatalog } from '../src/catalog/subway-catalog.ts';
import type { Want } from './talk-cases.ts';
import { make3000, type TalkCase } from './talk-3000.ts';

export interface TalkCase2 extends TalkCase {
  /** 앞에서 한 말 (대화 이어 말하기) — 앞 말의 결과(메뉴·선택·조건)를 context로 넘기고 마지막 말을 본다 */
  before?: string[];
  /** 이 시각에 추천 (시간 규칙) */
  at?: string;
  /** 추천 Top3에 아침 메뉴가 있어야/없어야 */
  top?: 'BREAKFAST' | 'NO_BREAKFAST' | undefined;
}

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

/** 세트 구성품 꾸밈말("야무진 거")일 때 고를 것: 알레르기에 안 걸리는 것 중 열량이 가장 높은 것 */
export function heartiest(catalog: SubwayCatalog, set: string, allergies: readonly string[]): string | null {
  const ok = (contains: readonly string[]) => !allergies.some((a) => contains.includes(a));
  if (set === '수프 음료 세트') return '오늘의 수프'; // 10/21 공식: 그날 매장 수프 (고르지 않음)
  const names: Record<string, string[]> = {
    '쿠키 음료 세트': ['초코칩', '더블 초코칩', '오트밀 레이즌', '라즈베리 치즈케익', '화이트 초코 마카다미아'],
    '웨지 음료 세트': ['웨지 포테이토', 'Cheesy 웨지 포테이토', 'Bacon Cheesy 웨지 포테이토'],
  };
  const xs = (names[set] ?? []).map((n) => ({ n, s: catalog.singles?.find((x) => x.name === n || x.name === `${n} 쿠키`) })).filter((x) => x.s && ok(x.s.allergens.contains));
  return xs.sort((a, b) => (b.s!.nutrition?.energyKcal ?? 0) - (a.s!.nutrition?.energyKcal ?? 0))[0]?.n ?? null;
}

/** seed: 다른 수를 주면 같은 틀로 다른 문장 (학습 시험지용, 10/20) */
export function make3000b(catalog: SubwayCatalog, seed = 20261020 + 2): TalkCase2[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const first = new Set(make3000(catalog).map((c) => c.text));
  const cases: TalkCase2[] = [];
  const seen = new Set<string>();
  const add = (group: string, text: string, want: Want, extra: Partial<TalkCase2> = {}) => {
    const t = text.replace(/\s+/g, ' ').trim();
    const key = `${(extra.before ?? []).join('|')}|${t}`;
    if (!t || seen.has(key) || (!extra.before && first.has(t))) return;
    seen.add(key);
    cases.push({ id: `${group}-${String(cases.filter((c) => c.group === group).length + 1).padStart(3, '0')}`, group, text: t, want, ...extra });
  };

  // ── 말투 (2차): 반말·명령형·말투 오타 ──
  const PREFIX = ['', '', '야 ', '어 ', '흠 ', '아 그 ', '나는 ', '일단 ', '음… ', '저기요 '];
  const ENDS = [' ㄱㄱ', ' 해주셈', ' 주셈', ' 줘봐', ' 콜', ' 고고', ' 해줘라', ' 주라', ' 플리즈', ' 먹고시퍼', ' 먹구싶어', ' 주세여', ' 해쥬세요', ' 해줘용', ' 줘요', ' 먹을게요', ' 먹고 싶다', ' 할래', ''];
  const sw = catalog.menus.filter((m) => m.kind === 'SANDWICH' && m.price.price30cm != null);
  const meals = catalog.menus.filter((m) => m.kind !== 'SIDE' && !/^미니/.test(m.name));
  const ALIAS2: Array<[string, string]> = [
    ['치베아', '치킨 베이컨 아보카도'], ['BMT', '이탈리안 비엠티'], ['이탈리안 BMT', '이탈리안 비엠티'], ['스테이크앤치즈', '스테이크 & 치즈'], ['스테이크 치즈', '스테이크 & 치즈'],
    ['치킨데리야끼', '치킨 데리야끼'], ['데리야끼 치킨', '치킨 데리야끼'], ['에그 마요', '에그마요'], ['참치 샌드위치', '참치'], ['쉬림프 샌드위치', '쉬림프'], ['베지 샌드위치', '베지'],
    ['steak and cheese', '스테이크 & 치즈'], ['egg mayo', '에그마요'], ['tuna', '참치'], ['italian bmt', '이탈리안 비엠티'], ['로티세리 치킨', '로티세리 바비큐 치킨'],
  ];
  const TYPO2: Array<[string, string]> = [
    ['에그마여', '에그마요'], ['참취', '참치'], ['쉬림프으', '쉬림프'], ['로스트 치킹', '로스트 치킨'], ['스테이크 앤 치즤', '스테이크 & 치즈'], ['이탈리안 비엠튀', '이탈리안 비엠티'],
    ['치킨 데리야꾸', '치킨 데리야끼'], ['써브웨이 클러브', '써브웨이 클럽'], ['풀드 포그 바비큐', '풀드포크 바비큐'], ['비앨티', '비엘티'], ['베지이', '베지'], ['피자썹프', '피자썹'],
  ];
  const MAIN_TYPO: Array<[string, string]> = [
    ['돼직고기', '돼지고기'], ['되지고기', '돼지고기'], ['돼지고길', '돼지고기'], ['돼지꼬기', '돼지고기'], ['소고길', '쇠고기'], ['소꼬기', '쇠고기'], ['쇠고길', '쇠고기'], ['닭고길', '닭고기'], ['닭꼬기', '닭고기'], ['닥고기', '닭고기'],
  ];
  const VEGS: Array<[string, string]> = [['양상추', '양상추'], ['토마토', '토마토'], ['오이', '오이'], ['피망', '피망(파프리카)'], ['양파', '양파'], ['피클', '피클'], ['올리브', '올리브'], ['할라피뇨', '할라피뇨']];
  const DRINKS: Array<[string, string, string | null]> = [
    ['콜라', '코카콜라 (355ml)', '콜라'], ['제로콜라', '코카콜라 제로 (355ml)', '제로콜라'], ['사이다', '스프라이트 (355ml)', '사이다'], ['제로사이다', '스프라이트 제로 (355ml)', '제로사이다'],
    ['아메리카노', '아메리카노', '커피'], ['생수', '생수', null], ['닥터페퍼', '닥터페퍼 (355ml)', null], ['토레타', '토레타', null],
  ];
  const SAUCES: Array<[string, string]> = [['랜치', '랜치'], ['스위트 어니언', '스위트 어니언'], ['마요네즈', '마요네즈'], ['스위트 칠리', '스위트 칠리'], ['허니 머스터드', '허니 머스터드'], ['스모크 바비큐', '스모크 바비큐'], ['사우스웨스트 치폴레', '사우스웨스트 치폴레']];
  const BUDGET2: Array<[string, number]> = [['1.2만원 이하', 12000], ['12,000원 이하', 12000], ['1만2천원 이하', 12000], ['만이천 원 이하', 12000], ['1만원 아래로', 10000], ['10,000원 이하', 10000], ['9,000원 안으로', 9000], ['8000원 밑으로', 8000], ['1.5만원 이하', 15000], ['만 오천 원 안쪽', 15000]];
  const ALLERGY2: Array<[string, string]> = [['우유', '우유'], ['계란', '난류'], ['땅콩', '땅콩'], ['대두', '대두'], ['고등어', '고등어'], ['새우', '새우'], ['복숭아', '복숭아'], ['토마토', '토마토'], ['호두', '호두'], ['오징어', '오징어'], ['조개', '조개류'], ['메밀', '메밀']];
  const ALLERGY = (w: string) => pick([`나 ${w}알레르기 있어`, `${w} 알레르기 있음`, `${w} 먹으면 안 돼`, `${w} 알러지임`, `참고로 ${w} 알레르기`]);
  const GOAL2: Array<[string, 'PROTEIN' | 'LIGHT' | 'FILLING']> = [['배고프고', 'FILLING'], ['개배고파', 'FILLING'], ['배고파 죽겠어', 'FILLING'], ['단백질 빵빵하게', 'PROTEIN'], ['단백질 위주로', 'PROTEIN'], ['가볍게 먹을래', 'LIGHT'], ['살 빼는 중이라', 'LIGHT']];
  const SPICY2 = ['맵게 해주고', '맵게 ㄱㄱ', '좀 맵게', '매운 거 땡겨', '맵게 부탁'];
  const name = (m: { name: string }) => m.name;

  // ── A2. 메뉴: 새 별칭·오타·말투 ──
  for (const m of meals) for (let k = 0; k < 2; k++) add('A2메뉴', `${pick(PREFIX)}${m.name}${pick(ENDS)}`, { menu: m.name });
  for (const [a, n] of ALIAS2) for (let k = 0; k < 3; k++) add('A2메뉴', `${pick(PREFIX)}${a}${pick(ENDS)}`, { menu: n });
  for (const [a, n] of TYPO2) for (let k = 0; k < 3; k++) add('A2메뉴', `${pick(PREFIX)}${a}${pick(ENDS)}`, { menu: n });
  // 이모지·영어 섞기
  for (const m of sw.slice(0, 15)) add('A2메뉴', `${pick(['🥪 ', '😋 ', ''])}${m.name} ${pick(['줘 🙏', 'please', '하나요 ㅎㅎ', 'ㄱㄱ 🔥'])}`, { menu: m.name });

  // ── B2. 메인 재료 오타 ──
  for (const [w, k] of MAIN_TYPO) for (let i = 0; i < 9; i++) add('B2재료오타', `${pick(PREFIX)}${ro(w)}${pick([' 먹고시퍼', ' 줘', ' 추천해줘', ' 먹을래', ' ㄱㄱ', ' 들어간 거'])}`, { mains: [k] });
  for (const [w, k] of MAIN_TYPO) add('B2재료오타', `${w} 말고${pick([' 다른 거', ' 추천', ''])}`, { avoid: [k] });

  // ── C2. 세트 구성품 꾸밈말 / 말 안 함 ──
  const SET_WORDS: Array<[string, string]> = [['스프', '수프 음료 세트'], ['수프', '수프 음료 세트'], ['쿠키', '쿠키 음료 세트'], ['웨지', '웨지 음료 세트']];
  const HEARTY = ['야무진거', '야무진 걸로', '든든한 거', '든든한 걸로', '맛있는 거', '아무거나', '알아서', '제일 든든한 거'];
  for (let i = 0; i < 220; i++) {
    const m = pick(sw);
    const [sw2, set] = pick(SET_WORDS);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    const al = r() < 0.4 ? pick(ALLERGY2.filter(([, a]) => !m.allergens.contains.includes(a) && !m.allergens.mayContain.includes(a))) : null;
    const item = heartiest(catalog, set, al ? [al[1]] : []);
    if (!item) continue;
    const t = `${m.name} ${dw}에다가 ${sw2} ${pick(HEARTY)} 하나${pick([' 추가해줘', ' 줘', ' 추가', ''])}${al ? ` ${ALLERGY(al[0])}` : ''}`;
    add('C2세트구성', t, { menu: m.name, set, drink: setDrink!, setItem: item, ...(al ? { allergies: [al[1]] } : {}) });
  }
  for (let i = 0; i < 40; i++) {
    const m = pick(sw);
    const [sw2, set] = pick(SET_WORDS);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    // 웨지는 이름 없이도 기본 웨지 포테이토 (묻지 않음), 수프·쿠키는 어떤 걸로 할지 물음
    add('C2세트구성', `${m.name}에 ${dw}랑 ${sw2} ${pick(['세트로', '하나', '세트'])}`, set === '웨지 음료 세트' ? { menu: m.name, set, drink: setDrink!, setItem: '웨지 포테이토' } : set === '수프 음료 세트' ? { menu: m.name, set, drink: setDrink!, setItem: '오늘의 수프' } : { menu: m.name, set, drink: setDrink!, question: true });
  }

  // ── D2. 숫자 표기 ──
  for (const [w, b] of BUDGET2) for (let k = 0; k < 9; k++) add('D2숫자', `${pick(PREFIX)}${w}${pick([' 추천해줘', '로 골라줘', ' 먹을 거', ' ㄱㄱ', ''])}`, { budget: b });

  // ── E2. 순서 뒤집기 ──
  for (let i = 0; i < 200; i++) {
    const m = pick(sw);
    const [dw, ds] = pick(DRINKS);
    const [vw, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨'));
    const k = Math.floor(r() * 3);
    if (k === 0) add('E2순서', `${dw}랑, 아 그리고 메뉴는 ${m.name}`, { menu: m.name, extras: [ds] });
    else if (k === 1) add('E2순서', `${vw} 빼고, 음 ${m.name}로 할게`, { menu: m.name, remove: [v] });
    else add('E2순서', `${eun(dw)} 하나 주고 샌드위치는 ${m.name}`, { menu: m.name, extras: [ds] });
  }

  // ── F2. 말 고치기 (한 문장 안에서) ──
  for (let i = 0; i < 220; i++) {
    const m = pick(sw);
    const k = Math.floor(r() * 5);
    if (k === 0) {
      const [vw, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨'));
      add('F2말고치기', `${m.name} ${vw} 빼줘 아니다 ${vw} 넣어줘`, { menu: m.name, notRemove: [v] } as Want);
    } else if (k === 1) {
      const a = pick(DRINKS);
      let b = pick(DRINKS);
      if (b[1] === a[1]) b = DRINKS[(DRINKS.indexOf(a) + 1) % DRINKS.length]!;
      add('F2말고치기', `${m.name}에 ${a[0]} 아니 ${ro(b[0])}`, { menu: m.name, extras: [b[1]] });
    } else if (k === 2) add('F2말고치기', `${m.name} 30cm 아니 15cm로`, { menu: m.name, size: '15cm' });
    else if (k === 3) add('F2말고치기', `${m.name} 15cm 아니다 30cm`, { menu: m.name, size: '30cm' });
    else {
      const a = pick(SAUCES);
      let b = pick(SAUCES);
      if (b[1] === a[1]) b = SAUCES[(SAUCES.indexOf(a) + 1) % SAUCES.length]!;
      add('F2말고치기', `${m.name} 소스 ${a[0]} 아니 ${ro(b[0])}`, { menu: m.name, sauces: [b[1]] });
    }
  }

  // ── G2. 대화 이어 말하기 (앞에서 고른 건 그대로, 바꾼 것만) ──
  for (let i = 0; i < 200; i++) {
    const m = pick(sw);
    const [vw, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨'));
    const [sname, sauce] = pick(SAUCES);
    const k = Math.floor(r() * 6);
    const first1 = `${m.name} ${vw} 빼고 ${sname} 소스로`;
    if (k === 0) add('G2대화', `아니 ${eun(vw)} 넣어줘`, { menu: m.name, notRemove: [v], sauces: [sauce] } as Want, { before: [first1] });
    else if (k === 1) add('G2대화', pick(['30cm로 바꿔', '30으로 해줘', '큰 걸로 바꿔줘']), { menu: m.name, size: '30cm', remove: [v], sauces: [sauce] }, { before: [first1] });
    else if (k === 2) {
      const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
      add('G2대화', `세트 말고 단품으로`, { menu: m.name, set: null, remove: [v] }, { before: [`${m.name} ${vw} 빼고 쿠키 세트로 ${dw}`] });
      void setDrink;
    } else if (k === 3) {
      const [dw, ds] = pick(DRINKS);
      add('G2대화', `${dw}도 추가해줘`, { menu: m.name, extras: [ds], remove: [v], sauces: [sauce] }, { before: [first1] });
    } else if (k === 4) {
      const [s2, sauce2] = pick(SAUCES.filter((x) => x[1] !== sauce));
      add('G2대화', `소스 ${ro(s2)} 바꿔`, { menu: m.name, sauces: [sauce2], remove: [v] }, { before: [first1] });
    } else {
      const [w2, v2] = pick(VEGS.filter((x) => x[1] !== v && x[1] !== '할라피뇨'));
      add('G2대화', `${w2}도 빼줘`, { menu: m.name, remove: [v, v2], sauces: [sauce] }, { before: [first1] });
    }
  }

  // ── H2. 막연한 말 ("뭐 먹지?") ──
  const VAGUE = [
    '뭐 먹지', '뭐 먹지?', '아 나 뭐 먹을까?', '뭐 먹을까', '오늘 뭐 먹지', '오늘 뭐먹을지 추천해줘', '오늘 뭐먹을지 추턴해줘', '오늘 뭐 먹어', '뭐가 좋아?', '메뉴 골라줘', '아무거나 추천해줘', '배고픈데 뭐 먹지',
    '점심 뭐 먹지', '저녁 뭐 먹지', '오늘 저녁 뭐가 좋아?', '머먹지', '뭐먹징', '뭐 먹을지 모르겠어', '추천 좀', '골라줘', '뭐 먹는 게 좋을까요', '오늘 뭐 먹을까요?', '메뉴 추천해 주세요', '아무거나 골라줘',
    '뭐 먹을지 추천 좀 해줘', '오늘 점심 추천', '야 뭐 먹냐', '뭐 먹으면 좋을까', '배고파 뭐 먹지', '저녁 메뉴 추천', '아침 뭐 먹지', '추천해 줄래?', '뭐 맛있어?', '뭐가 맛있어', '오늘의 추천은?', '아무거나',
  ];
  for (const w of VAGUE) {
    // 아침 말은 아침 시간에 (점심에 "아침 뭐 먹지"면 아침 메뉴가 끝나서 추천이 없는 게 맞음)
    const at = /아침/.test(w) ? { at: '2026-10-21T08:30:00+09:00' } : {};
    add('H2막연', w, { vague: true } as Want, at);
    add('H2막연', `${pick(['음 ', '아 ', '흠 ', '그냥 '])}${w}`, { vague: true } as Want, at);
  }
  for (let i = 0; i < 90; i++) {
    const [w, k] = pick([['매운 거', 'spicy'], ['단백질 많은 거', 'goal'], ['만원 이하', 'budget'], ['샐러드로', 'kinds']] as const);
    const v = pick(VAGUE.slice(0, 15));
    const want: Want = { vague: true } as Want;
    if (k === 'spicy') want.spicy = 'want';
    if (k === 'goal') want.goal = 'PROTEIN';
    if (k === 'budget') want.budget = 10000;
    if (k === 'kinds') want.kinds = ['SALAD', 'GRAIN_SALAD'];
    add('H2막연', r() < 0.5 ? `${v} ${w}` : `${w} ${v}`, want);
  }
  for (const w of ['asdf', '날씨 어때', 'ㅁㄴㅇㄹ', '너 몇 살이야', '오늘 주식 어때']) add('H2막연', w, { vague: false } as Want);

  // ── I2. 시간대 (추천 Top3) ──
  for (const w of ['아침 뭐 먹지', '아침 메뉴 추천', '모닝 메뉴', '아침이라 가볍게']) {
    add('I2시간', w, {}, { at: '2026-10-21T08:20:00+09:00', top: 'BREAKFAST' });
    add('I2시간', `${w} 줘`, {}, { at: '2026-10-21T09:40:00+09:00', top: 'BREAKFAST' });
  }
  for (const w of ['점심 추천해줘', '뭐 먹지', '저녁 뭐 먹지', '든든하게']) {
    add('I2시간', w, {}, { at: '2026-10-21T13:10:00+09:00', top: 'NO_BREAKFAST' });
    add('I2시간', `${w} ㄱㄱ`, {}, { at: '2026-10-21T19:30:00+09:00', top: 'NO_BREAKFAST' });
  }

  // ── J2. 예형님 문장 + 비슷하게 섞은 것 ──
  add('J2예형님', '나 지금 배고프고 돼직고기로 먹고시퍼 맵게 해주고 제로콜라에다가 스프 야무진거 하나 추가해주고 나 고등어알레르기 있어', {
    goal: 'FILLING', mains: ['돼지고기'], spicy: 'want', allergies: ['고등어'], set: '수프 음료 세트', drink: '제로콜라', setItem: heartiest(catalog, '수프 음료 세트', ['고등어'])!,
  });
  for (let i = 0; i < 80; i++) {
    const [gw, g] = pick(GOAL2);
    const [mw, mk] = pick(MAIN_TYPO);
    const sp = pick(SPICY2);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    const [sw2, set] = pick(SET_WORDS);
    const [aw, a] = pick(ALLERGY2.filter(([, x]) => x !== mk && x !== '토마토'));
    const item = heartiest(catalog, set, [a]);
    if (!item) continue;
    add('J2예형님', `${pick(['나 지금 ', '아 ', ''])}${gw} ${ro(mw)} ${pick(['먹고시퍼', '먹구싶어', '먹고 싶어'])} ${sp} ${dw}에다가 ${sw2} ${pick(HEARTY)} 하나 추가해주고 ${ALLERGY(aw)}`, {
      goal: g, mains: [mk], spicy: 'want', allergies: [a], set, drink: setDrink!, setItem: item,
    });
  }

  // ── K2. 이상한 입력 ──
  add('K2이상한', '에그마요 '.repeat(33).trim().slice(0, 299), { menu: '에그마요' });
  add('K2이상한', `${'아 진짜 배고프다 '.repeat(15)}에그마요 줘`.slice(0, 299), { menu: '에그마요' });
  for (const w of ['🥪🥪🥪', '😀', '12000', '0원', '-1', '999999999원 이하', '<script>alert(1)</script>', 'DROP TABLE menus;', '...', '　', 'ㅇㅇ', 'ㄴㄴ', '?!?!', '\\n\\n', '빵빵빵빵빵']) add('K2이상한', w, {});

  // ── L2. 섞기 (새 말투 낱말로) ──
  const target = 2900;
  let guard = 0;
  while (cases.length < target && guard++ < 40000) {
    const parts: Array<{ text: string; want: Want }> = [];
    const m = r() < 0.6 ? pick(sw) : null;
    if (m) parts.push({ text: r() < 0.3 ? pick(ALIAS2.filter(([, n]) => n === m.name).map(([a]) => a).concat([m.name])) : m.name, want: { menu: m.name } });
    const used = new Set<string>();
    let vegUsed = '';
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const key = pick(m ? ['budget', 'goal', 'spicy', 'allergy', 'drink', 'remove', 'add', 'sauce', 'set'] : ['budget', 'goal', 'spicy', 'mains', 'allergy', 'drink']);
      if (used.has(key)) continue;
      if ((key === 'spicy' && (used.has('remove') || used.has('add'))) || ((key === 'remove' || key === 'add') && used.has('spicy'))) continue;
      if ((key === 'set' && used.has('drink')) || (key === 'drink' && used.has('set'))) continue;
      used.add(key);
      if (key === 'budget') {
        const [w, b] = pick(BUDGET2);
        parts.push({ text: w, want: { budget: b } });
      } else if (key === 'goal') {
        const [w, g] = pick(GOAL2);
        parts.push({ text: w, want: { goal: g } });
      } else if (key === 'spicy') parts.push({ text: pick(SPICY2), want: { spicy: 'want' } });
      else if (key === 'mains') {
        const [w, k2] = pick([...MAIN_TYPO, ['소고기', '쇠고기'], ['치킨', '닭고기'], ['돼지고기', '돼지고기']] as Array<[string, string]>);
        parts.push({ text: `${ro(w)} ${pick(['먹고시퍼', '줘', ''])}`, want: { mains: [k2] } });
      } else if (key === 'allergy') {
        const ok = ALLERGY2.filter(([, a]) => a !== '토마토' && (!m || (!m.allergens.contains.includes(a) && !m.allergens.mayContain.includes(a))));
        if (!ok.length) continue;
        const [w, a] = pick(ok);
        parts.push({ text: ALLERGY(w), want: { allergies: [a] } });
      } else if (key === 'drink') {
        const [w, s] = pick(DRINKS);
        parts.push({ text: pick([`${w} 하나 주셈`, `마실 건 ${w}`, `${w}도 ㄱㄱ`]), want: { extras: [s] } });
      } else if (key === 'remove') {
        const [w, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨' && x[1] !== vegUsed));
        vegUsed = v;
        parts.push({ text: pick([`${w}는 빼주셈`, `${w} 빼줘라`, `${w} ㄴㄴ`, `${w} 노노`]), want: { remove: [v] } });
      } else if (key === 'add') {
        const [w, v] = pick(VEGS.filter((x) => x[1] !== '할라피뇨' && x[1] !== vegUsed));
        vegUsed = v;
        parts.push({ text: pick([`${w} 왕창`, `${w} 많이 많이`, `${w} 듬뿍 ㄱㄱ`]), want: { add: [v] } });
      } else if (key === 'sauce') {
        const [w, s] = pick(SAUCES);
        parts.push({ text: pick([`소스 ${w}`, `${w} 뿌려줘`, `${w} 소스 ㄱㄱ`]), want: { sauces: [s] } });
      } else if (key === 'set') {
        const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
        const [sw2, set] = pick(SET_WORDS);
        const item = heartiest(catalog, set, []);
        parts.push({ text: `${dw}에다가 ${sw2} ${pick(HEARTY)} 하나`, want: { set, drink: setDrink!, setItem: item! } });
      }
    }
    if (parts.length < 2) continue;
    const head = parts.filter((p) => p.want.menu);
    const rest = parts.filter((p) => !p.want.menu);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
    const all = [...head, ...rest];
    const text = `${pick(PREFIX)}${all.map((p) => p.text).join(pick([' ', ', ', ' 그리고 ', ' 또 ']))}${pick(['', ' ㄱㄱ', ' 해주셈', ' 부탁', ''])}`;
    const want: Want = {};
    for (const p of all)
      for (const [k, v] of Object.entries(p.want)) {
        const cur = (want as Record<string, unknown>)[k];
        (want as Record<string, unknown>)[k] = Array.isArray(v) && Array.isArray(cur) ? [...cur, ...v] : v;
      }
    // 알레르기가 있으면 세트 구성품도 알레르기를 피해서
    if (want.setItem && want.allergies?.length) {
      const item = heartiest(catalog, want.set!, want.allergies);
      if (!item) continue;
      want.setItem = item;
    }
    add('L2섞기', text, want);
  }
  void name;
  return cases;
}

if (process.argv[1]?.endsWith('talk-3000-2.ts') && process.argv.includes('--docs')) {
  const { loadSubwayCatalog } = await import('../src/catalog/subway-catalog.ts');
  const { writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const list = make3000b(loadSubwayCatalog());
  const res: Record<string, string> = existsSync('var/talk-3000-2-result.json') ? JSON.parse(readFileSync('var/talk-3000-2-result.json', 'utf8')) : {};
  const groups = [...new Set(list.map((c) => c.group))];
  const lines = [
    '# 말로 주문하기 3,000문장 목록 — 2차 (10/20 저녁)',
    '',
    '> 만든 곳: `scripts/talk-3000-2.ts` (1차와 겹치는 문장 없음) + 취향 이야기 `scripts/taste-stories-2.ts`. 결과: ✅ 맞음 / ❌ 틀림 (마지막으로 돌린 결과)',
    '> 문장마다 같이 보는 것: 알아들은 값 + 주문서가 만들어짐 · 알레르기 성분이 주문서에 없음 · 금액이 공식 가격과 같음 · 매장에 넘기는 글이 주문서와 같음 · (메뉴를 안 골랐으면) 추천 Top3가 조건을 지킴',
    '',
    '| 묶음 | 개수 |',
    '|---|---|',
    ...groups.map((g) => `| ${g} | ${list.filter((c) => c.group === g).length} |`),
    `| 합계 | ${list.length} |`,
    '',
  ];
  for (const g of groups) {
    lines.push(`## ${g}`, '', '| 번호 | 앞에서 한 말 | 문장 | 정답 | 결과 |', '|---|---|---|---|---|');
    for (const c of list.filter((x) => x.group === g)) lines.push(`| ${c.id} | ${(c.before ?? []).join(' → ').replace(/\|/g, '/')} | ${c.text.replace(/\|/g, '/')}${c.at ? ` (${c.at.slice(11, 16)})` : ''} | ${JSON.stringify(c.want).replace(/\|/g, '/')}${c.top ? ` top:${c.top}` : ''} | ${res[c.id] ?? ''} |`);
    lines.push('');
  }
  writeFileSync('docs/검수/3000문장_목록_2차.md', lines.join('\n'));
  console.log(`docs/검수/3000문장_목록_2차.md — ${list.length}문장`);
}
