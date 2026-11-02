// 규칙 해석: AI 없이 말 → 조건. 같은 말이면 항상 같은 결과 (AI가 끊겨도 진행, 로드맵 30번).
// 긴 이름부터 맞추고 맞춘 부분은 지운다 ("그레인 샐러드" ≠ 그레인 빵, "새우 알레르기" ≠ 쉬림프 메뉴).
// 모르는 말은 조건으로 만들지 않는다. 애매하면 질문 1개만 만든다.
import type { MenuKind, SubwayCatalog } from '../catalog/subway-catalog.ts';
import { ALLERGY_ALIASES, nameIndex, squash, TOPPING_ALIASES } from './aliases.ts';
import { emptyIntent, type Drink, type Intent } from './intent-schema.ts';
import { mainKindsOf, type MainKind } from '../subway-menu/menu-domain.ts';

export interface RuleResult {
  intent: Intent;
  /** 애매해서 되물을 것 (하나만) */
  question: string | null;
  /** 안 되는 요청 */
  refusals: string[];
  /** 알아들은 것 (화면에 "이렇게 이해했어요"로) */
  understood: string[];
  /** 규칙이 못 읽고 남긴 말 (군말을 뺀 것). 있으면 AI에게 물어 보탠다 (10/16) */
  leftover: string;
  /** 말에 나온 판매 끝난 메뉴·토핑 이름 (10/19) — AI가 비슷한 메뉴를 대신 고르지 않게 */
  ended: string[];
}

/** 메뉴 종류 이름 (화면에 보일 말) */
export const KIND_KO: Record<string, string> = { SANDWICH: '샌드위치', SALAD: '샐러드', GRAIN_SALAD: '그레인 샐러드', WRAP: '랩', MORNING_SANDWICH: '아침 샌드위치', MORNING_WRAP: '아침 랩', SIDE: '사이드' };

const KOREAN_NUM: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9 };

const SINO: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const UNIT: Record<string, number> = { 십: 10, 백: 100, 천: 1000 };
/** 금액에 쓰는 글자 (숫자·한글 숫자·단위) */
export const WON_CHARS = '0-9.일이삼사오육칠팔구십백천만';

/** 금액 → 원. 숫자·한글 숫자를 섞어도 읽는다: "만 원", "1만5천원", "8천원", "9000원", "만 삼천원", "이만원", "칠천오백원", "1.5만" (10/16 한글 숫자) */
export function parseWon(s: string): number | null {
  const t = s.replace(/[,\s]/g, '').replace(/원$/, '');
  if (!t || !new RegExp(`^[${WON_CHARS}]+$`).test(t)) return null;
  let total = 0; // 만 단위로 끝난 값
  let section = 0; // 만 아래 (천·백·십)
  let num: number | null = null; // 지금 읽는 숫자
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (/[0-9.]/.test(ch)) {
      const m = t.slice(i).match(/^\d+(?:\.\d+)?/);
      if (!m || num !== null) return null;
      num = Number(m[0]);
      i += m[0].length - 1;
    } else if (SINO[ch] !== undefined) {
      if (num !== null) return null; // "삼사천"처럼 숫자가 둘 겹치면 모름
      num = SINO[ch]!;
    } else if (UNIT[ch] !== undefined) {
      section += (num ?? 1) * UNIT[ch]!;
      num = null;
    } else if (ch === '만') {
      total += (section + (num ?? 0) || 1) * 10000;
      section = 0;
      num = null;
    }
  }
  const won = Math.round(total + section + (num ?? 0));
  return won > 0 ? won : null;
}

// 금액 낱말: 숫자로 시작하거나 한글 숫자로 시작, 사이 띄어쓰기 한 칸 허용 ("만 삼천")
const NUM = `(?:[0-9][0-9.,]*|[일이삼사오육칠팔구십백천만])(?:[0-9.,일이삼사오육칠팔구십백천만]|\\s(?=[0-9일이삼사오육칠팔구십백천만]))*`;
const START = '(?<![가-힣0-9])';
const BUDGET_PATTERNS = [
  new RegExp(`${START}(${NUM})\\s*원?\\s*(?:정도\\s*)?(?:이하|이내|아래|안쪽|안으로|안에서|까지|넘지\\s*않게|안\\s*넘게|넘으면\\s*안|밑으로|미만)`),
  new RegExp(`예산(?:\\s*(?:은|이|는)\\s+|\\s*)(${NUM})\\s*원?`),
  new RegExp(`${START}(${NUM})\\s*원\\s*(?:으로|짜리|선에서)`),
];
/** 예산 말 찾기 (원래 말에서). [찾은 전체, 금액 부분] */
export function findBudget(text: string): RegExpMatchArray | null {
  const t = text.normalize('NFC');
  for (const re of BUDGET_PATTERNS) {
    const m = t.match(re);
    if (m && (parseWon(m[1]!) ?? 0) >= 1000) return m; // "오이하고"의 "오…이하"(5원 이하)는 예산이 아니다 (10/20)
  }
  return null;
}

// 남은 말에서 지울 군말 — 이게 다 지워지면 AI를 부르지 않는다 (10/16)
const FILLER =
  /(?:집에서|회사에서|여기서|빼주세요|빼줘|빼고|추가해줘|추가|넣어서|넣어줘|넣고|별로|먹고싶은데|먹고싶어요|먹고싶어|먹고싶다|먹고싶|먹을건데|먹으려고|먹을거야|먹을려고|싶어요|싶어|싶은데|싶다|추천해줘바|추천해봐|해봐|줘바|나는|저는|나지금|지금|그럼|그러면|있잖아|근데|그런데|소스로|소스|치즈로|치즈|빵으로|빵|아까|거기서|그걸로|그거로|방금|그메뉴|넣어서|넣어줘|넣어|넣고|좋아해|좋아요|좋아|추천해?줘?|해주세요|해요|해서|어서|어줘|어요|해줘|해주|주세요|줘요|줘|부탁해?요?|먹고싶어?요?|먹을래|먹을게|원해요?|있어요?|있는|없는|좋겠어요?|할래요?|할게요?|으로|로|좀|거|걸|것|요|이랑|하고|그리고|랑|도|은|는|이|가|을|를|만|정도|메뉴|써브웨이|서브웨이|저는|나는|제가|내가|오늘|그냥|아무거나|같은|정말|진짜|너무|되게|조금|많이|하나|한개|뭐|어때요?|어떤|있을까요?|있나요?|[.,!?~^ㅋㅎㅠㅜ\s])/g;

/** 말 고치기 (10/20 2차): "30cm 아니 15cm로", "콜라 아니 사이다로", "양파 빼줘 아니다 넣어줘" → "아니" 앞에서 마지막에 말한 것을 지운다 */
export function dropCorrected(text: string): string {
  const m = text.match(/^(.*\S)\s+아니(?:다|야|지)?[\s,]+(.+)$/);
  if (!m) return text;
  const words = m[1]!.split(/\s+/);
  const ACTION = /^(?:빼줘|빼|빼고|빼주세요|넣어줘|넣어|해줘|줘|주세요|로|으로|요|말고)$/;
  while (words.length && ACTION.test(words[words.length - 1]!)) words.pop();
  if (words.length) words.pop();
  if (words.length && words[words.length - 1] === '소스') words.pop();
  return `${words.join(' ')} ${dropCorrected(m[2]!)}`;
}

/** 사투리·강조 말을 표준말로 (10/21 3차): "묵고 싶다" → 먹고 싶다, "마이 넣어" → 많이 넣어("마이"를 마요네즈로 읽던 것), "억수로" 지움 */
export function standardize(text: string): string {
  return text
    .replace(/묵꼬/g, '먹고')
    .replace(/묵(?=고|는|을|어|자|기|으면|었|겠|지|다|잡)/g, '먹')
    .replace(/무울래|무울까/g, (w) => (w.endsWith('래') ? '먹을래' : '먹을까'))
    .replace(/(?<![가-힣])무까/g, '먹을까')
    .replace(/먹고잡/g, '먹고싶')
    .replace(/마이(?=\s*(?:넣|든|줘|주|해|더|많))/g, '많이')
    .replace(/(?<![가-힣])(?:억수로|겁나|허벌나게|디게|엄청나게|엄청|완전)(?![가-힣])/g, ' ')
    .replace(/디지겠|디질/g, '죽겠')
    .replace(/(?<![가-힣])그라고(?![가-힣])/g, '그리고')
    .replace(/(?<![가-힣])머(?=\s*먹)/g, '뭐');
}

