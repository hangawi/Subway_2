// 여러 개 주문 (8단계, 10/22·10/23 예형님) — 말을 칸(1번·2번…)으로 나누는 규칙. 화면(app.ts)이 나눈 조각마다 /api/interpret를 부른다.
//  - 하나만 살 때는 여기서 아무것도 안 함 (null) → 지금 흐름 그대로
//  - 최대 5개 (일단 제한)
//  - "로스트 치킨 2개" (개수), "하나는 해장할 거, 하나는 가벼운 거" (칸마다 따로), "잠봉, 치킨, 스파이시" (짧은 이름 목록)
//  - 이미 담은 칸이 있을 때: "전부 토마토 빼", "1번은 제로콜라 2번은 콜라", "다 같은 걸로"
// 10/27 예형님: 10명까지 (전엔 5줄)
export const MAX_SLOTS = 10;

const NUM: Record<string, number> = { 한: 1, 하나: 1, 일: 1, 두: 2, 둘: 2, 이: 2, 세: 3, 셋: 3, 삼: 3, 네: 4, 넷: 4, 사: 4, 다섯: 5, 오: 5, 여섯: 6, 육: 6 };
const toNum = (w: string) => (/^\d+$/.test(w) ? Number(w) : NUM[w] ?? null);
/** 음료·사이드 이름 뒤의 개수는 단품 수량 ("콜라 2개") — 칸 수가 아님 */
const SIDE_WORD = /(?:콜라|사이다|스프라이트|제로|커피|아메리카노|라떼|음료|물|우유|주스|쿠키|칩|웨지|수프|스프|감자|소스|토핑|드레싱)$/;
/** 비교·고치기 말은 여러 개 주문이 아님 ("로스트 치킨이랑 비엠티 중에 뭐가 나아?", "로스트 치킨, 아니 비엠티") */
const NOT_MULTI = /중에|중\s|비교|뭐가|어느\s*게|어떤\s*게|차이|아니면|아니\s|아니야|말고|대신|vs/i;

/** 메뉴(또는 샌드위치·샐러드·랩) 개수: "로스트 치킨 2개", "샌드위치 세 개", "3개 주세요" — 음료·사이드 개수는 아님 */
export function parseCount(text: string): number | null {
  const t = text.normalize('NFC');
  const m = t.match(/([가-힣A-Za-z&]+)?\s*(\d{1,2}|한|두|세|네|다섯|여섯)\s*(?:개|인분|명분|개씩)/);
  if (!m) return null;
  if (m[1] && SIDE_WORD.test(m[1])) return null;
  // "소스 아무거나 두개"처럼 소스를 말한 개수
  if (/(?:소스|토핑|드레싱)\s*(?:아무거나|아무|암거나)?\s*$/.test(t.slice(0, m.index! + (m[1]?.length ?? 0)))) return null;
  const n = toNum(m[2]!);
  return n && n >= 2 ? n : null;
}

/** "하나는 A, 하나는 B" / "한 개는 A 다른 하나는 B" → [A, B]. 표시가 2개 넘게 없으면 null */
export function splitEach(text: string): string[] | null {
  const marks = /(?:^|\s|,)(?:(?:다른|또|나머지|마지막)\s*)?(?:하나|한\s*개|한\s*명|1개)(?:는|은)\s*/g;
  const t = text.normalize('NFC');
  const idx = [...t.matchAll(marks)].map((m) => ({ at: m.index!, end: m.index! + m[0].length }));
  if (idx.length < 2) return null;
  const parts = idx.map((m, i) => t.slice(m.end, idx[i + 1]?.at ?? t.length).replace(/^[,\s]+|[,\s]+$/g, '').replace(/(?:으로|로)?\s*(?:해\s*줘|해주세요|주세요|줘)$/, '').trim()).filter(Boolean);
  return parts.length >= 2 ? parts.slice(0, MAX_SLOTS) : null;
}

