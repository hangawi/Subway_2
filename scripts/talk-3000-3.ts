// 말로 주문하기 3,000문장 3차 (10/21 아침, 예형님 요청): 1·2차와 겹치지 않는 말투로.
// 사투리(경상·전라·충청)·긴 수다 섞인 말·질문 섞기("칼로리 얼마야? 그거 줘")·애매한 말("아무거나 근데 매운 건 별로")·다른 별칭 +
// 예형님 추가 항목(메인 재료·말투 오타, 세트 구성품 꾸밈말, 막연한 말, 말 고치기, 대화 이어 말하기, 시간대, 이상한 입력)
//   npx tsx scripts/talk-3000-3.ts --docs   → docs/검수/3000문장_목록_3차.md
//   npx tsx scripts/talk-3000-run2.ts --set 3 [--live 주소]
import type { SubwayCatalog } from '../src/catalog/subway-catalog.ts';
import type { Want } from './talk-cases.ts';
import { make3000 } from './talk-3000.ts';
import { heartiest, make3000b, type TalkCase2 } from './talk-3000-2.ts';

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

export function make3000c(catalog: SubwayCatalog, seed = 20261021): TalkCase2[] {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  const before = new Set([...make3000(catalog).map((c) => c.text), ...make3000b(catalog).map((c) => c.text)]);
  const cases: TalkCase2[] = [];
  const seen = new Set<string>();
  const add = (group: string, text: string, want: Want, extra: Partial<TalkCase2> = {}) => {
    const t = text.replace(/\s+/g, ' ').trim();
    const key = `${(extra.before ?? []).join('|')}|${t}`;
    if (!t || seen.has(key) || (!extra.before && before.has(t))) return;
    seen.add(key);
    cases.push({ id: `${group}-${String(cases.filter((c) => c.group === group).length + 1).padStart(3, '0')}`, group, text: t, want, ...extra });
  };

  // ── 말투 (3차): 사투리·수다 ──
  const DIALECT_END = [' 주이소', ' 해주이소', ' 주소', ' 도', ' 줘라', ' 주쇼잉', ' 해주쇼', ' 줘유', ' 주세유', ' 해줘유', ' 묵을끼다', ' 묵고 싶다', ' 무울래', ' 주라마', ' 해도', ' 주실래요', ' 좀 해주실 수 있나요', ''];
  const CHATTY_HEAD = ['오늘 회사에서 진짜 힘들었는데 그래서 말인데 ', '아 진짜 오늘 하루 길었다 ', '친구가 맛있다 그래서 ', '지난주에 먹었던 거 생각나서 ', '점심시간 얼마 안 남았는데 ', '요즘 좀 바빠서 대충 ', '아까부터 생각했는데 '];
  const CHATTY_TAIL = [' 빨리 부탁해요', ' 그럼 이걸로 할게요', ' 고마워요', ' 감사합니다', ' 잘 부탁드려요', ''];
  const sw = catalog.menus.filter((m) => m.kind === 'SANDWICH' && m.price.price30cm != null);
  const meals = catalog.menus.filter((m) => m.kind !== 'SIDE' && !/^미니/.test(m.name));
  const ALIAS3: Array<[string, string]> = [
    ['에그마요샌드', '에그마요'], ['에그마요 샌드위치', '에그마요'], ['쉬림프샌드', '쉬림프'], ['스테이크치즈샌드', '스테이크 & 치즈'], ['BLT 샌드위치', '비엘티'], ['로티세리 바베큐 치킨', '로티세리 바비큐 치킨'],
    ['이탈리안 비엠티 샌드위치', '이탈리안 비엠티'], ['참치샌드', '참치'], ['클럽 샌드위치', '써브웨이 클럽'], ['데리야끼 샌드위치', '치킨 데리야끼'], ['풀드 포크', '풀드포크 바비큐'], ['비엠티 샌드위치', '이탈리안 비엠티'],
  ];
  const TYPO3: Array<[string, string]> = [
    ['에구마요', '에그마요'], ['참치이', '참치'], ['스테이크 앤드 치즈', '스테이크 & 치즈'], ['로스트 치큰', '로스트 치킨'], ['이태리안 비엠티', '이탈리안 비엠티'], ['써브웨이 클럼', '써브웨이 클럽'],
    ['쉬림프', '쉬림프'], ['치킨 테리야끼', '치킨 데리야끼'], ['비에엘티', '비엘티'], ['베쥐', '베지'], ['피자쌉', '피자썹'], ['풀드포크 바베큐', '풀드포크 바비큐'],
  ];
  const MAIN_TYPO3: Array<[string, string]> = [['돼지괴기', '돼지고기'], ['돼지거기', '돼지고기'], ['소괴기', '쇠고기'], ['소고깃', '쇠고기'], ['쇠괴기', '쇠고기'], ['닭괴기', '닭고기'], ['닭거기', '닭고기'], ['닥고기', '닭고기']];
  const VEGS: Array<[string, string]> = [['양상추', '양상추'], ['토마토', '토마토'], ['오이', '오이'], ['피망', '피망(파프리카)'], ['양파', '양파'], ['피클', '피클'], ['올리브', '올리브']];
  const DRINKS: Array<[string, string, string | null]> = [
    ['콜라', '코카콜라 (355ml)', '콜라'], ['제로콜라', '코카콜라 제로 (355ml)', '제로콜라'], ['사이다', '스프라이트 (355ml)', '사이다'], ['제로사이다', '스프라이트 제로 (355ml)', '제로사이다'],
    ['아메리카노', '아메리카노', '커피'], ['아이스 아메리카노', '아이스 아메리카노', '커피'], ['생수', '생수', null], ['닥터페퍼', '닥터페퍼 (355ml)', null],
  ];
  const SAUCES: Array<[string, string]> = [['랜치', '랜치'], ['스위트 어니언', '스위트 어니언'], ['마요네즈', '마요네즈'], ['스위트 칠리', '스위트 칠리'], ['허니 머스터드', '허니 머스터드'], ['스모크 바비큐', '스모크 바비큐'], ['홀스래디쉬', '홀스래디쉬']];
  const BUDGET3: Array<[string, number]> = [['만원 넘으면 안 돼', 10000], ['만 원 안 넘게', 10000], ['구천 원 정도까지', 9000], ['만이천원 안쪽', 12000], ['칠천원까지만', 7000], ['만 오천 원 넘지 않게', 15000], ['팔천 원 이내로', 8000]];
  const ALLERGY3: Array<[string, string]> = [['우유', '우유'], ['계란', '난류'], ['땅콩', '땅콩'], ['대두', '대두'], ['고등어', '고등어'], ['새우', '새우'], ['복숭아', '복숭아'], ['호두', '호두'], ['오징어', '오징어'], ['조개', '조개류'], ['메밀', '메밀']];
  const ALLERGY = (w: string) => pick([`${w} 알레르기 있다`, `${w} 알레르기 있어예`, `${w} 먹으면 큰일 나`, `${w}는 못 묵는다`, `${w} 알러지 있거든요`]);
  const GOAL3: Array<[string, 'PROTEIN' | 'LIGHT' | 'FILLING']> = [['억수로 배고프다', 'FILLING'], ['겁나 배고파', 'FILLING'], ['배고파 디지겠다', 'FILLING'], ['단백질 마이 든 거', 'PROTEIN'], ['다이어트 하는 중이라예', 'LIGHT'], ['가볍게 묵을래', 'LIGHT'], ['든든하게 묵자', 'FILLING']];
  const SPICY3 = ['맵게 해도', '좀 맵게 해주이소', '매운 거 억수로 좋아한다', '맵게 해줘유', '매운 거 넣어주쇼'];
  const SPICY3_AVOID = ['안 맵게 해주이소', '매운 거는 못 묵는다', '맵게는 하지 마', '안 매운 걸로 해줘유'];

  // ── A3. 메뉴: 사투리·별칭·오타 ──
  for (const m of meals) for (let k = 0; k < 2; k++) add('A3메뉴', `${m.name}${pick(DIALECT_END)}`, { menu: m.name });
  for (const [a, n] of ALIAS3) for (let k = 0; k < 3; k++) add('A3메뉴', `${a}${pick(DIALECT_END)}`, { menu: n });
  for (const [a, n] of TYPO3) for (let k = 0; k < 3; k++) add('A3메뉴', `${a}${pick(DIALECT_END)}`, { menu: n });

  // ── B3. 메인 재료 오타 (사투리 "괴기") ──
  for (const [w, k] of MAIN_TYPO3) for (let i = 0; i < 9; i++) add('B3재료오타', `${ro(w)}${pick([' 묵고 싶다', ' 주이소', ' 추천해줘유', ' 들어간 거', ' 된 거'])}`, { mains: [k] });
  for (const [w, k] of MAIN_TYPO3) add('B3재료오타', `${eun(w)} 빼고${pick([' 추천', ' 다른 거', ''])}`, { avoid: [k] });

  // ── C3. 긴 수다 섞인 말 ──
  for (let i = 0; i < 200; i++) {
    const m = pick(sw);
    const k = Math.floor(r() * 4);
    if (k === 0) add('C3수다', `${pick(CHATTY_HEAD)}${m.name}${pick(CHATTY_TAIL)}`, { menu: m.name });
    else if (k === 1) {
      const [vw, v] = pick(VEGS);
      add('C3수다', `${pick(CHATTY_HEAD)}${m.name} 하나 먹을 건데 ${vw} 빼주세요${pick(CHATTY_TAIL)}`, { menu: m.name, remove: [v] });
    } else if (k === 2) {
      const [gw, g] = pick(GOAL3);
      add('C3수다', `${pick(CHATTY_HEAD)}${gw} 뭐 추천해 줄래요${pick(CHATTY_TAIL)}`, { goal: g });
    } else {
      const okA = ALLERGY3.filter(([, x]) => !m.allergens.contains.includes(x) && !m.allergens.mayContain.includes(x));
      if (!okA.length) continue;
      const [aw, a] = pick(okA);
      add('C3수다', `${pick(CHATTY_HEAD)}${m.name} 먹고 싶은데 참고로 ${ALLERGY(aw)}${pick(CHATTY_TAIL)}`, { menu: m.name, allergies: [a] });
    }
  }

  // ── D3. 질문 섞기 ("칼로리 얼마야? 그거 줘") ──
  for (let i = 0; i < 160; i++) {
    const m = pick(sw);
    const k = Math.floor(r() * 4);
    if (k === 0) add('D3질문섞기', `${m.name} 칼로리 얼마야? 그거 줘`, { menu: m.name });
    else if (k === 1) add('D3질문섞기', `${m.name} 맵나? 맵게 해줘`, { menu: m.name, spicy: 'want' });
    else if (k === 2) {
      const [dw, ds] = pick(DRINKS);
      add('D3질문섞기', `음료 뭐 있어? ${dw} 있으면 ${dw} 하나랑 ${m.name}`, { menu: m.name, extras: [ds] });
    } else {
      const [vw, v] = pick(VEGS);
      add('D3질문섞기', `${m.name}에 ${vw} 들어가? 들어가면 빼줘`, { menu: m.name, remove: [v] });
    }
  }

  // ── E3. 애매한 말 ──
  const VAGUE3: Array<[string, Want]> = [
    ['아무거나 근데 매운 건 별로', { vague: true, spicy: 'avoid' } as Want],
    ['뭐든 괜찮은데 고기는 빼고', { vague: true, avoid: ['쇠고기', '닭고기', '돼지고기'] } as Want],
    ['적당히 배부른 거', { goal: 'FILLING' }],
    ['너무 짜지 않은 걸로 아무거나', { vague: true, sodium: 700 } as Want],
    ['대충 괜찮은 거 하나 골라줘', { vague: true } as Want],
    ['아무거나 근데 소고기면 좋겠어', { vague: true, mains: ['쇠고기'] } as Want],
    ['뭐가 맛있는지 몰라서 그러는데 추천 좀', { vague: true } as Want],
    ['평범한 걸로 아무거나', { vague: true } as Want],
    ['배는 별로 안 고픈데 뭐 먹지', { vague: true, goal: 'LIGHT' } as Want],
    ['뭐 먹을지 고민되네 매운 거?', { vague: true, spicy: 'want' } as Want],
    ['오늘은 그냥 알아서 해줘', { vague: true } as Want],
    ['아무거나 근데 샐러드는 싫어', { vague: true, kinds: ['SANDWICH', 'WRAP', 'MORNING_SANDWICH', 'MORNING_WRAP'] } as Want],
    ['뭐 묵꼬', { vague: true } as Want],
    ['뭐 묵을래', { vague: true } as Want],
    ['머 무까', { vague: true } as Want],
    ['오늘 뭐 묵지', { vague: true } as Want],
    ['뭐 먹을까예', { vague: true } as Want],
    ['뭐 묵을지 추천해주이소', { vague: true } as Want],
    ['뭐 먹어야 할지 모르겠어유', { vague: true } as Want],
  ];
  for (const [w, want] of VAGUE3) for (const t of [w, `${pick(['음 ', '아 ', '흠 ', '그냥 ', ''])}${w}`, `${pick(CHATTY_HEAD)}${w}`]) add('E3애매', t, want);
  for (const w of ['오늘 비 오네', '너 뭐 할 줄 알아', 'ㅎㅇ', '안녕하세요', '심심해']) add('E3애매', w, { vague: false } as Want);

  // ── F3. 세트 구성품 (사투리 꾸밈말) ──
  const SET_WORDS: Array<[string, string]> = [['스프', '수프 음료 세트'], ['수프', '수프 음료 세트'], ['쿠키', '쿠키 음료 세트'], ['웨지', '웨지 음료 세트']];
  const HEARTY3 = ['든든한 걸로', '맛있는 걸로', '아무거나', '알아서', '야무진 걸로', '제일 든든한 거'];
  for (let i = 0; i < 200; i++) {
    const m = pick(sw);
    const [sw2, set] = pick(SET_WORDS);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    const okA = ALLERGY3.filter(([, a]) => !m.allergens.contains.includes(a) && !m.allergens.mayContain.includes(a));
    const al = r() < 0.4 && okA.length ? pick(okA) : null;
    const item = heartiest(catalog, set, al ? [al[1]] : []);
    if (!item) continue;
    add('F3세트구성', `${m.name}에 ${dw}랑 ${sw2}는 ${pick(HEARTY3)} 하나${pick([' 주이소', ' 해주쇼', ' 줘유', ''])}${al ? ` ${ALLERGY(al[0])}` : ''}`, { menu: m.name, set, drink: setDrink!, setItem: item, ...(al ? { allergies: [al[1]] } : {}) });
  }

  // ── G3. 말 고치기 ("아니"·"아이다"·"말고") ──
  for (let i = 0; i < 160; i++) {
    const m = pick(sw);
    const k = Math.floor(r() * 4);
    if (k === 0) {
      const a = pick(DRINKS);
      let b = pick(DRINKS);
      if (b[1] === a[1]) b = DRINKS[(DRINKS.indexOf(a) + 1) % DRINKS.length]!;
      add('G3말고치기', `${m.name}에 ${a[0]} 아니다 ${ro(b[0])} 주이소`, { menu: m.name, extras: [b[1]] });
    } else if (k === 1) add('G3말고치기', `${m.name} 15cm 아니 30cm로 해줘유`, { menu: m.name, size: '30cm' });
    else if (k === 2) {
      const a = pick(SAUCES);
      let b = pick(SAUCES);
      if (b[1] === a[1]) b = SAUCES[(SAUCES.indexOf(a) + 1) % SAUCES.length]!;
      add('G3말고치기', `${m.name} 소스는 ${a[0]} 아니 ${ro(b[0])}`, { menu: m.name, sauces: [b[1]] });
    } else {
      const [vw, v] = pick(VEGS);
      add('G3말고치기', `${m.name} ${vw} 빼줘 아니다 그냥 넣어줘`, { menu: m.name, notRemove: [v] } as Want);
    }
  }

  // ── H3. 대화 이어 말하기 (사투리) ──
  for (let i = 0; i < 160; i++) {
    const m = pick(sw);
    const [vw, v] = pick(VEGS);
    const [sname, sauce] = pick(SAUCES);
    const first = `${m.name} ${vw} 빼고 ${sname} 소스`;
    const k = Math.floor(r() * 4);
    if (k === 0) add('H3대화', `${vw}는 다시 넣어주이소`, { menu: m.name, notRemove: [v], sauces: [sauce] } as Want, { before: [first] });
    else if (k === 1) add('H3대화', pick(['30으로 바꿔도', '큰 걸로 바꿔주쇼', '30cm로 해줘유']), { menu: m.name, size: '30cm', remove: [v] }, { before: [first] });
    else if (k === 2) {
      const [dw, ds] = pick(DRINKS);
      add('H3대화', `${dw}도 하나 주이소`, { menu: m.name, extras: [ds], remove: [v] }, { before: [first] });
    } else {
      const [w2, v2] = pick(VEGS.filter((x) => x[1] !== v));
      add('H3대화', `${w2}도 빼도`, { menu: m.name, remove: [v, v2] }, { before: [first] });
    }
  }

  // ── I3. 시간대 ──
  for (const w of ['아침 뭐 묵지', '아침이라 간단하게', '아침 메뉴 주이소']) {
    add('I3시간', w, {}, { at: '2026-10-22T08:10:00+09:00', top: 'BREAKFAST' });
    add('I3시간', `${w} 빨리`, {}, { at: '2026-10-22T10:20:00+09:00', top: 'BREAKFAST' });
  }
  for (const w of ['점심 뭐 묵지', '저녁 뭐 묵을까', '배고파 디지겠다']) {
    add('I3시간', w, {}, { at: '2026-10-22T12:40:00+09:00', top: 'NO_BREAKFAST' });
    add('I3시간', `${w} 추천`, {}, { at: '2026-10-22T20:10:00+09:00', top: 'NO_BREAKFAST' });
  }

  // ── J3. 예형님 문장 사투리 버전 ──
  for (let i = 0; i < 80; i++) {
    const [gw, g] = pick(GOAL3);
    const [mw, mk] = pick(MAIN_TYPO3);
    const sp = pick(SPICY3);
    const [dw, , setDrink] = pick(DRINKS.filter((d) => d[2]));
    const [sw2, set] = pick(SET_WORDS);
    const [aw, a] = pick(ALLERGY3.filter(([, x]) => x !== mk));
    const item = heartiest(catalog, set, [a]);
    if (!item) continue;
    add('J3예형님', `${pick(['내 지금 ', '아 ', ''])}${gw} ${ro(mw)} ${pick(['묵고 싶다', '묵고잡다', '먹고 싶어유'])} ${sp} ${dw}에다가 ${sw2} ${pick(HEARTY3)} 하나 추가해주고 ${ALLERGY(aw)}`, { goal: g, mains: [mk], spicy: 'want', allergies: [a], set, drink: setDrink!, setItem: item });
  }

  // ── K3. 이상한 입력 ──
  // 메뉴 이름이 들어 있으면 그 메뉴 (이상한 모양이어도)
  for (const [w, menu] of [['ㅋㅋㅋㅋㅋ 에그마요', '에그마요'], ['에그마요!!!!!!!', '에그마요'], ['   참치   ', '참치'], ['STEAK AND CHEESE', '스테이크 & 치즈'], ['Egg Mayo please', '에그마요'], ['<b>참치</b>', '참치']] as const) add('K3이상한', w, { menu });
  for (const w of ['🥪 줘', '1', '???', '...!!!']) add('K3이상한', w, {});

  // ── L3. 섞기 ──
  let guard = 0;
  while (cases.length < 2900 && guard++ < 40000) {
    const parts: Array<{ text: string; want: Want }> = [];
    const m = r() < 0.6 ? pick(sw) : null;
    if (m) parts.push({ text: r() < 0.3 ? pick(ALIAS3.filter(([, n]) => n === m.name).map(([x]) => x).concat([m.name])) : m.name, want: { menu: m.name } });
    const used = new Set<string>();
    let vegUsed = '';
    const n = 1 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const key = pick(m ? ['budget', 'goal', 'spicy', 'avoidSpicy', 'allergy', 'drink', 'remove', 'add', 'sauce'] : ['budget', 'goal', 'spicy', 'avoidSpicy', 'mains', 'allergy', 'drink']);
      if (used.has(key) || ((key === 'spicy' || key === 'avoidSpicy') && (used.has('spicy') || used.has('avoidSpicy') || used.has('remove') || used.has('add'))) || ((key === 'remove' || key === 'add') && (used.has('spicy') || used.has('avoidSpicy')))) continue;
      used.add(key);
      if (key === 'budget') {
        const [w, b] = pick(BUDGET3);
        parts.push({ text: w, want: { budget: b } });
      } else if (key === 'goal') {
        const [w, g] = pick(GOAL3);
        parts.push({ text: w, want: { goal: g } });
      } else if (key === 'spicy') parts.push({ text: pick(SPICY3), want: { spicy: 'want' } });
      else if (key === 'avoidSpicy') parts.push({ text: pick(SPICY3_AVOID), want: { spicy: 'avoid' } });
      else if (key === 'mains') {
        const [w, k2] = pick([...MAIN_TYPO3, ['소고기', '쇠고기'], ['닭고기', '닭고기']] as Array<[string, string]>);
        parts.push({ text: `${ro(w)} ${pick(['묵고 싶다', '주이소', ''])}`, want: { mains: [k2] } });
      } else if (key === 'allergy') {
        const ok = ALLERGY3.filter(([, a]) => !m || (!m.allergens.contains.includes(a) && !m.allergens.mayContain.includes(a)));
        if (!ok.length) continue;
        const [w, a] = pick(ok);
        parts.push({ text: ALLERGY(w), want: { allergies: [a] } });
      } else if (key === 'drink') {
        const [w, s] = pick(DRINKS);
        parts.push({ text: pick([`${w} 하나 주이소`, `${w}도 줘유`, `마실 거는 ${w}`]), want: { extras: [s] } });
      } else if (key === 'remove') {
        const [w, v] = pick(VEGS.filter((x) => x[1] !== vegUsed));
        vegUsed = v;
        parts.push({ text: pick([`${eun(w)} 빼주이소`, `${w} 빼도`, `${w} 빼줘유`, `${eun(w)} 넣지 마이소`]), want: { remove: [v] } });
      } else if (key === 'add') {
        const [w, v] = pick(VEGS.filter((x) => x[1] !== vegUsed));
        vegUsed = v;
        parts.push({ text: pick([`${w} 마이 넣어주이소`, `${w} 억수로 많이`, `${w} 듬뿍 해줘유`]), want: { add: [v] } });
      } else if (key === 'sauce') {
        const [w, s] = pick(SAUCES);
        parts.push({ text: pick([`소스는 ${w}`, `${w} 소스 주이소`, `${ro(w)} 해줘유`]), want: { sauces: [s] } });
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
    const text = `${r() < 0.2 ? pick(CHATTY_HEAD) : ''}${all.map((p) => p.text).join(pick([' ', ', ', ' 그라고 ', ' 그리고 ']))}${pick(CHATTY_TAIL)}`;
    const want: Want = {};
    for (const p of all)
      for (const [k, v] of Object.entries(p.want)) {
        const cur = (want as Record<string, unknown>)[k];
        (want as Record<string, unknown>)[k] = Array.isArray(v) && Array.isArray(cur) ? [...cur, ...v] : v;
      }
    add('L3섞기', text, want);
  }
  return cases;
}

if (process.argv[1]?.endsWith('talk-3000-3.ts') && process.argv.includes('--docs')) {
  const { loadSubwayCatalog } = await import('../src/catalog/subway-catalog.ts');
  const { writeFileSync, existsSync, readFileSync } = await import('node:fs');
  const list = make3000c(loadSubwayCatalog());
  const res: Record<string, string> = existsSync('var/talk-3000-3-result.json') ? JSON.parse(readFileSync('var/talk-3000-3-result.json', 'utf8')) : {};
  const groups = [...new Set(list.map((c) => c.group))];
  const lines = [
    '# 말로 주문하기 3,000문장 목록 — 3차 (10/21 아침)',
    '',
    '> 만든 곳: `scripts/talk-3000-3.ts` (1·2차와 겹치는 문장 없음) + 취향 이야기 `scripts/taste-stories-3.ts`. 결과: ✅ 맞음 / ❌ 틀림 (마지막으로 돌린 결과)',
    '> 문장마다 같이 보는 것: 알아들은 값 + 주문서·알레르기 안전·금액·매장 글·추천 Top3 (2차와 같음)',
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
  writeFileSync('docs/검수/3000문장_목록_3차.md', lines.join('\n'));
  console.log(`docs/검수/3000문장_목록_3차.md — ${list.length}문장`);
}