export function parseRules(text: string, catalog: SubwayCatalog): RuleResult {
  text = standardize(dropCorrected(text.normalize('NFC')));
  const intent = emptyIntent();
  const understood: string[] = [];
  const refusals: string[] = [];
  let question: string | null = null;
  const ask = (q: string) => {
    if (!question) question = q;
  };
  const idx = nameIndex(catalog);
  // 비교는 공백을 지운 글로 (말할 때 띄어쓰기가 제각각)
  let s = squash(text.normalize('NFC'));
  const take = (re: RegExp) => {
    const m = s.match(re);
    if (m) s = s.replace(m[0], ' ');
    return m;
  };
  const C = intent.conditions;
  const O = intent.options;
  const push = <T>(arr: T[] | undefined, v: T): T[] => [...new Set([...(arr ?? []), v])];
  // 가게 이름은 조건이 아니다 (11/02: "서브웨이에서 …"의 "서브"를 샌드위치로 읽어 샐러드·랩을 다 빼던 것)
  //  메뉴 "써브웨이 클럽"(클러브·클롭)은 남긴다
  while (take(/[써서]브웨이(?!클)|subway(?!club)/i));

  // 판매가 끝난 메뉴·토핑 (10/19, data/입력표/판매끝.csv): 비슷한 다른 메뉴로 바꿔 고르지 않고 알려 준다
  // ("아기맹새우" → 쉬림프, "로스트 치킨 아보카도" → 로스트 치킨으로 조용히 바뀌던 것). 긴 이름부터 가린다
  const ended: string[] = [];
  for (const e of [...(catalog.ended ?? [])].sort((a, b) => b.name.length - a.name.length)) {
    const key = squash(e.name);
    if (!key || !s.includes(key)) continue;
    s = s.split(key).join(' ');
    ended.push(e.name);
    const last = e.name.charCodeAt(e.name.length - 1);
    const eun = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '은' : '는';
    refusals.push(`${e.name}${eun} 판매가 끝났어요 (공식 홈페이지 ${e.checkedAt} 기준). 다른 걸 골라 주세요`);
  }
  // 여러 낱말 메뉴 이름의 한 글자 오타 (10/20: "로스트 치퀸", "써브웨이 클롭", "스파이시 쉬림쁘") — 똑같은 메뉴 이름이 하나도 없을 때만,
  // 띄어쓰기를 지운 글에서 이름 길이 ±1 구간을 보고 한 메뉴로만 맞으면 그 이름으로 고쳐 쓴다 (매운 말·메인 재료 규칙이 메뉴 이름을 가리게)
  const menuKeysAll = Object.keys(idx.menu);
  if (!menuKeysAll.some((k) => k.length >= 2 && s.includes(k))) {
    const fix = new Map<string, { from: string; to: string }>();
    for (const k of menuKeysAll) {
      if (k.length < 4) continue;
      for (const len of [k.length, k.length - 1, k.length + 1]) {
        for (let i = 0; i + len <= s.length; i++) {
          const w = s.slice(i, i + len);
          if (w[0] === k[0] && !fix.has(idx.menu[k]!) && oneSyllableOff(w, k)) fix.set(idx.menu[k]!, { from: w, to: k });
        }
      }
    }
    if (fix.size === 1) {
      const { from, to } = [...fix.values()][0]!;
      s = s.replace(from, to);
    }
  }
  // 메인 재료 한 글자 오타 (10/20 예형님: "돼직고기로 먹고시퍼" → 돼지고기를 못 알아들음). "고기"가 들어간 말만
  const mainTypoFixed: string[] = []; // 고친 말은 따로 떨어진 낱말로도 본다 ("소꼬기" 하나만 말해도)
  // 이름끼리도 한 글자 차이(소고기·닭고기)라 자모로 가장 가까운 하나만, 이미 바르게 쓴 자리는 건드리지 않음
  {
    const MAIN_KEYS = ['돼지고기', '쇠고기', '소고기', '닭고기'];
    const taken = new Array<boolean>(s.length).fill(false);
    for (const k of MAIN_KEYS) for (let i = s.indexOf(k); i >= 0; i = s.indexOf(k, i + 1)) for (let j = i; j < i + k.length; j++) taken[j] = true;
    const fixes: Array<{ i: number; len: number; k: string }> = [];
    for (let i = 0; i < s.length; i++) {
      for (const len of [4, 3]) {
        const w = s.slice(i, i + len);
        if (w.length !== len || taken.slice(i, i + len).some(Boolean) || !/[고꼬괴거]/.test(w) || !/[기길깃]$/.test(w)) continue;
        const near = MAIN_KEYS.filter((k) => k.length === len).map((k) => ({ k, d: jamoDistance(w, k) })).filter((x) => x.d > 0 && x.d <= 2).sort((a, b) => a.d - b.d);
        if (near.length && (near.length === 1 || near[0]!.d < near[1]!.d || near.every((x) => /고기$/.test(x.k) && ['쇠고기', '소고기'].includes(x.k)))) {
          fixes.push({ i, len, k: near[0]!.k });
          for (let j = i; j < i + len; j++) taken[j] = true;
          break;
        }
      }
    }
    for (const f of fixes.reverse()) (s = s.slice(0, f.i) + f.k + s.slice(f.i + f.len)), mainTypoFixed.push(f.k);
  }

  // 써브웨이에 없는 음식 (10/19 예형님 결정): "생선회에 맵게" → "생선회는 써브웨이 메뉴에 없어요" + 비슷한 쪽(해산물)을 위로.
  // 비슷한 게 없으면 안내만. 나머지 말("맵게")은 그대로 반영
  const NOT_SUBWAY: Array<[RegExp, MainKind[] | null, string]> = [
    [/생선회|사시미|초밥|스시|연어|광어|우럭|참치회|물회|회덮밥/, ['새우', '참치'], '해산물(새우·참치) 메뉴'],
    [/햄버거|버거/, ['쇠고기'], '고기 든 샌드위치(쇠고기)'],
    [/돈까스|돈가스|제육|삼겹살|보쌈|족발/, ['돼지고기'], '돼지고기 메뉴'],
    [/닭강정|닭갈비|찜닭|후라이드|양념치킨/, ['닭고기'], '닭고기 메뉴'],
    [/짜장면|짜장|짬뽕|탕수육|라면|라멘|우동|쌀국수|국수|냉면|파스타|스파게티|떡볶이|김밥|비빔밥|국밥|찌개|전골|감자탕|갈비탕|볶음밥|덮밥|마라탕|마라샹궈|카레|핫도그|도넛|빙수|아이스크림|족발/, null, ''],
  ];
  for (const [word, mains, like] of NOT_SUBWAY) {
    const m = s.match(word);
    if (!m) continue;
    s = s.split(m[0]).join(' ');
    const last = m[0].charCodeAt(m[0].length - 1);
    const eun = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0 ? '은' : '는';
    refusals.push(`${m[0]}${eun} 써브웨이 메뉴에 없어요${mains ? `. 대신 ${like}를 먼저 보여 드려요` : ''}`);
    if (mains && !C.wantMains) C.wantMains = mains;
  }
  // "회" 한 글자는 따로 떨어진 낱말일 때만 ("회 먹고싶어", "회로" — "회사"는 아님)
  if (!C.wantMains && text.normalize('NFC').split(/[\s,.!?~]+/).some((w) => /^회(?:로|는|가|를|에|랑|먹|도)?$/.test(w))) {
    refusals.push('회는 써브웨이 메뉴에 없어요. 대신 해산물(새우·참치) 메뉴를 먼저 보여 드려요');
    C.wantMains = ['새우', '참치'];
    s = s.replace(/회(?=로|는|가|를|에|랑|먹|도|\s|$)/, ' ');
  }

  // 안 되는 요청
  if (/배달|결제|카드로|예약해|포장주문|주문넣어|주문해줘/.test(s)) refusals.push('배달·결제·주문 넣기는 아직 안 돼요. 주문서를 만들어 매장에 전화·복사로 넘겨드려요');

  // 질문: 왜 / 비교
  // 10/20: "1번 2번 뭐가 달라"처럼 잇는 말 없이 늘어놓아도 차이를 물으면 비교
  const cmp = take(/(\d)번(?:이랑|하고|과|와|vs)(\d)번/) ?? (/차이|달라|다른점|뭐가나/.test(s) ? take(/(\d)번(\d)번/) : null);
  if (cmp) {
    intent.ask = 'COMPARE';
    intent.compare = [Number(cmp[1]), Number(cmp[2])];
    understood.push(`${cmp[1]}번과 ${cmp[2]}번 비교`);
  } else if (/비교|차이가?뭐/.test(s)) intent.ask = 'COMPARE';
  else if (/왜|이유/.test(s)) intent.ask = 'WHY';
  if (intent.ask === 'WHY') understood.push('추천 이유 묻기');
  if (intent.ask === 'COMPARE' && !cmp) understood.push('비교 묻기');
  if (/아까|거기서|그걸로|그거로|방금|그메뉴/.test(s)) intent.followUp = true;
  // 막연한 추천 요청 (10/20 예형님: "아 나 뭐 먹을까?" → "잘 못 알아들었어요"였던 것). 조건이 같이 있으면 조건도 그대로 읽는다
  const VAGUE = /뭐든괜찮|대충괜찮|평범한걸|평범한거|알아서해|뭐먹|머먹|뭐머|뭘먹|뭐가좋|뭐가맛있|뭐맛있|메뉴골라|메뉴추천|추천해|추턴|추천좀|추천줄|추천은|추천$|^추천|골라줘|골라주|아무거나|암거나|오늘의추천|점심추천|저녁추천|아침추천|뭐먹을지|뭐먹냐|뭐먹으면/;
  if (VAGUE.test(squash(text.normalize('NFC')))) {
    intent.vague = true;
    s = s.replace(new RegExp(VAGUE.source.replace(/\$|\^/g, ''), 'g'), ' ');
  }

  // 매운 것 (알레르기보다 먼저: "맵게 못 먹고 게 알레르기"에서 알레르기 쪽이 맵게의 "게"를 먼저 가져가지 않게)
  // 매운 것: 빼기 / 넣기 / 방향을 모르면 묻기 (10/16: "매운 거 넣어서"를 빼기로 반대로 알아듣던 것)
  // 메뉴 이름의 "스파이시"(스파이시 쉬림프 등)는 매운맛 말로 보지 않는다 → 가려 두고 찾음
  const spicyMenus = Object.keys(idx.menu).filter((k) => k.includes('스파이시'));
  const masked = spicyMenus.reduce((acc, k) => acc.split(k).join('#'.repeat(k.length)), s);
  const SPICY = '(?:매운|매콤한|매콤|스파이시|얼큰한|얼큰)(?:거|건|걸|것|맛|음식|메뉴|한거|한걸|하게|소스)?';
  // 10/20: 안 맵게·맵게는 별로를 먼저 보고, 남은 "맵게"는 어디에 있든 넣기 ("좀 맵게 콜라에다가"의 "맵게")
  const avoid = new RegExp(`(?:맵게(?:는|은)?(?:못|안)먹|맵게(?:는|은)?(?:별로|싫|말고|빼|하지마|하지말|안해)|맵지않게|안맵게|안매운|덜맵게|${SPICY}(?:은|는|도)?(?:좀)?(?:빼|없이|싫|말고|제외|못먹|안먹|별로|안돼|안되|노))`);
  const want = new RegExp(`(?:${SPICY}(?:으로|로|를|을|도|좀|이|가)?(?:넣(?:어서|어줘|어|고|자)?|좋(?:아해|아요|아|음)?|추가(?:해줘|해|하고)?|많이|더|주(?:세요|고|라)?|원해|먹고|땡(?:겨|기는|긴다)?|추천|최고|가자|할래)|맵게(?!는|은)|매콤|얼큰|매운걸로|매운거로)`);
  const am = masked.match(avoid);
  // 추천을 부탁하면서 "매운 거"만 말함 ("뭐 먹지 매운 거", 10/20) → 매운 걸 원함
  const wm = am ? null : (masked.match(want) ?? (/뭐먹|머먹|뭐가좋|뭐가맛있|뭐맛있|추천|추턴|골라|아무거나/.test(squash(text)) ? masked.match(new RegExp(SPICY)) : null));
  const sm = am ?? wm;
  if (sm) {
    s = s.slice(0, sm.index!) + ' ' + s.slice(sm.index! + sm[0].length);
    if (am) {
      C.avoidSpicy = true;
      understood.push('매운 것 빼기 (할라피뇨·핫 칠리·스파이시 메뉴)');
    } else {
      C.wantSpicy = true;
      understood.push('매운 것 넣기 (스파이시 메뉴 먼저, 할라피뇨 더·핫 칠리 소스)');
    }
  } else if (/(?:매운|매콤|스파이시|맵)/.test(masked)) {
    ask('매운 걸 넣을까요, 뺄까요?');
    const i = masked.search(/(?:매운|매콤|스파이시|맵)/);
    s = s.slice(0, i) + ' ' + s.slice(i + 2);
  }

  // 알레르기: "X 알레르기", "X 못 먹어", "X 들어간 거 빼고"
  const allergyKeys = Object.keys(ALLERGY_ALIASES).sort((a, b) => b.length - a.length);
  const original = text.normalize('NFC');
  for (const k of allergyKeys) {
    // 한 글자(게·콩·밀·잣·닭)는 따로 떨어진 낱말일 때만 — 띄어쓰기를 지우면 "맵게 못 먹어"의 "게"가 꽃게 알레르기로 읽히던 문제 (10/15 점검)
    if (k.length === 1 && !new RegExp(`(?:^|[^가-힣])${k}`).test(original)) continue;
    // 야채(토마토)는 "빼"가 옵션 수정이라 알레르기 말로만, 나머지(새우 등)는 "빼고"도 알레르기처럼 뺀다
    const isVeg = !!idx.vegetable[k];
    // 고기(돼지·닭·소)는 "빼고"가 알레르기가 아니라 그 메뉴 빼기 (10/19: "돼지고기 빼고 다 괜찮아"를 알레르기로 저장하던 것) → 아래 메인 재료 규칙이 받음
    const isMeat = ['돼지고기', '닭고기', '쇠고기'].includes(ALLERGY_ALIASES[k]![0]!);
    const re = new RegExp(`${k}(?:이|가|는|은|도)?(?:알레르기|알러지|못먹|안먹|먹으면안|먹으면탈|먹으면큰일|안들어간|들어간거빼|들어간건빼|들어간것빼|없는거|없는걸|프리${isVeg ? '' : '|안돼|안되|안됨'}${isVeg || isMeat ? '' : '|빼고|빼줘|빼서|없이|제외'})`);
    if (take(re)) {
      for (const a of ALLERGY_ALIASES[k]!) C.allergies = push(C.allergies, a);
      understood.push(`${k} 알레르기 (${ALLERGY_ALIASES[k]!.join('·')})`);
    }
  }
  // "우유랑 계란 못 먹어", "갑각류랑 견과류 알레르기": 알레르기 말이 있으면, 그 앞에 "랑·하고·,"로 이어진 것도 알레르기
  if (/알레르기|알러지|못먹|안먹|먹으면안|먹으면큰일|안들어간|프리/.test(squash(original))) {
    for (const k of allergyKeys) {
      if (k.length === 1) continue;
      const m = s.match(new RegExp(`${k}(?:이랑|랑|하고|과|와|,|및|그리고)`));
      if (!m) continue;
      for (const a of ALLERGY_ALIASES[k]!) C.allergies = push(C.allergies, a);
      understood.push(`${k} 알레르기 (${ALLERGY_ALIASES[k]!.join('·')})`);
      s = s.replace(m[0], ' ');
    }
  }

  // "우유 계란 알레르기": 띄어 쓰기만 하고 늘어놓은 목록도 (10/19: 전엔 알레르기 바로 앞 하나만)
  {
    const alt = allergyKeys.filter((k) => k.length >= 2).join('|');
    const chain = original.match(new RegExp(`((?:(?:${alt})\\s*(?:이랑|랑|하고|과|와|,|및)?\\s*){2,})(?:이|가|도)?\\s*(?:알레르기|알러지|못\\s*먹|안\\s*먹)`));
    if (chain) {
      for (const k of allergyKeys) {
        if (k.length < 2 || !chain[1]!.includes(k)) continue;
        const add = ALLERGY_ALIASES[k]!.filter((a) => !(C.allergies ?? []).includes(a));
        if (!add.length) continue;
        for (const a of add) C.allergies = push(C.allergies, a);
        understood.push(`${k} 알레르기 (${ALLERGY_ALIASES[k]!.join('·')})`);
        s = s.replace(k, ' ');
      }
    }
  }

  // 생선·해산물 (10/21 예형님: "어류가 들어간 음식"을 못 알아듣던 것)
  //  알레르기로 말했으면: 참치도 생선이라 참치 메뉴(해산물이면 새우 메뉴도)는 뺀다 — 공식 표엔 고등어만 있어 참치 메뉴에 표시가 없기 때문
  if ((C.allergies ?? []).includes('고등어') && /생선|어류|물고기|해산물|해물/.test(squash(original))) {
    const out: MainKind[] = /해산물|해물/.test(squash(original)) ? ['참치', '새우'] : ['참치'];
    C.avoidMains = [...new Set([...(C.avoidMains ?? []), ...out])];
    understood.push(`${out.join('·')}도 생선·해산물이라 그 메뉴는 뺐어요`);
  } else if (take(/(?:어류|생선|물고기|해산물|해물|씨푸드|해산물류)(?:이|가|이랑|으로|로|류|종류)?(?:들어간|들어있는|든|들은|메뉴|위주|있는|좋|먹고|땡|추천|로|으로)?/)) {
    C.wantMains = [...new Set([...(C.wantMains ?? []), '새우', '참치'] as MainKind[])]; // 아래에서 "새우·참치 메뉴로"로 보임
  }
  // 열량·나트륨
  const kcal = take(/(\d{2,4})(?:kcal|칼로리|키로|킬로칼로리)(?:이하|이내|아래|까지)?/) ?? take(/(?:칼로리|열량)(?:은|는)?(\d{2,4})(?:kcal|칼로리)?(?:이하|이내|아래|까지|안쪽)/);
  if (kcal) {
    C.maxEnergyKcal = Number(kcal[1]);
    understood.push(`${kcal[1]}kcal 이하`);
  }
  const na = take(/나트륨(\d{2,4})(?:mg|밀리)?(?:이하|이내|아래|까지)?/);
  if (na) {
    C.maxSodiumMg = Number(na[1]);
    understood.push(`나트륨 ${na[1]}mg 이하`);
  } else if (take(/(?:짜게(?:는)?(?:못|안)먹|짜지않|(?<!리)안짜|싱겁|저염|나트륨적|나트륨낮)/)) {
    C.maxSodiumMg = 700;
    C.salty = 'LESS'; // 10/20: 700mg 넘는 건 빼고, 남은 것 중에서도 덜 짠 쪽을 위로
    understood.push('나트륨 700mg 이하 (짜지 않게)');
  }
  // 예산
  // 금액은 띄어쓰기가 남은 원래 말에서 찾는다: "이"는 숫자(2)이기도 하고 조사이기도 해서, 띄어쓰기를 지우면
  // "많이 만원"이 "이만원"(2만 원)이 된다. 숫자는 낱말 첫머리에서만 시작한다 (10/16)
  const budget = findBudget(text);
  if (budget) {
    const i = s.indexOf(squash(budget[0]!));
    if (i >= 0) s = s.slice(0, i) + ' ' + s.slice(i + squash(budget[0]!).length);
  }
  if (budget) {
    const won = parseWon(budget[1]!);
    if (won && won > 1_000_000) refusals.push('예산을 다시 말해 주세요 (예: "만 원 이하")');
    else if (won && won >= 1000) {
      C.budgetKrw = won;
      understood.push(`예산 ${won.toLocaleString('ko-KR')}원 이하`);
    }
  }
  // 해장 (10/23 예형님): 국물은 오늘의 수프뿐 → 수프 세트를 권하고, 기름기(포화지방)·나트륨 덜한 메뉴를 위로 (근거는 메뉴 값만)
  if (take(/해장(?:할|하려고|하고|용|으로|하기|에|각|해야|하게)?|속\s*풀|숙취|술\s*깨/)) {
    C.lowFat = true;
    C.salty = 'LESS';
    if (O.set === undefined) O.set = '수프 음료 세트';
    understood.push('해장: 기름기·나트륨 덜한 쪽 + 오늘의 수프 세트');
  }
  // 기름기 적게 (11/02 예형님 "기름기 없는 음식으로 추천해줘"를 못 알아듣던 것). "기름진 거 먹고 싶어"처럼 반대 말은 건드리지 않는다
  if (
    !C.lowFat &&
    take(
      /기름기(?:가|는|도)?(?:없|적|덜|빼|뺀|안|낮|별로)|기름(?:지지|기없|기적)|(?:안|덜)(?:기름진|기름지|느끼)|기름진(?:거|건|걸|것|음식|메뉴)?(?:은|는)?(?:싫|빼|말고|말구|별로|제외|안먹|못먹)|느끼하지(?:않|안)|느끼한(?:거|건|걸|것|음식|메뉴)?(?:은|는)?(?:싫|빼|말고|말구|별로|제외|안먹|못먹)|담백|저지방|(?:포화)?지방(?:이|은|는)?(?:적|낮|덜|없)/,
    )
  ) {
    C.lowFat = true;
    understood.push('기름기 적게 (포화지방 낮은 쪽)');
  }
  // 짜게·싱겁게 (10/20): 나트륨 점수에만 ("짜게 먹고 싶어" → 짭짤한 메뉴 위로, "싱겁게" → 나트륨 낮은 메뉴 위로)
  if (C.salty === 'LESS') {
    /* 해장이 이미 정함 */
  } else if (take(/싱겁게|싱거운|덜짜게|(?<!리)안짜게|(?<!리)안짠|짜지않|나트륨적|나트륨낮|저염|저나트륨/)) {
    C.salty = 'LESS';
    understood.push('싱겁게 (나트륨 낮은 쪽)');
  } else if (take(/짜게|짭짤|짠거|짠걸|짠것|간세게|간쎄게|간이세|짠맛/)) {
    C.salty = 'MORE';
    understood.push('짜게 (나트륨 높은 쪽)');
  }
  // 목표
  if (take(/단백질(?:많|높|위주|가득|듬뿍)?|고단백|프로틴|근육|벌크|힘(?:이)?나는|힘내는|힘쓰는/)) {
    C.goal = 'PROTEIN';
    understood.push('단백질 많은 쪽');
  } else if (take(/안고프|안고픈|안고파|배안고|살안찌|살빠|살빼|살뺄|체중감량|다이어트|가볍게|가벼운|칼로리낮|칼로리적|저칼로리|(?<!스프)라이트/)) {
    C.goal = 'LIGHT';
    understood.push('가벼운 쪽 (열량 낮게)');
  } else if (!/안고프|안고파|(?<!리)안배고|배안고|배는안/.test(s) && take(/배고프|배고파|배고픔|배고픈|허기|든든|양많|양이많|배부르게|배부른|배불리|푸짐|많이먹|배터지게|양많은/)) {
    // 든든하게 (10/16: "나 지금 배고픔") — 포만감 점수 2배, 열량 목표 650kcal
    C.goal = 'FILLING';
    understood.push('든든한 쪽 (배부르게)');
  }

  // 지난번처럼 (10/16, 로드맵 44번)
  if (take(/지난번처럼|지난번거|지난번걸로|저번처럼|저번거|저번걸로|늘먹던거|늘먹던걸로|맨날먹던|평소먹던|먹던걸로|같은걸로|아까랑같은|똑같이|평소처럼|평소대로|늘먹는거|늘먹는걸로|맨날먹는거|맨날먹는걸로/)) {
    intent.ask = 'LAST';
    understood.push('지난번 주문 그대로');
  }
  // 오늘 상태: 분명히 말했을 때만 (10/16, 로드맵 45번). "피곤해" → 든든한 쪽 (오늘만)
  if (take(/피곤해|피곤하|피곤함|피곤한|지쳤|지친다|녹초|천근만근|기운이?(?:하나도|전혀|좀)?없|컨디션(?:이)?(?:별로|안좋|나빠|최악|꽝)|기력이?없|힘이없|힘들어|힘든하루/)) {
    C.mood = 'TIRED';
    if (!C.goal) C.goal = 'FILLING';
    understood.push('오늘 피곤함 → 든든한 쪽 (오늘만)');
  }
  // 취향 말: "평소에 소고기 좋아해"(오래감) / "오늘은 소고기 피할래"(오늘만) — 이번 추천에도 바로 쓰고, 동의한 사람은 휴대폰에 저장
  {
    const LIKE_WORDS: Array<[RegExp, MainKind]> = [
      [/쇠고기|소고기|비프/, '쇠고기'], [/닭고기|치킨|닭/, '닭고기'], [/돼지고기|돼지|햄/, '돼지고기'], [/새우|쉬림프/, '새우'], [/참치|튜나/, '참치'], [/계란|달걀|에그/, '달걀'],
      [/채식|야채만든거|야채만든것|야채만|비건|베지/, '야채'], // 10/20: "평소에 채식 좋아해"가 이번 조건으로만 남고 취향으로 저장 안 되던 것
    ];
    for (const [word, main] of LIKE_WORDS) {
      const today = s.match(new RegExp(`오늘(?:은|는)?(?:${word.source})(?:은|는|를|을|가|이)?(?:피할래|피할게|피하고|안땡|싫|별로|말고|빼고|안먹|못먹|땡겨|땡기|당겨|당기|패스|건너뛸|먹고싶|좋아)`));
      // 10/20 2차: "소고기 원래 좋아함"(순서 바뀜), "나 치킨파야", "평소에 참치 잘 안 먹어"
      const LAST_VERB = '(?:좋아|즐겨|자주먹|싫어|안좋아|별로|안먹|잘안먹)';
      const lasting = !today && (s.match(new RegExp(`(?:평소|원래|늘|항상|보통|자주)(?:에|엔|에는)?(?:${word.source})(?:은|는|를|을|가|이)?${LAST_VERB}`))
        ?? s.match(new RegExp(`(?:${word.source})(?:은|는|를|을|가|이)?(?:원래|평소에?|늘|항상|보통)${LAST_VERB}`))
        ?? s.match(new RegExp(`(?:${word.source})파(?:야|임|예요|에요|라서|거든|$)`)));
      const m = today || lasting;
      if (!m) continue;
      const sign: 1 | -1 = /피할|피하|안땡|싫|별로|말고|빼고|안먹|못먹|안좋아|패스|건너/.test(m[0]) ? -1 : 1;
      const scope = today ? 'TODAY' : 'LASTING';
      C.tastes = [...(C.tastes ?? []), { main, sign, scope }];
      understood.push(`${scope === 'TODAY' ? '오늘은' : '평소'} ${main} ${sign > 0 ? '좋아함' : '피함'}`);
      s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length);
    }
  }
  // 메인 재료 종류 (10/16: "쇠고기 종류로") — 메뉴 이름 속의 말("로스트 치킨"의 치킨)은 가리고 찾는다
  const menuWords = catalog.menus.map((m) => squash(m.name)).sort((a, b) => b.length - a.length);
  // 10/21: s를 고칠 때마다 다시 만든다 (전엔 한 번만 만들어, "치킨 말고 돼지고기"에서 앞 말을 지운 뒤 뒤 낱말 자리가 어긋남)
  // 10/20: 메뉴 별칭(튜나·새우·쉬림프·베지)도 메뉴로 — 뒤에 "종류·들어간"이 붙으면 메인 재료로
  const aliasWords = Object.keys(idx.menu).filter((k) => k.length >= 2 && !menuWords.includes(k) && (MAIN_ALIAS.test(k) || k.length >= 4)).sort((x, y) => y.length - x.length);
  const hide = () => aliasWords.reduce((acc, k) => acc.replace(new RegExp(`${k}(?!종류|류|들어|든|위주)`, 'g'), '#'.repeat(k.length)), menuWords.reduce((acc, k) => (k.length >= 2 ? acc.split(k).join('#'.repeat(k.length)) : acc), s));
  // "고기는 빼고" (10/21): 고기 메뉴(쇠·닭·돼지) 전부 빼기
  const anyMeat = s.match(/(?<!소|쇠|닭|돼지)고기(?:는|은|도|류)?(?:빼|말고|싫|없이|없는|안들어간|별로|제외|안먹|못먹)|채식주의|베지테리언/);
  if (anyMeat) {
    C.avoidMains = [...new Set([...(C.avoidMains ?? []), '쇠고기', '닭고기', '돼지고기'] as MainKind[])];
    s = s.slice(0, anyMeat.index!) + ' ' + s.slice(anyMeat.index! + anyMeat[0].length);
  }
  if (anyMeat && /채식주의|베지테리언/.test(anyMeat[0])) C.wantMains = [...new Set([...(C.wantMains ?? []), '야채'] as MainKind[])];
  if (!anyMeat) {
    const meat = s.match(/(?<!소|쇠|닭|돼지|붉은|흰)(?:육류|고기|육식)(?:류)?(?:가|이|를|을)?(?:들어간|들어있는|든|많이|많은|듬뿍|위주|메뉴|로|으로|하고싶|먹고싶|좋아|땡)/);
    if (meat) {
      C.wantMains = [...new Set([...(C.wantMains ?? []), '쇠고기', '닭고기', '돼지고기'] as MainKind[])];
      s = s.slice(0, meat.index!) + ' ' + s.slice(meat.index! + meat[0].length);
    }
  }
  const MAIN_WORDS: Array<[RegExp, MainKind]> = [
    [/쇠고기|소고기|비프|불고기|붉은고기|레드미트|(?<![가-힣])소(?=종류|들어간|메뉴)/, '쇠고기'],
    [/닭고기|치킨|가금류|닭/, '닭고기'],
    [/돼지고기|돼지|포크|햄|베이컨|페퍼로니|살라미|가공육/, '돼지고기'],
    [/새우|쉬림프|갑각류/, '새우'],
    [/참치|튜나/, '참치'],
    [/계란|달걀|에그/, '달걀'],
    [/채식|야채만|비건|베지|채소|야채위주|야채많은|야채많이든/, '야채'],
  ];
  const MAIN_TAIL = '(?:종류|류|들어간거|들어간걸|들어간|들어있는|든거|든걸|위주|메뉴|로된|으로된|로|으로|가|이|먹고|땡|좋|최고|이면좋|면좋|을넣어|를넣어|넣어서|넣은)'; // 10/21 4차: "치킨을 넣어서 맵게해줘" (예형님 말투)
  const tokens = text.normalize('NFC').split(/[\s,.!?~]+/).map(stripParticle);
  for (const [word, kind] of MAIN_WORDS) {
    const hidden = hide();
    const neg = hidden.match(new RegExp(`(?:${word.source})(?:종류|류|메뉴|들어간거|들어간건|들어간것|든거)?(?:는|은|도)?(?:말고|빼고|빼줘|빼서|싫|제외|별로|없이)`));
    if (neg) {
      // "돼지고기 빼고", "쇠고기 말고" → 그 메인 재료 메뉴는 빼기 (10/19: 전엔 이 말을 버리거나 알레르기로 읽음)
      C.avoidMains = [...new Set([...(C.avoidMains ?? []), kind])];
      s = s.slice(0, neg.index!) + ' ' + s.slice(neg.index! + neg[0].length);
      continue;
    }
    const m = hidden.match(new RegExp(`(?:${word.source})${MAIN_TAIL}`));
    const toppingWord = /베이컨|페퍼로니|살라미/.test(word.source) && /(?:베이컨|페퍼로니|살라미)(?:을|를|도|좀)?(?:추가|더|넣어|올려|얹어|많이|듬뿍)/.test(hidden);
    if (toppingWord && !(m && /들어|든|위주|종류|메뉴/.test(m[0]))) continue;
    const alone = !m && (tokens.some((w) => new RegExp(`^(?:${word.source})$`).test(w) && hidden.includes(w)) || mainTypoFixed.some((w) => new RegExp(`^(?:${word.source})$`).test(w) && hidden.includes(w)));
    if (!m && !alone) continue;
    C.wantMains = [...new Set([...(C.wantMains ?? []), kind])];
    if (m) s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length);
    else s = s.replace(new RegExp(word.source), ' ');
  }
  if (C.wantMains) understood.push(`${C.wantMains.join('·')} 메뉴로`);
  if (C.avoidMains) understood.push(`${C.avoidMains.join('·')} 메뉴 빼기`);

  // 음료 (10/19): 공식 주문 시스템에 단품 음료가 있다 ("콜라만 줘" → 콜라 단품). 쿠키·웨지·칩·수프를 같이 말하면 그 세트의 음료로 —
  // 여기서는 찾아 두기만 하고, 세트인지 단품인지는 아래 "단품·세트 정하기"에서
  const QTY = /^(?:을|를|도|은|는)?(?:(하나|한개|한잔|한캔|한병|1개|1잔|1캔)|(두개|둘|두잔|두캔|두병|2개|2잔|2캔)|(세개|셋|세잔|세캔|3개|3잔|3캔)|(네개|넷|4개)|(다섯개|5개))/;
  const qtyAt = (i: number) => {
    const m = s.slice(i).match(QTY);
    if (!m) return { qty: 1, len: 0 };
    return { qty: m.slice(1).findIndex((x) => x) + 1, len: m[0].length };
  };
  const DRINK_WORDS: Array<[RegExp, string, Drink | null]> = [
    [/제로레몬라임|레몬라임/, '코카콜라 제로 레몬라임 (350ml)', '제로콜라'],
    [/제로콜라|콜라제로|코크제로|펩시제로|제로코크|제로펩시|코카콜라제로/, '코카콜라 제로 (355ml)', '제로콜라'],
    [/제로사이다|사이다제로|스프라이트제로|칠성제로/, '스프라이트 제로 (355ml)', '제로사이다'],
    [/코카콜라|콜라|코크|펩시/, '코카콜라 (355ml)', '콜라'],
    [/사이다|스프라이트|칠성/, '스프라이트 (355ml)', '사이다'],
    [/닥터페퍼|닥페/, '닥터페퍼 (355ml)', null],
    [/씨그램|탄산수/, '씨그램', null],
    [/미닛메이드|오렌지주스|주스/, '미닛메이드', null],
    [/토레타|이온음료/, '토레타', null],
    [/생수|물한병|물하나|물주세요|물줘/, '생수', null],
    [/아이스아메리카노|아아(?!메리)/, '아이스 아메리카노', '커피'],
    [/저당라떼|라떼/, '바리스타룰스 저당 라떼(350ml)', null],
    [/셀렉스|프로틴음료|단백질음료/, '셀렉스 프로핏 초콜릿(330ml)', null],
    [/아메리카노|커피/, '아메리카노', '커피'],
    [/탄산음료/, '탄산음료 16oz', '콜라'],
  ];
  const drinkHits: Array<{ single: string; setDrink: Drink | null; qty: number }> = [];
  if (/환타/.test(s)) {
    refusals.push('환타는 써브웨이에 없어요. 탄산음료는 코카콜라·스프라이트(제로 포함)·닥터페퍼·씨그램이 있어요');
    s = s.replace(/환타/g, ' ');
  }
  for (const [word, single, setDrink] of DRINK_WORDS) {
    const m = s.match(new RegExp(`(?:${word.source})`));
    if (!m) continue;
    const q = qtyAt(m.index! + m[0].length);
    drinkHits.push({ single, setDrink, qty: q.qty });
    s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length + q.len);
  }
  // "콜라는 제로콜라로", "사이다는 제로로" → 뒤의 것 하나 (앞의 "콜라"는 무엇을 바꿀지 가리키는 말)
  for (const [base, zero, word] of [['코카콜라 (355ml)', '코카콜라 제로 (355ml)', '콜라'], ['스프라이트 (355ml)', '스프라이트 제로 (355ml)', '사이다|스프라이트']] as const) {
    if (drinkHits.some((d) => d.single === base) && drinkHits.some((d) => d.single === zero) && new RegExp(`(?:${word})(?:는|은)`).test(squash(text.normalize('NFC')))) {
      drinkHits.splice(drinkHits.findIndex((d) => d.single === base), 1);
    }
  }

  // 장소 (10/16: "강남역에서", "판교역 근처") — 원래 말에서 낱말째로. 여기·집·회사처럼 찾을 수 없는 말은 빼고(지금 위치로)
  const place =
    // 10/26 주소 + 번지 ("역삼동 737 근처", "서울 강남구 테헤란로 152에서"): 번지만 장소로 읽던 것 ("737")
    text.normalize('NFC').match(/(?:^|\s)((?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|[가-힣]{1,6}(?:특별시|광역시|특별자치시|특별자치도|시|도))\s+)?(?:[가-힣]{1,6}(?:구|군)\s+)?[가-힣]{1,10}(?:동|로|길|리)\s*\d{1,5}(?:-\d{1,5})?(?:번지)?)\s*(?:써브웨이|서브웨이)?\s*(?:에서|근처에서|근처|쪽에서|쪽|앞에서|부근에서|부근)(?=\s|$|[,.!?])/) ??
    text.normalize('NFC').match(/(?:^|\s)([가-힣A-Za-z0-9]{2,15}?)(?:점)?\s*(?:써브웨이|서브웨이|SUBWAY|subway)?(?:점)?\s*(?:에서|근처에서|근처|쪽에서|쪽|앞에서|부근에서|부근)(?=\s|$|[,.!?])/) ??
    // "역삼역 써브웨이 에그마요" (10/19): 역 이름 + 써브웨이
    text.normalize('NFC').match(/(?:^|\s)([가-힣A-Za-z0-9]{1,12}역)\s*(?:써브웨이|서브웨이|SUBWAY|subway)(?:점)?(?=\s|$|[,.!?])/);
  // 10/19: "저번거에서 소스만 랜치로"의 "저번거"처럼 지난 주문을 가리키는 말은 장소가 아님
  if (place && !/^(?:여기|거기|저기|이근처|집|우리집|회사|학교|어디|매장|써브웨이|서브웨이|이쪽|저쪽|그쪽)$/.test(place[1]!) && !/^(?:저번|지난번|아까|평소|늘|맨날|방금|전에|이전)|(?:거|꺼|것|걸)$/.test(place[1]!)) {
    C.place = place[1]!;
    understood.push(`장소: ${place[1]}`);
    const sq = squash(place[0]!);
    s = s.replace(sq, ' ');
  }
  // 가까운 곳
  if (take(/가까운(?:데|곳|매장)?|가깝|근처/)) {
    C.nearby = true;
    understood.push('가까운 매장 먼저');
  }

  // 세트에서 고를 것 (10/16): "쿠키는 초코칩", "콘수프로", "치즈 웨지" → 그 세트까지
  const SET_ITEM_WORDS: Array<[RegExp, string, string]> = [
    [/더블초코칩|더블초코/, '더블 초코칩', '쿠키 음료 세트'],
    [/초코칩/, '초코칩', '쿠키 음료 세트'],
    [/오트밀(?:레이즌)?/, '오트밀 레이즌', '쿠키 음료 세트'],
    [/라즈베리(?:치즈케익|치즈케이크)?/, '라즈베리 치즈케익', '쿠키 음료 세트'],
    [/마카다미아|화이트초코/, '화이트 초코 마카다미아', '쿠키 음료 세트'],
    [/베이컨치즈웨지|baconcheesy웨지|베이컨치지웨지/, 'Bacon Cheesy 웨지 포테이토', '웨지 음료 세트'],
    [/치즈웨지|cheesy웨지|치지웨지/, 'Cheesy 웨지 포테이토', '웨지 음료 세트'],
    [/포테이토베이컨수프|감자수프|베이컨수프/, '오늘의 수프', '수프 음료 세트'], // 10/21: 세트는 그날 수프
    [/콘수프|옥수수수프|콘스프/, '오늘의 수프', '수프 음료 세트'],
    [/머쉬룸수프|버섯수프|머쉬룸스프/, '오늘의 수프', '수프 음료 세트'],
  ];
  // 10/19: 찾아 두기만 (세트인지 단품인지는 아래에서). 단품 이름: 쿠키는 "○○ 쿠키", 웨지는 그대로, 수프는 "오늘의 수프"
  const sideHits: Array<{ item: string | null; setName: string; single: string | null; qty: number; word: string; generic?: boolean }> = [];
  const SINGLE_OF: Record<string, string> = {
    '더블 초코칩': '더블 초코칩 쿠키', 초코칩: '초코칩 쿠키', '오트밀 레이즌': '오트밀 레이즌 쿠키', '라즈베리 치즈케익': '라즈베리 치즈케익 쿠키', '화이트 초코 마카다미아': '화이트 초코 마카다미아 쿠키',
    'Bacon Cheesy 웨지 포테이토': 'Bacon Cheesy 웨지 포테이토', 'Cheesy 웨지 포테이토': 'Cheesy 웨지 포테이토',
  };
  for (const [word, item, setName] of SET_ITEM_WORDS) {
    const m = s.match(new RegExp(`(?:쿠키|수프|스프|웨지)?(?:는|은)?(?:${word.source})(?:쿠키|으로|로)?`));
    if (!m) continue;
    const q = qtyAt(m.index! + m[0].length);
    sideHits.push({ item, setName, single: SINGLE_OF[item] ?? null, qty: q.qty, word: m[0] });
    s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length + q.len);
    break;
  }
  // 메뉴 이름 (긴 것부터) — 종류 말보다 먼저 ("로티세리 치킨 더블치즈 그레인 샐러드"는 메뉴)
  const menuKeys = Object.keys(idx.menu).sort((a, b) => b.length - a.length);
  // 바로 뒤에 붙은 말만 (10/20: "에그마요 양파 더"의 "더"는 양파 것)
  const toppingAdd = /^(?:을|를|도|좀|은|는|하나|한개)*(?:추가|더|넣어|올려|얹어)/;
  const toppingNames = new Set([...catalog.toppings.map((x) => squash(x.name)), ...Object.keys(TOPPING_ALIASES)]);
  let menuKey = '';
  for (const k of menuKeys) {
    const i = s.indexOf(k);
    if (i < 0 || k.length < 2) continue;
    // "에그마요 추가"는 토핑
    if (toppingAdd.test(s.slice(i + k.length, i + k.length + 4)) && toppingNames.has(k)) continue;
    intent.menu = idx.menu[k]!;
    menuKey = k;
    s = s.slice(0, i) + ' ' + s.slice(i + k.length);
    understood.push(`메뉴: ${catalog.menus.find((m) => m.id === intent.menu)!.name}`);
    break;
  }

  // 세트
  const setM = O.set === undefined ? take(/(쿠키|웨지|칩|수프)(?:음료)?세트/) : (take(/(쿠키|웨지|칩|수프)(?:음료)?세트/), null);
  if (setM) {
    const set = catalog.sets.find((x) => x.name.startsWith(setM[1]!));
    if (set) {
      O.set = set.name;
      understood.push(set.name);
    }
  } else if (take(/세트(?:는|은)?(?:빼|없이|말고|안해|됐어|됐|필요없|안시켜)|단품/)) {
    O.set = null;
    understood.push('세트 빼기');
  } else if (/세트/.test(s)) ask(`세트는 어떤 걸로 할까요? (${catalog.sets.map((x) => x.name).join(', ')})`);

  // ── 단품·세트 정하기 (10/19) ──
  // "콜라만 줘" → 콜라 단품 / "로스트 치킨에 콜라" → 샌드위치 + 콜라 단품 / "로스트 치킨에 콜라랑 쿠키" → 쿠키 음료 세트(음료 콜라)
  // 이름 없는 "쿠키·칩·웨지·수프"도 찾는다 (세트 말을 읽은 뒤라 "쿠키세트"는 이미 빠짐)
  const GENERIC_SIDES: Array<[RegExp, string, string | null, string | null]> = [
    [/쿠키박스|쿠키12개/, '쿠키 음료 세트', null, '쿠키박스 (12개입)'],
    [/쿠키팩|쿠키6개|쿠키여섯개/, '쿠키 음료 세트', null, '쿠키팩 (6개입)'],
    [/쿠키3개|쿠키세개/, '쿠키 음료 세트', null, '쿠키 3개'],
    [/쿠키/, '쿠키 음료 세트', null, null],
    [/감자칩|칩/, '칩 음료 세트', '칩', '칩 (랜덤발송)'],
    [/웨지감자|웨지포테이토|웨지/, '웨지 음료 세트', '웨지 포테이토', '웨지 포테이토'],
    [/레귤러수프|수프레귤러|레귤러스프/, '수프 음료 세트', null, '오늘의 수프 (레귤러)'],
    [/하프수프|수프하프|하프스프/, '수프 음료 세트', null, '오늘의 수프 (하프)'],
    [/수프|스프/, '수프 음료 세트', null, null],
  ];
  if (!sideHits.length) {
    for (const [word, setName, item, single] of GENERIC_SIDES) {
      const m = s.match(word);
      if (!m) continue;
      const q = qtyAt(m.index! + m[0].length);
      sideHits.push({ item, setName, single, qty: q.qty, word: m[0], generic: true });
      s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length + q.len);
      break;
    }
  }
  // "콘수프 세트", "초코칩 쿠키 세트로"처럼 사이드 이름 + "세트" → 그 세트 (사이드 이름을 먼저 가져가서 "세트"만 남은 경우)
  const saidSet = /세트|콤보/.test(s);
  if (!O.set && O.set !== null && saidSet && sideHits.length) {
    O.set = sideHits[0]!.setName;
    understood.push(O.set);
    if ((question as string | null)?.startsWith('세트는 어떤 걸로')) question = null;
    s = s.replace(/세트|콤보/, ' ');
  }
  if (!O.set && O.set !== null && saidSet && drinkHits.length && !sideHits.length) {
    // "콜라 세트로" → 세트 음료로 기억, 어떤 세트인지는 위에서 물음
    const d = drinkHits.find((x) => x.setDrink);
    if (d) (O.drink = d.setDrink!), understood.push(`세트 음료: ${d.setDrink}`);
  } else if (O.set) {
    // 세트를 말함 → 음료·사이드는 세트 것으로
    const d = drinkHits.find((x) => x.setDrink);
    if (d) (O.drink = d.setDrink!), understood.push(`세트 음료: ${d.setDrink}`);
    const side = sideHits.find((x) => x.setName === O.set && x.item);
    if (side) (O.setItem = side.item!), understood.push(`세트: ${side.item}`);
  } else if (drinkHits.length && sideHits.length && O.set === undefined && drinkHits[0]!.setDrink && (intent.menu || C.goal || C.wantSpicy || C.avoidSpicy || C.wantMains || C.avoidMains || C.budgetKrw !== undefined || /샌드위치|샐러드|랩/.test(s))) {
    // 샌드위치와 같이일 때만 세트 ("콜라랑 쿠키만"처럼 샌드위치가 없으면 아래에서 단품 둘) — 앞 대화의 메뉴에 이어 말할 때는 해석이 세트로 묶음
    // 음료 + 사이드 → 그 세트 (예: "콜라랑 쿠키")
    const side = sideHits[0]!;
    O.set = side.setName;
    O.drink = drinkHits[0]!.setDrink!;
    if (side.item) O.setItem = side.item;
    understood.push(`${side.setName} (${[side.item, O.drink].filter(Boolean).join(', ')})`);
    if (side.setName === '쿠키 음료 세트' && !side.item) ask('쿠키는 어떤 걸로 할까요? (초코칩·더블 초코칩·오트밀 레이즌·라즈베리 치즈케익·화이트 초코 마카다미아)');
  } else {
    // 단품으로
    const extras: Array<{ name: string; qty: number }> = [];
    for (const d of drinkHits) extras.push({ name: d.single, qty: d.qty });
    for (const x of sideHits) {
      if (x.single) extras.push({ name: x.single, qty: x.qty });
      else if (x.setName === '쿠키 음료 세트') ask('쿠키는 어떤 걸로 할까요? (초코칩·더블 초코칩·오트밀 레이즌·라즈베리 치즈케익·화이트 초코 마카다미아, 1,600원)');
      else if (x.setName === '수프 음료 세트') ask('수프는 하프(2,500원)·레귤러(4,100원) 중 어떤 걸로 할까요?');
    }
    if (extras.length) {
      O.extras = extras;
      for (const e of extras) understood.push(`단품: ${e.name}${e.qty > 1 ? ` × ${e.qty}` : ''}`);
    }
  }
  // 세트 구성품을 이름 없이 말함 (10/20 예형님: "스프 야무진거 하나" → 수프 세트만 고르고 수프는 비어 있었음)
  //  "야무진 거·든든한 거·맛있는 거·아무거나·알아서" → 알레르기에 안 걸리는 것 중 가장 든든한(열량 높은) 것, 꾸밈말도 없으면 묻기
  // 수프 세트 (10/21 공식 확인): 구성품은 그날 매장의 "오늘의 수프" — 고를 것 없음. 그날 수프에 따라 알레르기 성분이 다를 수 있어 알림
  const hearty = /야무진|든든한(?:거|걸|것)|맛있는(?:거|걸|것)|아무거나|암거나|알아서|제일든든|괜찮은(?:거|걸|것)|좋은(?:거|걸)로/;
  if (O.set === '수프 음료 세트') {
    O.setItem = '오늘의 수프';
    if (!understood.some((u) => u.includes('오늘의 수프'))) understood.push('세트: 오늘의 수프 (그날 매장 수프)');
    if (/포테이토베이컨수프|감자수프|베이컨수프|콘수프|옥수수수프|콘스프|머쉬룸수프|버섯수프|머쉬룸스프/.test(squash(text))) refusals.push('수프 세트는 그날 매장에서 나오는 "오늘의 수프"예요. 말씀하신 수프는 그날 수프일 때만 있어요 (매장 확인)');
    const soups = catalog.menus.filter((m) => ['포테이토 베이컨 수프', '콘 수프', '머쉬룸 수프'].includes(m.name));
    const hit = (C.allergies ?? []).filter((a) => soups.some((m) => m.allergens.contains.includes(a)));
    if (hit.length) refusals.push(`오늘의 수프는 날마다 달라 ${hit.join('·')} 알레르기 성분이 들어 있을 수 있어요. 매장에 확인해 주세요`);
    s = s.replace(new RegExp(hearty.source, 'g'), ' ');
  }
  if (O.set && ['쿠키 음료 세트', '웨지 음료 세트'].includes(O.set) && !sideHits.some((x) => x.setName === O.set && !x.generic)) {
    if (hearty.test(squash(text))) {
      const pickItem = heartiestSetItem(catalog, O.set, C.allergies ?? []);
      if (pickItem) {
        O.setItem = pickItem;
        understood.push(`세트: ${pickItem} (든든한 걸로 골랐어요)`);
      } else refusals.push(`${O.set.replace(' 음료 세트', '')}는 모두 ${(C.allergies ?? []).join('·')} 알레르기 성분이 들어 있어요. 다른 세트를 골라 주세요`);
      s = s.replace(new RegExp(hearty.source, 'g'), ' ');
    } else if (!O.setItem && O.set === '쿠키 음료 세트') ask('쿠키는 어떤 걸로 할까요? (초코칩·더블 초코칩·오트밀 레이즌·라즈베리 치즈케익·화이트 초코 마카다미아)');
    else if (!O.setItem && O.set === '웨지 음료 세트') O.setItem = '웨지 포테이토'; // "웨지"는 기본 웨지 포테이토
  }

  // 끼니 (10/21 예형님: 아침에 "점심 추천해줘" → 아침 메뉴를 먼저 고르던 것) — 말한 끼니로 추천, 점심·저녁·야식이면 아침 메뉴는 뺌
  {
    const t = squash(text.normalize('NFC'));
    const MEALS: Array<[RegExp, NonNullable<typeof C.meal>, string]> = [
      [/점심|런치/, 'LUNCH', '점심'], [/저녁|디너/, 'DINNER', '저녁'], [/야식|밤참|밤에먹|새벽에먹/, 'LATE_NIGHT', '야식'], [/아침|모닝|브렉퍼스트/, 'BREAKFAST', '아침'],
    ];
    const hit = MEALS.find(([re]) => re.test(t));
    if (hit) {
      C.meal = hit[1];
      if (hit[1] !== 'BREAKFAST') understood.push(`${hit[2]} 메뉴로`);
    }
  }
  // 종류 — "샐러드 말고 샌드위치"처럼 말고·빼고·싫은 종류는 빼고 본다 (10/16: 전엔 샐러드까지 고름)
  const KIND_WORDS: Array<[RegExp, MenuKind[]]> = [
    [/그레인샐러드/, ['GRAIN_SALAD']],
    [/샐러드/, ['SALAD', 'GRAIN_SALAD']],
    [/아침(?:메뉴)?|모닝|브렉퍼스트/, ['MORNING_SANDWICH', 'MORNING_WRAP']],
    [/샌드위치|써브|서브/, ['SANDWICH']],
    [/랩(?!치)/, ['WRAP']],
  ];
  const notKinds = new Set<MenuKind>();
  for (const [word, ks] of KIND_WORDS) {
    const m = s.match(new RegExp(`(?:${word.source})(?:는|은|류)?(?:말고|빼고|싫|제외|별로|아니)`));
    if (!m) continue;
    for (const k of ks) notKinds.add(k);
    s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length);
  }
  const kinds: MenuKind[] = [];
  if (take(/그레인샐러드/)) kinds.push('GRAIN_SALAD');
  if (take(/샐러드/)) kinds.push('SALAD', 'GRAIN_SALAD');
  if (take(/아침(?:메뉴)?|모닝|브렉퍼스트/)) kinds.push('MORNING_SANDWICH', 'MORNING_WRAP');
  if (take(/샌드위치|써브|서브/)) kinds.push('SANDWICH');
  if (take(/랩(?!치)/)) kinds.push('WRAP');
  if (!/세트/.test(s) && take(/사이드|쿠키|웨지|칩스?/)) kinds.push('SIDE');
  const MEAL_KINDS: MenuKind[] = ['SANDWICH', 'SALAD', 'GRAIN_SALAD', 'WRAP', 'MORNING_SANDWICH', 'MORNING_WRAP'];
  // 원하는 종류만 말했으면 그것, 싫은 것만 말했으면 나머지 전부
  const picked = (kinds.length ? kinds : notKinds.size ? MEAL_KINDS : []).filter((k) => !notKinds.has(k));
  if (picked.length) {
    C.kinds = [...new Set(picked)];
    understood.push(`종류: ${C.kinds.map((k) => KIND_KO[k] ?? k).join('·')}`);
  }

  // 탄수화물 적게·빵 없이 (10/21) → 빵 없는 샐러드 (그레인 샐러드는 곡물이 있어 뺌)
  if (!C.kinds && take(/탄수화물(?:이|은)?(?:적|낮|없|빼)|저탄수|빵없이|빵없는|빵빼고|(?<![가-힣])노빵|키토/)) { // "파마산 오레가노빵"의 "노빵"은 아님
    C.kinds = ['SALAD'];
    understood.push('빵 없는 샐러드로 (탄수화물 적게)');
  }
  // 크기
  if (take(/(?:30|삼십)(?:cm|센티미터|센티|센치|쎈치|쎈티)|풀사이즈|큰거|큰걸|긴거|긴걸|길게/)) O.size = '30cm';
  else if (take(/(?:15|십오)(?:cm|센티미터|센티|센치|쎈치|쎈티)|하프/)) O.size = '15cm';
  // 단위 없이 끝에 "30"·"15"만 (10/19: "에그마요 30") — 돈·개수·열량이 아닐 때만
  else if (take(/(?<![\d,])30(?:짜리|으로|로)?(?:바꿔|변경해|해)?(?:줘|주세요|요|도|주이소|줘유|주쇼|주라)?\s*$/)) O.size = '30cm';
  else if (take(/(?<![\d,])15(?:짜리|으로|로)?(?:바꿔|변경해|해)?(?:줘|주세요|요|도|주이소|줘유|주쇼|주라)?\s*$/)) O.size = '15cm';
  if (O.size) understood.push(`크기 ${O.size}`);

  // 토핑 추가: "베이컨 추가", "아보카도 더"
  for (const k of Object.keys(TOPPING_ALIASES).sort((a, b) => b.length - a.length)) {
    const m = s.match(new RegExp(`${k}(?:을|를|도|좀)?(?:추가|더|넣어|올려|얹어|많이|듬뿍)`)) ?? (/(?:많이|듬뿍|더|추가)$/.test(k) ? s.match(new RegExp(k)) : null);
    if (!m) continue;
    s = s.replace(m[0], ' ');
    O.toppings = push(O.toppings, `topping-name:${TOPPING_ALIASES[k]}`);
    understood.push(`추가 토핑: ${TOPPING_ALIASES[k]}`);
  }
  // 치즈
  if (take(/치즈(?:는|은)?(?:빼|없이|말고|안넣)/)) {
    O.cheese = null;
    understood.push('치즈 빼기');
  }
  for (const k of Object.keys(idx.cheese).sort((a, b) => b.length - a.length)) {
    // 두 글자 줄임말(모짜·모차)은 따로 떨어진 낱말일 때만 (10/19: "모짜렐나" 오타 안에서 먼저 걸리던 것)
    if (k.length <= 2 && !text.normalize('NFC').split(/[\s,.!?~]+/).some((w) => squash(stripParticle(w)) === k)) continue;
    if (s.includes(k)) {
      O.cheese = idx.cheese[k]!;
      s = s.replace(k, ' ');
      understood.push(`치즈: ${k}`);
      break;
    }
  }
  // 소스 빼기 / 소스 이름
  if (take(/소스(?:는|은)?(?:빼|없이|말고|안넣)/)) {
    O.sauces = [];
    understood.push('소스 빼기');
  }
  for (const k of Object.keys(idx.sauce).sort((a, b) => b.length - a.length)) {
    if (!s.includes(k)) continue;
    // "랜치도 추가", "랜치 추가해줘" → 평소 소스에 더하기 (10/21 예형님: 말 안 하면 평소대로, "~로"면 바꾸기, "~도"면 더하기)
    if (/^(?:소스)?(?:도|까지|추가|더)/.test(s.slice(s.indexOf(k) + k.length, s.indexOf(k) + k.length + 6))) O.saucesAdd = true;
    s = s.replace(k, ' ');
    O.sauces = push(O.sauces, idx.sauce[k]!);
    understood.push(`소스: ${k}`);
  }
  if (!O.sauces?.length && take(/소스(?:만|는|도|좀)?(?:바꿔|바꿀|바꾸|변경|추천|다른|뭐|어떤)/)) ask('소스는 어떤 걸로 할까요? (최대 3개)');
  // 이름 없이 개수만 (10/21 예형님: "소스 3개 다 넣어주고"를 조용히 버리던 것) → 어떤 걸로 할지 묻기
  else if (!O.sauces?.length && (take(/소스(?:는|도|를|을|좀)?(?:\d+|한|두|세|네|다섯|여러|몇)?(?:개|가지)?(?:다|전부|모두|아무거나|알아서|많이|듬뿍|최대로)?(?:넣|줘|주|추가|해|뿌려|올려)|소스(?:\d+|한|두|세|네|여러)(?:개|가지)|소스(?:다|전부|모두)/) || /소스(?:는|도)?(?:아무거나|암거나|알아서|대충)/.test(squash(text)))) {
    const names = catalog.ingredients.filter((i) => i.category === 'SAUCE').map((i) => i.name);
    ask(`소스는 최대 3개까지 넣을 수 있어요. 어떤 걸로 할까요? (${names.slice(0, 6).join('·')} 등)`);
  }
  // 빵: 빵 이름은 그대로, "그레인"은 "빵"과 같이 말할 때만
  for (const k of Object.keys(idx.bread).sort((a, b) => b.length - a.length)) {
    const i = s.indexOf(k);
    if (i < 0) continue;
    if (k === '그레인' && !/빵|브레드/.test(s)) continue;
    // 두 글자 줄임말(파오·허오·오트·허니)은 따로 떨어진 낱말일 때만 (10/19: "양파 오이"의 "파오"가 파마산 오레가노로 읽히던 것)
    const realName = catalog.ingredients.some((x) => x.category === 'BREAD' && squash(x.name) === k); // "위트"는 진짜 이름이라 그대로
    if (k.length <= 2 && !realName && !text.normalize('NFC').split(/[\s,.!?~]+/).some((w) => squash(stripParticle(w)) === k || squash(w).startsWith(`${k}빵`))) continue;
    O.bread = idx.bread[k]!;
    s = s.slice(0, i) + ' ' + s.slice(i + k.length);
    understood.push(`빵: ${catalog.ingredients.find((x) => x.id === O.bread)!.name}`);
    break;
  }
  if (!O.bread && take(/빵(?:만|은|는|도|좀)?(?:바꿔|바꿀|바꾸|변경|다른|뭐|어떤)/)) ask(`빵은 어떤 걸로 할까요? (${catalog.ingredients.filter((i) => i.category === 'BREAD').map((i) => i.name).join('·')})`);
  // 야채: 뒤에 "빼"면 빼기, "많이/추가/더"면 더하기
  // 10/19: "피망 양파 올리브 빼", "양파랑 오이 빼주세요"처럼 여러 개를 늘어놓고 끝에 한 번 말해도 전부 (전엔 마지막 것만)
  const vegHits: Array<{ i: number; len: number; k: string; id: string }> = [];
  let vegMasked = s;
  for (const k of Object.keys(idx.vegetable).sort((a, b) => b.length - a.length)) {
    let i = vegMasked.indexOf(k);
    while (i >= 0) {
      vegHits.push({ i, len: k.length, k, id: idx.vegetable[k]! });
      vegMasked = vegMasked.slice(0, i) + '#'.repeat(k.length) + vegMasked.slice(i + k.length);
      i = vegMasked.indexOf(k);
    }
  }
  vegHits.sort((a, b) => a.i - b.i);
  const noVeg = new Set(text.normalize('NFC').split(/[\s,.!?~]+/).map((w) => w.match(/^노(.+)$/)?.[1]).filter((x): x is string => !!x).map((x) => (idx.vegetable[squash(x)] ? squash(x) : squash(stripParticle(x)))).filter((x) => idx.vegetable[x])); // "노오이": 끝의 "이"를 조사로 떼지 않게 (10/20)
  const VEG_JOIN = /^(?:이랑|랑|하고|과|와|및|그리고|도|[,\s])*/;
  for (let n = 0; n < vegHits.length; n++) {
    // 바로 뒤에 이어진 야채들을 건너뛰고, 마지막 것 뒤의 말로 정함
    let j = vegHits[n]!.i + vegHits[n]!.len;
    for (let m = n + 1; ; m++) {
      const join = s.slice(j).match(VEG_JOIN)![0];
      const next = vegHits[m];
      if (next && next.i === j + join.length) {
        j = next.i + next.len;
        continue;
      }
      j += join.length;
      break;
    }
    // "올리브 들어가? 들어가면 빼줘" (10/21): 묻는 말을 건너뛰고 뒤의 빼기·더를 본다
    const after = s.slice(j, j + 16).replace(/^(?:이|가|는|은)?들어가[?요나]?(?:들어가면|있으면|들었으면)?/, '').slice(0, 8);
    const { k, id } = vegHits[n]!;
    // "노양파 노피클" (10/19): 앞에 붙은 "노"도 빼기
    const noPrefix = noVeg.has(k);
    if (noPrefix || /^(?:은|는|도|좀)?(?:빼|없이|말고|제외|안넣|넣지마|넣지말|노|싫|ㄴㄴ)/.test(after)) {
      O.removeVegetables = push(O.removeVegetables, id);
      understood.push(`${k} 빼기`);
    } else if (/^(?:을|를|은|는|도)?(?:넣어|넣고|넣기|다시넣)(?!.{0,3}(?:많이|더|듬뿍))/.test(after)) {
      // "양파 넣어줘" = 뺐던 걸 다시 넣기 (10/20: "아니 양파는 넣어줘"를 "양파 더"로 읽던 것). "더·많이"가 붙어야 더 넣기
      O.keepVegetables = push(O.keepVegetables, id);
      understood.push(`${k} 넣기`);
    } else if (/^(?:을|를|은|는|도|좀)?(?:많이|추가|더|듬뿍|넣어|두배|곱빼기|왕창|잔뜩|더블)/.test(after)) {
      O.addVegetables = push(O.addVegetables, id);
      understood.push(`${k} 더`);
    }
  }
  for (const v of [...vegHits].sort((a, b) => b.i - a.i)) s = s.slice(0, v.i) + ' ' + s.slice(v.i + v.len);
  if (/야채(?:다|전부|모두)빼/.test(s)) ask('야채를 전부 뺄까요, 몇 가지만 뺄까요?');
  // 음료는 세트로만 나온다 → 음료를 말했는데 세트를 안 정했으면 하나만 묻는다 (음료는 기억해 둠)
  if (take(/토스팅(?:안|하지마|없이|빼)|안구워|굽지마/)) O.toasted = false;

  // 오타 한 글자 (10/16, 로드맵 26번): 똑같은 이름을 못 찾은 것만 낱말별로 비슷한 이름을 찾는다 ("에그마오" → 에그마요, "스윗어니온" → 스위트 어니언)
  const words = text.normalize('NFC').split(/[\s,.!?~]+/).filter((w) => w.length >= 2);
  if (!intent.menu) {
    const hit = nearest(words, idx.menu);
    if (hit) {
      intent.menu = hit.id;
      understood.push(`메뉴: ${catalog.menus.find((m) => m.id === hit.id)!.name}`);
      s = s.replace(squash(hit.word), ' ');
    }
  }
  if (!O.sauces) {
    const hit = nearest(words, idx.sauce);
    if (hit) {
      O.sauces = [hit.id];
      understood.push(`소스: ${catalog.ingredients.find((i) => i.id === hit.id)!.name}`);
      s = s.replace(squash(hit.word), ' ');
    }
  }
  if (!O.bread) {
    const hit = nearest(words, idx.bread);
    if (hit) {
      O.bread = hit.id;
      understood.push(`빵: ${catalog.ingredients.find((i) => i.id === hit.id)!.name}`);
      s = s.replace(squash(hit.word), ' ');
    }
  }
  if (O.cheese === undefined) {
    const hit = nearest(words, idx.cheese);
    if (hit) {
      O.cheese = hit.id;
      understood.push(`치즈: ${catalog.ingredients.find((i) => i.id === hit.id)!.name}`);
      s = s.replace(squash(hit.word), ' ');
    }
  }

  // 메뉴와 종류가 엇갈리면 (10/19: "로티세리 치킨 샐러드" → 샌드위치 "로티세리 바비큐 치킨"을 고르던 것):
  // 말한 종류 안에서 그 이름이 든 메뉴를 찾고, 하나면 그걸로, 여럿이면 묻는다
  if (intent.menu && menuKey && C.kinds?.length) {
    const cur = catalog.menus.find((m) => m.id === intent.menu)!;
    if (!C.kinds.includes(cur.kind)) {
      // "그레인"을 말하지 않았으면 그냥 샐러드, 곁들이(미니 샐러드)는 빼고
      const kinds = C.kinds.filter((k) => k !== 'GRAIN_SALAD' || /그레인/.test(s + text));
      const same = catalog.menus.filter((m) => kinds.includes(m.kind) && !/^미니/.test(m.name) && squash(m.name).includes(menuKey));
      const at = understood.indexOf(`메뉴: ${cur.name}`);
      if (same.length === 1) {
        intent.menu = same[0]!.id;
        if (at >= 0) understood[at] = `메뉴: ${same[0]!.name}`;
      } else if (same.length > 1) {
        delete intent.menu;
        if (at >= 0) understood.splice(at, 1);
        question = null;
        ask(`어떤 메뉴로 할까요? ${same.map((m) => m.name).join(' · ')}`);
      }
    }
  }
  // 샌드위치 없이 단품만 (10/19: "콜라만 줘"): 단품만 말하고 메뉴·식사 조건이 없을 때
  // 10/20: 짜게·칼로리 같은 식사 조건, "추천해줘", 알레르기+"도"("땅콩 알레르기 스프라이트도 줘")면 식사를 찾는 것
  const mealCond = Object.keys(C).some((k) => k !== 'allergies' && (C as Record<string, unknown>)[k] !== undefined);
  const mealWords = /추천|골라|뭐먹|메뉴/.test(squash(text)) || (!!C.allergies?.length && !/만(?:줘|주세요|요|하나|한|$)/.test(squash(text)));
  if (O.extras?.length && !mealCond && !mealWords && !intent.menu && !C.goal && !C.wantSpicy && !C.avoidSpicy && !C.wantMains && !C.avoidMains && !C.kinds && C.budgetKrw === undefined && !O.bread && !O.sauces && !O.removeVegetables && !O.addVegetables && !O.toppings && !O.size && O.set === undefined && !intent.ask) {
    intent.singlesOnly = true;
  }

  // 생선 알레르기인데 참치(새우) 메뉴를 직접 고름 → 경고 (공식 표엔 참치에 생선 표시가 없음, 10/21)
  if (intent.menu && C.avoidMains?.length && (C.allergies ?? []).includes('고등어')) {
    const m = catalog.menus.find((x) => x.id === intent.menu);
    const hit = m ? mainKindsOf(m).filter((k) => C.avoidMains!.includes(k) && (k === '참치' || k === '새우')) : [];
    if (m && hit.length) refusals.push(`${m.name}에는 ${hit.join('·')}(생선·해산물)가 들어 있어요. 생선·해산물 알레르기가 있으면 다른 메뉴를 골라 주세요`);
  }
  // 메뉴 이름 없이 야채·빵·치즈를 바꾸라고 함 (10/21 4차: "가볍게 토마토 빼줘"에 샐러드가 1위 → 샐러드는 야채를 못 바꿔 말한 게 빠짐) → 바꿀 수 있는 샌드위치만
  if (!intent.menu && !C.kinds && (O.removeVegetables?.length || O.addVegetables?.length || O.keepVegetables?.length || O.bread || O.cheese !== undefined || O.toasted === false)) {
    C.kinds = ['SANDWICH', 'MORNING_SANDWICH'];
    understood.push('샌드위치로 (야채·빵을 바꿀 수 있는 메뉴)');
  }
  // ③에서 번호로 고르기 (10/21 4차): "2번으로 할게", "두번째거", "3번꺼"
  {
    const t = squash(text.normalize('NFC'));
    const m = t.match(/^(?:그럼|그냥|음|아)?([123]|첫|두|세)번(?:째)?(?:거|꺼|걸|것)?(?:로|으로)?(?:할게|할게요|줘|주세요|요|해줘|해주세요|고를게|먹을게|ㄱㄱ)?[.!~]*$/);
    if (m) {
      intent.pickRank = ({ 첫: 1, 두: 2, 세: 3 } as Record<string, number>)[m[1]!] ?? Number(m[1]);
      understood.push(`${intent.pickRank}번 메뉴로`);
    }
  }
  // 막연한 말만 했으면 (메뉴·조건 없음) 추천 요청이라고 보여 줌 — 화면이 지금 시간에 맞는 한마디를 붙인다
  if (intent.vague && !understood.length && !question && !refusals.length && !intent.ask) understood.push('메뉴 추천');
  // 남은 말 (10/21): 규칙이 한 글자도 안 읽은 낱말만 센다. "피곤한데"의 "데"처럼 읽은 낱말의 조각은 남은 말이 아님 —
  // 조각 때문에 AI를 불러 3~4초 기다리던 것 (정답 표 110문장 중 32문장이 AI를 불렀음)
  const rest = s.replace(FILLER, ' ');
  const unread = text
    .normalize('NFC')
    .split(/[\s,.!?~…]+/)
    .map((w) => squash(stripParticle(w)).replace(FILLER, ''))
    // 글자 없는 것(이모지·기호)은 남은 말이 아님 (10/20 2차: "🥪 에그마요 줘 🙏")
    .filter((w) => w.length >= 2 && /[가-힣a-z]/.test(w) && rest.includes(w) && !LEFTOVER_STOP.has(w));
  const leftover = [...new Set(unread)].join(' ');
  return { intent, question, refusals, understood, leftover, ended };
}