/** 짧은 이름 목록 "잠봉, 치킨, 스파이시" / "잠봉이랑 로스트 치킨이랑 비엠티" → 조각마다 메뉴 또는 조건 (조각이 다 짧을 때만 — 긴 문장의 쉼표는 한 사람 주문) */
export function splitList(text: string, protect: readonly string[] = []): string[] | null {
  const t = text.normalize('NFC').trim();
  if (NOT_MULTI.test(t)) return null;
  const body = t.replace(/\s*(?:으로|로)?\s*(?:주세요|줘|해\s*줘|해주세요|할게|할게요|시킬게|먹을게)$/, '');
  // "하고"로는 나누지 않음 ("운동하고 와서"), "랑"은 낱말 뒤에 붙은 것만
  const split = body.split(/\s*,\s*|\s+그리고\s+|(?<=[가-힣A-Za-z])(?:이랑|랑)\s+/).map((x) => x.replace(/(?:이랑|랑)$/, '').trim()).filter(Boolean);
  // 공식 메뉴 이름에 쉼표가 든 것 ("잠봉, 에그&치즈", "웨스턴, 에그 & 치즈")은 다시 붙임
  const sq = (x: string) => x.replace(/[\s,]/g, '');
  const names = protect.map(sq);
  const parts: string[] = [];
  for (const x of split) {
    const last = parts[parts.length - 1];
    if (last !== undefined && !names.includes(sq(last)) && names.some((n) => sq(last + x).includes(n) && !sq(last).includes(n))) parts[parts.length - 1] = `${last}, ${x}`;
    else parts.push(x);
  }
  if (parts.length < 2 || parts.some((p) => p.replace(/\s/g, '').length > 12)) return null;
  // "로스트 치킨에 콜라", "양파 빼고" 처럼 붙이는 말·옵션이 있으면 한 사람 주문
  if (parts.some((p) => /[가-힣]에\s|에다가?|빼|추가|넣|많이|더\s|소스|알레르기|세트|없이|없는|못\s*먹/.test(p))) return null;
  return parts.slice(0, MAX_SLOTS);
}

/** 이미 담은 칸 고치기: "전부 토마토 빼, 1번은 제로콜라, 2번은 콜라" → { all: "토마토 빼", byNo: {1: "제로콜라", 2: "콜라"} } */
export function splitEdits(text: string, slots: number): { all: string | null; byNo: Record<number, string>; sameAll: boolean } | null {
  const t = text.normalize('NFC');
  // "1번이랑 2번 뭐가 달라"는 비교 질문 (고치기 아님) — 10/26 장바구니에서 찾음
  if (/뭐가|달라|다른\s*점|차이|비교|왜|어때|나아|좋아\?|추천했/.test(t)) return null;
  const marks: Array<{ at: number; end: number; no: number | 'all' }> = [];
  for (const m of t.matchAll(/(?:^|\s|,)(\d|첫|두|세|네|다섯)\s*(?:번째|번)\s*(?:꺼|거|것|칸)?\s*(?:는|은|에는|에)?\s*/g)) {
    const w = m[1]!;
    const no = w === '첫' ? 1 : (toNum(w) ?? 0);
    if (no >= 1 && no <= slots) marks.push({ at: m.index!, end: m.index! + m[0].length, no });
  }
  for (const m of t.matchAll(/(?:^|\s|,)(?:(?:\d|다섯|네|세|두)\s*개\s*)?(?:전부|모두|다|싹\s*다)\s*(?:다\s*)?/g)) marks.push({ at: m.index!, end: m.index! + m[0].length, no: 'all' });
  const sameAll = /(?:다|전부|모두)\s*(?:같은\s*걸로|똑같이|같은\s*거로|같은\s*메뉴로)|(?:같은\s*걸로|똑같이)\s*(?:다|전부|\d\s*개)/.test(t);
  if (!marks.length && !sameAll) return null;
  marks.sort((a, b) => a.at - b.at);
  const out: { all: string | null; byNo: Record<number, string>; sameAll: boolean } = { all: null, byNo: {}, sameAll };
  marks.forEach((m, i) => {
    const seg = t.slice(m.end, marks[i + 1]?.at ?? t.length).replace(/^[,\s]+|[,\s]+$/g, '').trim();
    if (!seg) return;
    if (m.no === 'all') out.all = out.all ? `${out.all} ${seg}` : seg;
    else out.byNo[m.no] = out.byNo[m.no] ? `${out.byNo[m.no]} ${seg}` : seg;
  });
  if (!out.all && !Object.keys(out.byNo).length && !sameAll) return null;
  return out;
}

/** 칸 이름: "1번 · 나", "2번 · 일행 1" */
export const slotLabel = (i: number, owner: 'me' | number) => `${i + 1}번 · ${owner === 'me' ? '나' : `일행 ${owner}`}`;

/** 짧은 목록이 정말 여러 개 주문인지 (조각마다 해석한 결과로): 조각이 모두 "샌드위치·샐러드·랩 메뉴" 또는 "고르는 조건(치킨·매운 거 등)"이고 메뉴가 하나 이상
 *  — 음료·사이드만("콜라랑 쿠키만")·알레르기 목록("우유, 땅콩 못 먹어")은 한 사람 주문 */
export function listIsMulti(items: ReadonlyArray<{ menu: boolean; singles: boolean; cond: boolean }>): boolean {
  return items.length >= 2 && items.every((x) => (x.menu && !x.singles) || (!x.menu && x.cond)) && items.some((x) => x.menu && !x.singles);
}

/** 목록 조각이 "고르는 조건"인지: 짧은 이름 낱말만 — "치킨"(메인 재료), "스파이시"(메뉴 이름에 든 말). "매콤하게"·"살 안 찌는 거"처럼 꾸미는 말은 그 메뉴의 조건 (10/26: 10,841문장에서 174개 잘못 나누던 것) */
export function condPiece(part: string, prefs: { wantMains?: readonly string[]; wantSpicy?: boolean; goal?: string | null }): boolean {
  if (part.replace(/\s/g, '').length > 5 || prefs.goal) return false;
  return (!!prefs.wantMains?.length && !prefs.wantSpicy) || /^스파이시$/.test(part.trim());
}

/** 사람 수: "3명이야", "우리 네 명", "4명이서 먹을 거야" → 3·4 (2~5명). "한 명 더 와"는 moreOne */
export function parsePeople(text: string): { people: number | null; moreOne: boolean } {
  const t = text.normalize('NFC').replace(/\s+/g, ' ');
  const moreOne = /(?:한|1)\s*명\s*(?:더|추가)/.test(t);
  const m = moreOne ? null : t.match(/(?:^|\s|우리\s*)(\d|두|세|네|다섯)\s*명(?:이야|이에요|이요|이서|이 먹|이 같이|이 왔|임|이|\s|$)/);
  const n = m ? toNum(m[1]!) : null;
  return { people: n && n >= 2 ? Math.min(n, MAX_SLOTS) : null, moreOne };
}

/** 사람 이름별 말: "민수는 매운 거 못 먹어, 지은이는 새우 알레르기" / "민수 거 소스 빼 줘" → [{name:'민수', text:'매운 거 못 먹어'}, …]
 *  이름은 한글 2~3자 + 는·은·이는·거(는). "나는·저는·우리는·하나는"처럼 이름이 아닌 말은 뺌 */
const NOT_NAME = /^(?:나|저|너|우리|저희|하나|다른|또|나머지|마지막|이거|그거|저거|오늘|내일|점심|저녁|아침|야식|소스|빵|치즈|야채|메뉴|세트|음료|콜라|사이다|커피|토마토|양파|오이|피클|올리브|할라피뇨|양상추|피망|매운|가벼운|든든한|하나만|전부|모두|첫|두|세|네|다섯|이번|지난번|저번|평소|원래|그냥|아니|진짜|완전|제일|가장|일행|친구|동생|엄마|아빠|형|누나|언니|오빠|사람|사람들|분|애|애들|아이|어른|우리|저희|남편|아내|와이프|부장|팀장|과장|사장|선배|후배|회사|같이|혼자)$/;
/** 꾸미는 말·움직씨 끝 ("들어간 거", "많은 거", "먹었던 거", "마실 거는", "맛있는") — 이름이 아님 */
const VERBISH = /(?:는|은|던|을|간|운|른|한|된|진|있|없|실|많|적|낮|높|찌|들어|먹|마)$/;
export function splitNames(text: string, known: ReadonlySet<string> = new Set()): Array<{ name: string; text: string }> | null {
  const t = text.normalize('NFC');
  const re = /(?:^|\s|,)([가-힣]{2,3}?)(이는|는|은|이\s*거는|\s*거는|\s*거|이\s*거|\s*꺼는|\s*꺼)\s+/g;
  const marks = [...t.matchAll(re)]
    .filter((m) => !NOT_NAME.test(m[1]!) && !known.has(m[1]!) && (/^이/.test(m[2]!.trim()) || !VERBISH.test(m[1]!)))
    .map((m) => ({ name: m[1]!, at: m.index!, end: m.index! + m[0].length }));
  if (!marks.length) return null;
  const out = marks.map((m, i) => ({ name: m.name, text: t.slice(m.end, marks[i + 1]?.at ?? t.length).replace(/^[,\s]+|[,\s]+$/g, '').trim() })).filter((x) => x.text);
  return out.length ? out : null;
}

const QTY_WORD = String.raw`하나|한\s*개|1\s*개|둘|두\s*개|2\s*개|셋|세\s*개|3\s*개|넷|네\s*개|4\s*개|다섯\s*개|5\s*개`;
const qtyOf = (w: string) => {
  const t = w.replace(/\s/g, '');
  return /^(?:하나|한개|1개)$/.test(t) ? 1 : /^(?:둘|두개|2개)$/.test(t) ? 2 : /^(?:셋|세개|3개)$/.test(t) ? 3 : /^(?:넷|네개|4개)$/.test(t) ? 4 : 5;
};
/** 개수로 나눈 말 (10/26 예형님): "든든한 거 하나 가벼운 거 하나 매운 거 하나", "든든한 거 둘 가벼운 거 하나", "이거 하나 저거 하나",
 *  "매운 거랑 안 매운 거 하나씩", "나는 두 개 민수는 하나" → [{text, qty}]. 조각이 2개 넘게 없으면 null (뜻은 화면이 조각마다 다시 읽음) */