/** 남아도 AI에 물을 필요가 없는 말 (10/21): 주문 뜻이 없는 동사·연결어·이미 다른 규칙이 뜻을 읽는 말 */
const MAIN_ALIAS = /^(?:튜나|쉬림프|베지)$/; // 10/21 4차: "새우로 먹고 싶어"는 새우 메뉴들(메인 재료) — 쉬림프 하나로 정하지 않음
const LEFTOVER_STOP = new Set([
  '음료', '저기', '저기요', '그니까', '그러니까', '운동', // 10/20: 3,000문장 실제 주소에서 AI 부른 569문장 중 509문장이 "저기·그니까" 때문
  // 10/20 2차: 반말·명령형·말투 오타 (예형님 "먹고시퍼")
  '먹고시퍼', '먹구싶어', '먹고싶퍼', '먹고싶다', '먹을게요', '주세여', '해쥬세요', '해줘용', '줘용', '주셈', '해주셈', 'ㄱㄱ', '고고', '플리즈', 'please', '줘봐', '해줘라', '주라', '콜', '부탁',
  '할래', '아니', '아니다', '아니야', '일단', '참고로', '있음', '알러지임', '하나요', '추가해주고', '해주고', '추가해줘', '추가', '마실', '뿌려줘', '흠', '어', '야', '아그', '저기요', 'ㅎㅎ', '그리고', '또',
  // (조사·군말을 뗀 뒤 모양) 규칙이 뜻을 읽고 남은 조각
  '참고', '뿌려', 'ㄴㄴ', '왕창', '노노', '주고', '빼주셈', '하게', '제일', '먹구', '들어간', '위주', '해쥬세', '다른', '그냥',
  // 10/21 4차: 예형님 말투 조각 (아나·빼주고·추가해주고나 등), 끼니 말(읽음), 번호 고르기(읽음)
  '아나', '아나나', '빼주고', '고나', '주고나', '먹고시퍼나', '야식', '퇴근', '퇴근하고', '저녁에', '점심에', '밤에', '따저녁', '이따', '좀있다가', '있다가', '1번', '2번', '3번', '1번꺼', '2번꺼', '3번꺼', '첫번째', '두번째', '세번째', '두개', '세개', '한개',
  // 10/21 3차: 사투리 끝말·수다 군말 (조사를 뗀 뒤 모양 포함)
  '드려', '고마워', '한다', '친구', '부터', '넣지', '다시', '들어', '바꿔주쇼', '얼마야', '주실래', '몰라서', '할지', '간단하게', '바베큐', '스모크', '태리안', '아메리카노', '닥터페퍼', '콜라', '사이다',
  '주이소', '해주이소', '주소', '줘라', '주쇼잉', '해주쇼', '주쇼', '줘유', '주세유', '해줘유', '해도', '주라마', '마이소', '넣지마이소', '빼도', '빼줘유', '빼주이소', '넣어주이소', '넣어주쇼', '줘예', '있다', '있어예',
  '먹을끼다', '먹을래', '먹고싶다', '먹고싶어유', '중이라예', '큰일', '알러지', '있거든요', '해줘유', '주실래요', '해주실', '있나요', '오늘', '회사에서', '진짜', '힘들었는데', '그래서', '말인데', '하루', '길었다',
  '친구가', '맛있다', '지난주에', '먹었던', '생각나서', '점심시간', '얼마', '남았는데', '요즘', '바빠서', '대충', '아까부터', '생각했는데', '빨리', '그럼', '이걸로', '고마워요', '감사합니다', '부탁드려요',
  '칼로리', '맵나', '들어가', '들어가면', '있으면', '뭐있어', '먹을건데', '적당히', '뭐든', '괜찮은데', '괜찮은', '고민되네', '모르겠어유', '평범한', '알아서', '묵은', '디지겠다', '죽겠다', '그라고',
  '에서', '달라', '했어', '바꿔', '바꿔줘', '괜찮아', '괜찮', '죽겠어', '빨리', '단품', '없나', '있나', '할건데', '할게', '할래', '구워주고', '구워줘', '듬뿍',
  '드레싱', '있고', '넣지마', '두배', '먹지', '골라', '골라줘', '와서', '점심', '저녁', '아침', '줄래', '주라', '해주라', '하나요', '먹자', '갈게', '부탁',
]);

// 낱말 끝의 조사·붙은 말 떼기 ("허니오트로" → "허니오트", "랜치소스" → "랜치")
const stripParticle = (w: string) => w.replace(/(?:으로요|으로|로요|로|를|을|은|는|이|가|도|만|요|빵|소스|치즈|주세요|줘)$/, '');

/** 세트에서 가장 든든한(열량 높은) 구성품 — 고른 알레르기가 든 것은 빼고 (10/20) */
export function heartiestSetItem(catalog: SubwayCatalog, set: string, allergies: readonly string[]): string | null {
  const ok = (contains: readonly string[]) => !allergies.some((a) => contains.includes(a));
  const ITEMS: Record<string, string[]> = {
    '수프 음료 세트': ['오늘의 수프'],
    '쿠키 음료 세트': ['초코칩', '더블 초코칩', '오트밀 레이즌', '라즈베리 치즈케익', '화이트 초코 마카다미아'],
    '웨지 음료 세트': ['웨지 포테이토', 'Cheesy 웨지 포테이토', 'Bacon Cheesy 웨지 포테이토'],
  };
  const info = (n: string) => {
    const m = catalog.menus.find((x) => x.name === n);
    if (m) return { kcal: m.nutrition15cm?.energyKcal ?? 0, contains: m.allergens.contains };
    const x = catalog.singles?.find((y) => y.name === n || y.name === `${n} 쿠키`);
    return x ? { kcal: x.nutrition?.energyKcal ?? 0, contains: x.allergens.contains } : null;
  };
  const xs = (ITEMS[set] ?? []).map((n) => ({ n, i: info(n) })).filter((x) => x.i && ok(x.i.contains));
  return xs.sort((a, b) => b.i!.kcal - a.i!.kcal)[0]?.n ?? null;
}