export function splitCounted(text: string): Array<{ text: string; qty: number }> | null {
  const t = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (NOT_MULTI.test(t)) return null;
  const clean = (x: string) => x.replace(/^(?:그리고|그다음|또|랑|이랑|하고|,)\s*/, '').replace(/\s*(?:랑|이랑|하고|그리고|,)$/, '').replace(/^(?:음|아|저기|그니까)\s+/, '').trim();
  // "A랑 B 하나씩" / "A, B 한 개씩"
  const each = t.match(new RegExp(String.raw`^(.+?)\s*(?:랑|이랑|하고|,)\s*(.+?)\s*(?:${QTY_WORD})씩(?:\s|$)`));
  if (each && each[1] && each[2]) return [{ text: clean(each[1]), qty: 1 }, { text: clean(each[2]), qty: 1 }];
  const re = new RegExp(String.raw`(.+?)\s*(${QTY_WORD})(?=\s|,|$|랑|이랑|하고|씩|만|요|줘|주세요)(?:씩)?`, 'g');
  const out: Array<{ text: string; qty: number }> = [];
  let last = 0;
  for (const m of t.matchAll(re)) {
    const seg = clean(m[1]!);
    if (!seg) return null;
    out.push({ text: seg, qty: qtyOf(m[2]!) });
    last = m.index! + m[0].length;
  }
  // 끝에 남은 말이 "주세요·줘·추천해줘"가 아니면 (조각 뒤에 다른 말이 길게) 나누지 않음
  const rest = t.slice(last).replace(/^[\s,]*(?:만|요|씩)?/, '').replace(/(?:으로|로)?\s*(?:주세요|줘|해\s*줘|해주세요|추천해\s*줘|추천|할게요?|시킬게|먹을게|부탁해요?)?[.!?~\s]*$/, '').trim();
  if (out.length < 2 || rest) return null;
  return out.slice(0, MAX_SLOTS);
}
/** 여러 개일 수 있는 신호 (규칙이 못 나눴을 때만 AI에게 물음): 개수·"각각"·"씩"·"명"·"이거 저거" */
export const MAYBE_MANY = /하나|한\s*개|두\s*개|세\s*개|네\s*개|\d\s*개|둘|셋|각각|씩|\d\s*명|두\s*명|세\s*명|네\s*명|이거.*저거|따로/;

/** 개수로 나눈 조각이 정말 여러 개 주문인지: 조각마다 메뉴(음료·사이드 말고)·고르는 조건·"이거/저거"·사람("나는", 이름) 중 하나 — 음료·사이드만이면 한 사람 주문 ("콜라 하나 쿠키 하나") */
export const DEICTIC = /^(?:이거|요거|이걸로|이것|저거|저것|그거|그것)$/;
export const OWNER_ONLY = /^(?:나는|난|저는|전|내\s*거는|내\s*꺼는|[가-힣]{2,3}(?:이는|는|은))$/;
export function countedIsMulti(items: ReadonlyArray<{ text: string; menu: boolean; singles: boolean; cond: boolean }>): boolean {
  return items.length >= 2 && items.every((x) => (x.menu && !x.singles) || (!x.menu && x.cond) || DEICTIC.test(x.text) || OWNER_ONLY.test(x.text));
}

/** "이거 두 개", "저거 하나 주세요" (10/26) */
export const DEICTIC_QTY = /^(이거|요거|이걸로|저거|저걸로|그거|그걸로)\s*(?:로|으로)?\s*(하나|한\s*개|둘|두\s*개|셋|세\s*개|넷|네\s*개|\d{1,2}\s*개)\s*(?:만|씩)?\s*(?:주세요|줘|할게요?|요|담아\s*줘|담아)?[.!~]*$/;
/** 개수 낱말 → 숫자 ("두 개" → 2, "12개" → 12) */
/** "나는 두 개 먹을 거야" (10/27 예형님: 한 사람이 두 개) → 2. 메뉴는 화면이 따로 봄 (메뉴를 말했으면 다른 규칙) */
export function selfCount(text: string): number | null {
  const m = text.trim().match(/^(?:나|난|저|전|내가|제가)(?:는|은)?\s*(두\s*개|둘|세\s*개|셋|네\s*개|넷|\d{1,2}\s*개)\s*(?:먹을\s*(?:거야|게|래|거예요|께요)?|먹어요?|시킬\s*(?:게|거야|래)?|할\s*(?:게|래)?|줘|주세요|요)?[.!~]*$/);
  return m ? countWord(m[1]!) : null;
}
export function countWord(w: string): number {
  const t = w.replace(/\s/g, '').replace(/개$/, '');
  return /^\d+$/.test(t) ? Number(t) : ({ 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4 } as Record<string, number>)[t] ?? 1;
}