/** 길이가 같은 두 말의 자모(초성·중성·종성) 차이 수 (10/20: "닥고기"는 닭고기에 가깝고 소고기와는 멂) */
export function jamoDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a.charCodeAt(i) - 0xac00;
    const y = b.charCodeAt(i) - 0xac00;
    if (x < 0 || y < 0 || x > 11171 || y > 11171) {
      d += a[i] === b[i] ? 0 : 3;
      continue;
    }
    d += Number(Math.floor(x / 588) !== Math.floor(y / 588)) + Number(Math.floor((x % 588) / 28) !== Math.floor((y % 588) / 28)) + Number(x % 28 !== y % 28);
  }
  return d;
}

/** 글자(음절) 하나 차이까지 (바꿈·빠짐·더함 한 번) */
export function oneSyllableOff(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // 앞이 같은 데까지 온 뒤, 나머지가 한 글자 바꿈·빠짐·더함으로 같아지는지
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i);
}

/** 이름표(squash된 이름 → id)에서 낱말과 한 글자 차이인 것 하나. 3글자 이상, 첫 글자는 같아야 함 (짧은 말 엉뚱하게 고치지 않게). 여러 개면 안 고침 */
function nearest(words: string[], table: Record<string, string>): { id: string; word: string } | null {
  const found = new Map<string, string>();
  const dist = new Map<string, number>();
  for (const w of words) {
    // 낱말 그대로와 조사를 뗀 것 둘 다 본다 ("에그마요"의 끝 "요"를 조사로 떼면 "에그마"가 돼서 오타처럼 보이므로)
    const forms = [...new Set([squash(w), squash(stripParticle(w))])];
    // 이미 똑같은 이름인 낱말은 앞 단계가 일부러 안 쓴 것 ("에그마요 추가"는 토핑) → 오타로 고치지 않음
    if (forms.some((x) => table[x] !== undefined)) continue;
    for (const sw of forms) {
      // 두 글자는 같은 첫 글자 + 자모 하나 차이만 (10/20: "참취" → 참치)
      if (sw.length === 2) {
        for (const [k, id] of Object.entries(table)) if (k.length === 2 && sw[0] === k[0] && jamoDistance(sw, k) === 1) found.set(id, w);
        continue;
      }
      if (sw.length < 3) continue;
      for (const [k, id] of Object.entries(table)) {
        if (k.length >= 3 && sw[0] === k[0] && sw !== k && oneSyllableOff(sw, k)) (found.set(id, w), dist.set(id, Math.min(dist.get(id) ?? 99, jamoDistance(sw, k))));
      }
    }
  }
  // 여럿이면 자모로 가장 가까운 하나 (10/20: "비앨티"는 비엘티·비엠티 둘 다 한 글자 차이 → 비엘티)
  if (found.size > 1) {
    const ds = [...found.keys()].map((id) => ({ id, d: dist.get(id) ?? 99 })).sort((a, b) => a.d - b.d);
    if (ds[0]!.d < ds[1]!.d) return { id: ds[0]!.id, word: found.get(ds[0]!.id)! };
  }
  if (found.size !== 1) return null;
  const [id, word] = [...found.entries()][0]!;
  return { id, word };
}

/** 말에 이 메뉴 이름(또는 별칭)이 들어 있는지 — 한 글자 오타까지. AI가 고른 메뉴를 쓰기 전에 본다 (10/16: "에그마오" → AI가 엉뚱한 랩을 고르던 것) */
export function mentionsMenu(text: string, menuId: string, catalog: SubwayCatalog): boolean {
  const idx = nameIndex(catalog);
  const keys = Object.entries(idx.menu).filter(([, id]) => id === menuId).map(([k]) => k);
  const sq = squash(text.normalize('NFC'));
  if (keys.some((k) => sq.includes(k))) return true;
  const words = text.normalize('NFC').split(/[\s,.!?~]+/).map(stripParticle).map(squash).filter((w) => w.length >= 2);
  return keys.some((k) => words.some((w) => w[0] === k[0] && oneSyllableOff(w, k)));
}

/** "topping-name:베이컨" 을 메뉴 종류에 맞는 토핑 id로 */
export function resolveToppingNames(names: string[] | undefined, kind: MenuKind, catalog: SubwayCatalog): { ids: string[]; unknown: string[] } {
  const applies = kind === 'SALAD' || kind === 'GRAIN_SALAD' ? kind : 'SANDWICH';
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const n of names ?? []) {
    if (!n.startsWith('topping-name:')) {
      ids.push(n);
      continue;
    }
    const name = n.slice('topping-name:'.length);
    const t = catalog.toppings.find((x) => x.name === name && x.appliesTo === applies);
    t ? ids.push(t.id) : unknown.push(name);
  }
  return { ids, unknown };
}

export { KOREAN_NUM };
