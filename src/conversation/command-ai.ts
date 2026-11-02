// AI가 명령 → 규칙이 검사 (10/26 예형님 "ChatGPT처럼 어떤 말이든"): 문장 전체를 AI가 장바구니 명령으로 바꾸고, 코드는 검사·적용만 한다.
// 지금은 측정용 (scripts/ai-command-eval.ts) — 실제 서비스(규칙 먼저 + AI 보조)는 예형님 결정 뒤에 바꾼다.
//  - AI에게 메뉴·재료를 이름으로 보여 준다 (10/21 측정: 번호(menu_1234)만 주면 엉뚱한 메뉴를 고름) → 코드가 이름을 id로
//  - 검사: 메뉴·재료는 메뉴판에 있는 이름만, 알레르기는 말에 "알레르기·못 먹" 같은 말이 있을 때만, 줄 번호는 장바구니 안, 개수 1~10, 이름은 말에 있는 것만
//  - 버린 것은 dropped에 이유와 함께 (화면은 "○○를 못 알아들었어요")
import type { SubwayCatalog } from '../catalog/subway-catalog.ts';
import { MAIN_KINDS } from '../subway-menu/menu-domain.ts';
import { SET_ITEMS } from '../order-sheet/order-sheet.ts';
import { DRINKS, KINDS, validateIntent, type Intent } from './intent-schema.ts';
import { ALLERGY_ALIASES } from './aliases.ts';
import { parseRules } from './rules.ts';

export type CmdOp = 'ADD' | 'EDIT' | 'REMOVE' | 'RECOMMEND' | 'ASK_WHY' | 'COMPARE' | 'ORDER' | 'LAST';
export interface CartLineView {
  /** 1부터 */
  no: number;
  menu: string;
  qty: number;
  owner: 'ME' | 'GUEST';
  name?: string;
  summary?: string;
  /** 화면에서 지금 고르는 줄 */
  current?: boolean;
}
export interface Command {
  op: CmdOp;
  /** 고칠 줄 (1부터), 'ALL' = 전부, null = 새 줄·해당 없음 */
  line: number | 'ALL' | null;
  qty: number | null;
  owner: 'ME' | 'GUEST' | null;
  name: string | null;
  /** 사람 번호 (1 = 말하는 나, 2부터 같이 먹는 사람) — "한 명은 두 개" 같은 말을 사람끼리 묶음 (10/27) */
  person: number | null;
  /** ③ 추천 N번째 ("이거" = 1, "저거" = 2) */
  pick: number | null;
  /** 검사한 해석 (메뉴 id·조건·옵션 id) */
  intent: Intent;
}
/** 한 사람·한 장바구니에 최대 (10/27 예형님: 10명까지) */
export const MAX_PEOPLE = 10;

const SET_ITEM_NAMES = Object.values(SET_ITEMS).flatMap((x) => x.names);
const squash = (s: string) => s.normalize('NFC').replace(/[\s&,.()·]/g, '').toLowerCase();

// 10/27 예형님 "젬마가 주도적으로": 모든 말을 젬마가 먼저 읽는다. 답은 "바꿀 것만" 짧게 (전엔 줄마다 칸 40개를 다 채워 11명이면 12초를 넘김)
//  set = 옵션 [{k, v}], want = 조건 [{k, v}] — 값은 메뉴판 이름 그대로, 코드가 이름을 확인해 id로
const SET_KEYS = ['size', 'bread', 'cheese', 'noCheese', 'addVeg', 'removeVeg', 'sauce', 'addSauce', 'noSauce', 'topping', 'set', 'noSet', 'drink', 'setItem'] as const;
const WANT_KEYS = ['allergy', 'goal', 'wantMain', 'avoidMain', 'kind', 'spicy', 'notSpicy', 'lowFat', 'place'] as const;

/** AI 지시문 */
export function commandInstructions(catalog: SubwayCatalog): string {
  const names = (kind: string) => catalog.ingredients.filter((i) => i.category === kind).map((i) => i.name).join(', ');
  return `너는 써브웨이 주문 도우미다. 손님 말을 읽고 "몇 명이 무엇을 몇 개, 어떤 조건으로" 원하는지 명령 목록으로 바꾼다. 메뉴 순위는 엔진이 정한다.
답 모양: { reason, commands }
- reason: 손님이 말한 상황·이유를 한 줄로 (예: 감기, 해장, 운동 끝나고, 야구부 5명, 시험 기간, 야근). 조건(가볍게·단백질·예산·메뉴)만 말했거나 "추천해줘·뭐 먹지"뿐이면 null — 조건을 다시 쓰지 않는다. 병을 고친다·안전하다 같은 말은 쓰지 않는다.
- commands: 명령마다 {op, line, all, qty, person, name, pick, menu, set, want}. 안 쓰는 칸은 null, set·want는 바꿀 것만 (없으면 []).
명령 op:
- ADD: 새 줄 담기. 메뉴를 말했으면 menu, "이거·저거"면 pick(이거=1, 저거·그거=2), 메뉴 없이 조건만이면 menu=null + want. qty는 개수(말 없으면 1).
- EDIT: 담은 줄 고치기. line은 줄 번호, "전부·둘 다·다"는 all=true. 장바구니가 비어 있으면 EDIT·REMOVE를 쓰지 않는다 (메뉴 이름과 옵션을 말하면 ADD).
- budget: 예산(원)은 숫자 칸 budget에 (예: "8천원 이하" → 8000, "만 이천 원" → 12000). 없으면 null.
- REMOVE: 줄 빼기 (line). RECOMMEND: 한 사람이 메뉴·개수 없이 조건으로 추천만 원할 때. ASK_WHY·COMPARE: 질문. ORDER: "이대로 주문할게". LAST: "지난번처럼·저번이랑 똑같이·늘 먹던 걸로" (지난 주문 불러오기 — 뒤에 붙인 옵션은 set에).
사람:
- person은 사람 번호: 1 = 말하는 사람(나), 2부터 같이 먹는 사람. name은 말한 이름만 (조사·"이"는 뺀다: "지은이는" → 지은, "민수가" → 민수), 없으면 null.
- 사람 수를 말하면("3명이야", "야구부 5명", "우리 넷") 사람마다 ADD 한 줄 (person 1~N, menu=null, 그 사람들 공통 조건은 줄마다 want에). 최대 ${MAX_PEOPLE}명.
- "한 명은 ~, 한 명은 ~"은 사람마다 다른 person. 한 사람이 여러 개면 같은 person으로 ADD 여러 줄 ("한 명은 매운 거랑 든든한 거 하나씩" → 같은 person ADD 2줄).
- "나머지 두 명은 하나씩"처럼 조건 없이 개수만 말한 사람도 사람마다 ADD 한 줄.
- 여럿 중 일부만 다르면 사람마다 그 사람 것을 적는다 ("5명 매운 소고기, 3명은 제로콜라 2명은 콜라, 하나는 토마토 빼" → 5명 모두 want[spicy, wantMain 쇠고기], 그중 3명 drink 제로콜라(그중 1명 removeVeg 토마토), 2명 drink 콜라).
- 같은 메뉴·같은 조건 N개는 한 줄 qty N ("이거 두 개" → ADD pick 1 qty 2, "해장할 거 두 개" → ADD qty 2 want[lowFat]). 사람을 말했을 때만 사람마다 줄. 같은 메뉴 여럿 중 하나만 다르면 줄을 나눈다 ("로스트 치킨 두 개, 하나만 양파 빼" → 양파 뺀 1줄 + 그냥 1줄).
- "나는 ~ 민수는 ~"에서 "나"를 말하지 않았으면 맨 앞에 person 1 줄을 하나 둔다 (사람 수에 나 포함).
- 이름 뒤에 "는·은·이는·가·도"가 붙으면 사람 이름이다 (지우는·하늘이는·나라도). 낱말 뜻(지우다·하늘)으로 읽지 않는다. 그 사람이 말한 메뉴·알레르기는 그 사람 줄에 같이 ("수아는 에그마요 땅콩 알러지, 나는 참치" → person2 name 수아 menu 에그마요 want[allergy 땅콩] + person1 menu 참치).
- 음료·사이드(콜라·쿠키·칩)만 따로 말하면 새 줄이 아니라 바로 앞 메뉴 줄에 붙인다.
set 키 (옵션): size(15cm|30cm), bread, cheese, noCheese("true"), addVeg, removeVeg, sauce(소스를 이것으로), addSauce(지금 소스에 더하기: "랜치도 추가"), noSauce("true"), topping, set, noSet("true"), drink(${DRINKS.join('|')}), setItem
want 키 (조건): allergy(알레르기 재료), goal(PROTEIN|LIGHT|FILLING), wantMain·avoidMain(${MAIN_KINDS.join('|')}), kind(SANDWICH|SALAD|WRAP|MORNING_SANDWICH|MORNING_WRAP), spicy("true"), notSpicy("true"), lowFat("true"), place(장소 이름)
- 여러 개면 같은 키를 여러 번 ({k:"removeVeg",v:"양파"}, {k:"removeVeg",v:"오이"}).
상황 말 → 조건 (메뉴 값으로 고를 수 있게):
- 감기·몸살·속이 안 좋음 → 따뜻한 수프 세트(set 수프 음료 세트, setItem 오늘의 수프), notSpicy, lowFat. 해장 → 수프 세트 + lowFat.
- 운동 후·야구부·배고픔·든든하게 → goal FILLING 또는 PROTEIN. 다이어트·가볍게 → LIGHT.
- 상황에 맞는 조건이 없으면 지어내지 말고 reason만.
지키는 것:
- 알레르기는 "알레르기·못 먹어·먹으면 안 돼"처럼 분명히 말한 재료만 (계란·달걀→난류, 갑각류→게·새우, 소고기→쇠고기). 싫어함("별로")은 avoidMain.
- 이름은 아래 메뉴판에 있는 것만, 손님이 말한 것과 가장 같은 것. 말에 없는 메뉴·재료·알레르기를 만들지 않는다.
- 말을 고치면 마지막 말만 ("홀스래디쉬 아니 랜치로" → 랜치).
- 줄을 말하면 그 줄 ("1번"·"첫 번째 거"·"맨 위에 거"·"위에 거" = 1번, "두 번째"·"아래 거" = 2번). 줄을 말하지 않고 "아까 거기서·그거에"처럼만 말하면 [화면에 열린 줄].
- "하나 더"는 그 줄 EDIT qty = 지금 개수 + 1. "2번 ○○로 바꿔"는 EDIT line 2 menu ○○.
예:
- "야구부 5명인데 든든하게" → reason "야구부 5명이 든든하게", ADD person 1~5 각 want [goal FILLING]
- "한 명은 매운 거랑 든든한 거 하나씩, 한 명은 가벼운 거에 토마토 빼고" → ADD person1 want[spicy], ADD person1 want[goal FILLING], ADD person2 want[goal LIGHT] set[removeVeg 토마토]
- (장바구니 1번 로스트 치킨, 2번 참치) "1번 빵은 허니오트, 2번은 땅콩 알레르기" → EDIT line1 set[bread 허니오트], EDIT line2 want[allergy 땅콩]
- "둘 다 양파 빼고 30cm" → EDIT all true set[removeVeg 양파, size 30cm]
- "감기 걸렸는데 추천해줘" → reason "감기라서 따뜻하고 자극 적은 것", RECOMMEND want[notSpicy, lowFat] set[set 수프 음료 세트, setItem 오늘의 수프]
말 사전: 비엠티=이탈리안 비엠티, 스테치=스테이크 & 치즈, 에마=에그마요, 튜나=참치, 로티=로티세리 바비큐 치킨, 치데·데리야끼=치킨 데리야끼, 클럽=써브웨이 클럽, 풀드포크=풀드포크 바비큐, blt=비엘티, 피자=피자썹, 야채샌드위치=베지. 쿠키세트=쿠키 음료 세트, 칩세트=칩 음료 세트, 웨지세트=웨지 음료 세트, 수프·스프=수프 음료 세트(setItem 오늘의 수프). 30·30센치·큰 거=30cm. 아메리카노=커피.
[메뉴판]
- 메뉴: ${catalog.menus.map((m) => m.name).join(', ')}
- 빵: ${names('BREAD')}
- 치즈: ${names('CHEESE')}
- 야채: ${names('VEGETABLE')}
- 소스: ${names('SAUCE')}
- 토핑: ${catalog.toppings.map((t) => t.name).join(', ')}
- 세트: ${catalog.sets.map((x) => x.name).join(', ')} / 세트 구성품: ${SET_ITEM_NAMES.join(', ')}`;
}

/** 학습한 젬마(subway 어댑터)용 짧은 설명서 (10/28 2부): 형식·판단은 학습으로 익혔으니 핵심만 — 학습 시간·답 시간 줄이기 */
export function commandInstructionsShort(): string {
  return `너는 써브웨이 주문 도우미다. 손님 말을 { reason, commands } JSON으로 바꾼다.
- commands: {op(ADD|EDIT|REMOVE|RECOMMEND|ASK_WHY|COMPARE|ORDER|LAST), line, all, qty, person(1=나), name, pick(이거=1·저거=2), menu, budget(원), set[{k,v}], want[{k,v}]}. 안 쓰는 칸은 null.
- 사람마다·메뉴마다 줄, 같은 것 N개는 qty N. 알레르기는 말한 재료만. 메뉴판에 없는 이름·말에 없는 것은 만들지 않는다.
- reason은 상황(감기·운동 후·야구부 등)이 있을 때만 한 줄.`;
}

/** JSON 형식: 숫자 칸은 고를 수 있는 값만, 메뉴는 메뉴판 이름만, 옵션·조건은 키만 정하고 값은 코드가 확인 */
export function commandSchema(catalog: SubwayCatalog): Record<string, unknown> {
  const nul = (t: Record<string, unknown>) => ({ anyOf: [t, { type: 'null' }] });
  const obj = (props: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
  const kv = (keys: readonly string[]) => ({ type: 'array', items: obj({ k: { type: 'string', enum: [...keys] }, v: { type: 'string' } }) });
  const command = obj({
    op: { type: 'string', enum: ['ADD', 'EDIT', 'REMOVE', 'RECOMMEND', 'ASK_WHY', 'COMPARE', 'ORDER', 'LAST'] },
    // 숫자 칸은 고를 수 있는 값만 (10/27: 젬마가 줄 번호에 0을 끝없이 이어 써 답이 끊기던 것 20번)
    line: nul({ type: 'integer', enum: range(MAX_PEOPLE) }),
    all: nul({ type: 'boolean' }),
    qty: nul({ type: 'integer', enum: range(10) }),
    person: nul({ type: 'integer', enum: range(MAX_PEOPLE) }),
    name: nul({ type: 'string' }),
    pick: nul({ type: 'integer', enum: [1, 2, 3] }),
    // 예산은 숫자 칸 (10/27: 글자 칸에 두니 젬마가 "8천원"을 "]."처럼 깨뜨려 씀)
    budget: nul({ type: 'integer' }),
    menu: nul({ type: 'string', enum: [...new Set(catalog.menus.map((m) => m.name))] }),
    set: kv(SET_KEYS),
    want: kv(WANT_KEYS),
  });
  return obj({ reason: nul({ type: 'string' }), commands: { type: 'array', items: command } });
}

/** 짧은 답(set·want 목록) → 검사기가 보는 모양(conditions·options). 예전 모양(conditions·options)이면 그대로 */
function expand(c: Record<string, any>): Record<string, any> {
  if (c.conditions || c.options) return { ...c, allLines: c.allLines ?? c.all ?? null };
  const conditions: Record<string, any> = {};
  const options: Record<string, any> = {};
  const push = (t: Record<string, any>, k: string, v: unknown) => (t[k] = [...(t[k] ?? []), v]);
  const yes = (v: string) => !/^(false|no|0|아니)/i.test(v.trim());
  for (const { k, v: raw } of Array.isArray(c.set) ? c.set : []) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (k === 'size') options.size = /30/.test(v) ? '30cm' : /15/.test(v) ? '15cm' : undefined;
    else if (k === 'bread') options.bread = v;
    else if (k === 'cheese') options.cheese = v;
    else if (k === 'noCheese' && yes(v)) options.cheese = 'NONE';
    else if (k === 'addVeg') push(options, 'addVegetables', v);
    else if (k === 'removeVeg') push(options, 'removeVegetables', v);
    else if (k === 'sauce') push(options, 'sauces', v);
    else if (k === 'addSauce') push(options, 'sauces', v), (options.saucesAdd = true);
    else if (k === 'noSauce' && yes(v)) options.noSauce = true;
    else if (k === 'topping') push(options, 'toppings', v);
    else if (k === 'set') options.set = v;
    else if (k === 'noSet' && yes(v)) options.set = 'NONE';
    else if (k === 'drink') options.drink = v === '아메리카노' ? '커피' : v;
    else if (k === 'setItem') options.setItem = v;
  }
  for (const { k, v: raw } of Array.isArray(c.want) ? c.want : []) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    if (k === 'allergy') push(conditions, 'allergies', v === '계란' || v === '달걀' ? '난류' : v === '소고기' ? '쇠고기' : v);
    else if (k === 'budget') conditions.budgetKrw = Number(v.replace(/[^0-9]/g, '')) || undefined;
    else if (k === 'goal') conditions.goal = v.toUpperCase();
    else if (k === 'wantMain') push(conditions, 'wantMains', v === '소고기' ? '쇠고기' : v);
    else if (k === 'avoidMain') push(conditions, 'avoidMains', v === '소고기' ? '쇠고기' : v);
    else if (k === 'kind') push(conditions, 'kinds', v.toUpperCase());
    else if (k === 'spicy' && yes(v)) conditions.wantSpicy = true;
    else if (k === 'notSpicy' && yes(v)) conditions.avoidSpicy = true;
    else if (k === 'lowFat' && yes(v)) conditions.lowFat = true;
    else if (k === 'place') conditions.place = v;
  }
  // 세트 없이 음료만 → 단품 음료 (규칙과 같게 "제로콜라" → 코카콜라 제로 단품, 10/19)
  if (options.drink && !options.set) {
    const single = DRINK_SINGLE[options.drink as string];
    if (single) options.extras = [{ name: single, qty: 1 }];
    delete options.drink;
  }
  if (Number.isInteger(c.budget) && c.budget >= 1000 && c.budget <= 200000) conditions.budgetKrw = c.budget;
  return { ...c, allLines: c.all ?? null, conditions, options };
}
const DRINK_SINGLE: Record<string, string> = { 콜라: '코카콜라 (355ml)', 제로콜라: '코카콜라 제로 (355ml)', 사이다: '스프라이트 (355ml)', 제로사이다: '스프라이트 제로 (355ml)', 커피: '아메리카노' };

/** AI에 줄 입력: 손님 말 + 지금 장바구니 + 지금 추천 */
export function commandInput(text: string, cart: readonly CartLineView[], recs: readonly string[]): string {
  const c = cart.length ? cart.map((l) => `${l.no}번: ${l.menu} ×${l.qty}${l.owner === 'GUEST' ? ` (${l.name ?? '같이 먹는 사람'} 거)` : ''}${l.summary ? ` — ${l.summary}` : ''}`).join('\n') : '(비어 있음)';
  const cur = cart.find((l) => l.current);
  return `[장바구니]\n${c}\n${cur ? `[화면에 열린 줄] ${cur.no}번 (줄을 말하지 않고 "그거·아까 거기서"라고만 하면 이 줄)\n` : ''}[지금 추천]\n${recs.length ? recs.map((r, i) => `${i + 1}. ${r}`).join('\n') : '(없음)'}\n[손님 말]\n${text.slice(0, 300)}`;
}

// AI가 쓴 상황 한 줄: 짧게, 장담·치료 말 없이, 말에 없는 메뉴 이름 없이
const REASON_BANNED = /치료|낫|효능|효과|면역|보장|안전|걱정 없|약|병원|!/;
export function validReason(raw: unknown, text: string, catalog: SubwayCatalog): string | null {
  if (typeof raw !== 'string') return null;
  const r = raw.replace(/\s+/g, ' ').trim();
  if (r.length < 2 || r.length > 60 || REASON_BANNED.test(r)) return null;
  const flat = squash(text);
  if (catalog.menus.some((m) => r.includes(m.name) && !flat.includes(squash(m.name)))) return null;
  return r;
}

/** 메뉴 줄임말 (지시문 "말 사전"과 같게) — 낱말 검사에 더함 */
const MENU_SHORT: Record<string, string[]> = {
  '이탈리안 비엠티': ['bmt'], '스테이크 & 치즈': ['스테치'], 에그마요: ['에마'], 참치: ['튜나'], '로티세리 바비큐 치킨': ['로티'], '치킨 데리야끼': ['치데'], 비엘티: ['blt'], 피자썹: ['피자'], 베지: ['야채샌드위치'],
};
// 사투리·말투 포함 ("못 묵는다", "먹으면 큰일 나" — 10/26 측정에서 AI가 맞게 낸 알레르기를 이 검사가 지웠던 것)
const ALLERGY_SAID = /알레르기|알러지|알라지|못\s*[먹묵]|[먹묵]으면\s*(?:안|큰일)|큰일\s*나|두드러기|체질/;

/** 말에 나온 알레르기 재료 (한 글자 게·콩·밀·잣·닭은 따로 떨어진 낱말일 때만 — rules.ts와 같게) */
function saidAllergens(text: string, catalog: SubwayCatalog): Set<string> {
  // 메뉴 이름 속 낱말은 빼고 봄 (10/27 실제 주소: "에그마요"의 "에그"를 계란으로 쳐서 젬마가 낸 "난류"를 통과시킴)
  let t = text.normalize('NFC');
  for (const m of [...catalog.menus].sort((a, b) => b.name.length - a.name.length)) for (const n of [m.name, m.name.replace(/\s+/g, '')]) t = t.split(n).join(' ');
  const out = new Set<string>();
  for (const [k, list] of Object.entries(ALLERGY_ALIASES)) {
    const hit = k.length === 1 ? new RegExp(`(?:^|[^가-힣])${k}`).test(t) : squash(t).includes(squash(k));
    if (hit) for (const a of list) out.add(a);
  }
  return out;
}

/** AI 답 검사: 이름 → id, 말에 근거 없는 것·범위 밖은 버림 */
export function validateCommands(raw: unknown, catalog: SubwayCatalog, text: string, cartSize: number): { commands: Command[]; dropped: string[]; reason: string | null } {
  const dropped: string[] = [];
  const list = (raw as { commands?: unknown })?.commands;
  if (!Array.isArray(list)) return { commands: [], dropped: ['NO_COMMANDS'], reason: null };
  const reason = validReason((raw as { reason?: unknown }).reason, text, catalog);
  const flat = squash(text);
  // 이름은 띄어쓰기·괄호가 달라도 같은 것으로 ("피망" = "피망(파프리카)", "스위트어니언" = "스위트 어니언")
  const byName = <T extends { name: string; id: string }>(xs: readonly T[], n: unknown) => (typeof n === 'string' ? (xs.find((x) => x.name === n) ?? xs.find((x) => squash(x.name) === squash(n)) ?? xs.find((x) => squash(x.name.replace(/\(.*\)/, '')) === squash(n)))?.id : undefined);
  const ing = (n: unknown) => byName(catalog.ingredients, n);
  const ings = (v: unknown) => (Array.isArray(v) ? v.map(ing).filter((x): x is string => !!x) : v);
  const out: Command[] = [];
  let ruleAllergies: string[] | undefined;
  for (const c0 of list.slice(0, MAX_PEOPLE * 2) as Array<Record<string, any>>) {
    const c = expand(c0 ?? {});
    // 장바구니가 비었는데 "고치기"로 답하면 "담기"로 받음 (10/27: "에그마요 소스는 허니머스터드"를 3번 줄 고치기로 냄)
    const op = (cartSize === 0 && c?.op === 'EDIT' ? 'ADD' : c?.op) as CmdOp;
    if (cartSize === 0 && c?.op === 'EDIT') c.line = null;
    if (!['ADD', 'EDIT', 'REMOVE', 'RECOMMEND', 'ASK_WHY', 'COMPARE', 'ORDER', 'LAST'].includes(op)) {
      dropped.push('op');
      continue;
    }
    const o = c.options ?? {};
    const options = {
      ...o,
      bread: o.bread ? ing(o.bread) ?? '?' : o.bread,
      cheese: o.cheese && o.cheese !== 'NONE' ? ing(o.cheese) ?? '?' : o.cheese,
      addVegetables: ings(o.addVegetables),
      removeVegetables: ings(o.removeVegetables),
      sauces: o.noSauce === true ? [] : ings(o.sauces),
      toppings: Array.isArray(o.toppings) ? o.toppings.map((n: string) => byName(catalog.toppings, n)).filter(Boolean) : o.toppings,
      setItem: o.setItem ? (SET_ITEM_NAMES.find((x) => squash(x) === squash(String(o.setItem))) ?? o.setItem) : o.setItem,
      set: o.set && o.set !== 'NONE' ? (catalog.sets.find((x) => squash(x.name) === squash(String(o.set)))?.name ?? o.set) : o.set,
    };
    const cond = { ...(c.conditions ?? {}) };
    // 알레르기는 말에 근거가 있을 때만 (10/17부터 지키는 것)
    if (cond.allergies?.length && !ALLERGY_SAID.test(text)) {
      dropped.push('allergies');
      delete cond.allergies;
    }
    // 알레르기 하나하나가 말에 있는 재료여야 (10/27: 젬마가 "우유"를 "난류"로 바꿔 낸 것 28번) — 규칙과 같은 말 사전
    // 말한 재료가 아니면 규칙이 그 문장에서 읽은 알레르기로 바꿈 (알레르기를 낸 명령이 하나뿐일 때만 — 여러 사람이면 누구 것인지 몰라 버림)
    if (Array.isArray(cond.allergies)) {
      const said = saidAllergens(text, catalog);
      const kept = cond.allergies.filter((a: string) => said.has(a));
      if (kept.length !== cond.allergies.length) {
        dropped.push('allergies');
        const withAllergy = list.map((x: any) => expand(x ?? {})).filter((x: any) => Array.isArray(x?.conditions?.allergies) && x.conditions.allergies.length).length;
        ruleAllergies ??= parseRules(text, catalog).intent.conditions.allergies ?? [];
        if (withAllergy === 1) kept.push(...ruleAllergies);
      }
      if (kept.length) cond.allergies = [...new Set(kept)];
      else delete cond.allergies;
    }
    const menuId = byName(catalog.menus, c.menu);
    // 메뉴는 말에 그 이름의 낱말(2글자 이상)이나 줄임말이 있을 때만 — "이거·저거"는 pick (AI가 [지금 추천]에서 마음대로 고르는 것 막기)
    let menu = menuId;
    if (menuId && !flat.includes(squash(String(c.menu)))) {
      const said = catalog.menus.filter((m) => m.id !== menuId && squash(String(c.menu)).includes(squash(m.name)) && flat.includes(squash(m.name))).sort((a, b) => b.name.length - a.name.length)[0];
      if (said) (menu = said.id), dropped.push('menu-said');
    }
    if (menu && menu === menuId) {
      const words = [...String(c.menu).split(/[\s&]+/), String(c.menu), ...(MENU_SHORT[String(c.menu)] ?? [])].map(squash).filter((w) => w.length >= 2);
      if (!words.some((w) => flat.includes(w))) {
        dropped.push('menu');
        menu = undefined;
      }
    }
    const v = validateIntent({ conditions: cond, options, ...(menu ? { menu } : {}) }, catalog);
    dropped.push(...v.dropped);
    if (options.saucesAdd === true && v.intent.options.sauces?.length) v.intent.options.saucesAdd = true;
    const extras = Array.isArray(options.extras) ? options.extras.filter((e: { name: string }) => catalog.singles?.some((x) => x.name === e.name)) : [];
    if (extras.length) v.intent.options.extras = extras;
    let line: Command['line'] = null;
    if (c.allLines === true) line = 'ALL';
    else if (Number.isInteger(c.line) && c.line >= 1 && c.line <= cartSize) line = c.line;
    else if (c.line != null && op !== 'ADD') dropped.push('line');
    if ((op === 'EDIT' || op === 'REMOVE') && line === null) {
      dropped.push(`${op}_NO_LINE`);
      continue;
    }
    const qty = Number.isInteger(c.qty) && c.qty >= 1 && c.qty <= 10 ? c.qty : null;
    const name = typeof c.name === 'string' && c.name.trim() && !/^(?:나|저|내|제)$/.test(c.name.trim()) && flat.includes(squash(c.name)) ? c.name.trim().slice(0, 6) : null;
    // 추천 N번째는 손님이 가리켰을 때만 ("이거·저거·2번째") — 10/27: OpenAI가 "추천해줘"를 추천 1·2·3번 담기로 낸 것
    const pointed = /이거|저거|그거|요거|이걸|저걸|그걸|이것|저것|\d\s*번째|첫\s*번째|두\s*번째|세\s*번째|\d\s*번\s*(?:으로|로|거|꺼)/.test(text);
    const pick = pointed && Number.isInteger(c.pick) && c.pick >= 1 && c.pick <= 3 ? c.pick : null;
    if (op === 'ADD' && !pointed && Number.isInteger(c.pick) && !menu) {
      dropped.push('pick');
      if (out.some((x) => x.op === 'RECOMMEND')) continue;
      out.push({ op: 'RECOMMEND', line: null, qty: null, owner: null, name: null, person: null, pick: null, intent: v.intent });
      continue;
    }
    const person = Number.isInteger(c.person) && c.person >= 1 && c.person <= MAX_PEOPLE ? c.person : null;
    // 누구 거: 이름 → 같이 먹는 사람, 사람 번호 2부터 → 같이 먹는 사람, 1 → 나 (예전 모양 owner도 받음)
    const owner = name || c.owner === 'GUEST' || (person !== null && person >= 2) ? 'GUEST' : c.owner === 'ME' || person === 1 ? 'ME' : null;
    out.push({ op, line, qty, owner, name, person, pick, intent: v.intent });
  }
  // 한 줄짜리 말인데 AI가 알레르기를 놓쳤으면 규칙이 읽은 것을 (실제 서비스는 규칙이 먼저라 같은 결과)
  const lineCmds = out.filter((c) => c.op === 'ADD' || c.op === 'RECOMMEND' || c.op === 'EDIT');
  if (lineCmds.length === 1 && !lineCmds[0]!.intent.conditions.allergies?.length) {
    ruleAllergies ??= parseRules(text, catalog).intent.conditions.allergies ?? [];
    if (ruleAllergies.length) lineCmds[0]!.intent.conditions.allergies = [...ruleAllergies];
  }
  return { commands: out, dropped: [...new Set(dropped)], reason };
}

/** 장바구니 줄 (측정·적용 공용) */
export interface SimLine {
  menuId: string | null;
  qty: number;
  owner: 'ME' | 'GUEST';
  name?: string;
  allergies: string[];
  choices: Record<string, unknown>;
  cond?: Intent['conditions'];
}

/** 명령을 장바구니에 적용 (측정용 흉내 — 실제 화면은 같은 순서로 pickMenu·refreshSheet) */
export function applyCommands(lines: SimLine[], commands: readonly Command[], recs: readonly string[]): SimLine[] {
  let next = lines.map((l) => ({ ...l, allergies: [...l.allergies], choices: { ...l.choices } }));
  const edit = (l: SimLine, c: Command) => {
    const o = c.intent.options as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (k === 'removeVegetables' || k === 'addVegetables') l.choices[k] = [...new Set([...((l.choices[k] as string[]) ?? []), ...(v as string[])])];
      else l.choices[k] = v;
    }
    if (c.intent.conditions.allergies?.length) {
      l.allergies = [...new Set([...l.allergies, ...c.intent.conditions.allergies])];
      l.owner = 'GUEST';
    }
    if (c.owner) l.owner = c.owner;
    if (c.name) (l.name = c.name), (l.owner = 'GUEST');
    if (c.qty) l.qty = c.qty;
  };
  const removed = new Set<number>();
  for (const c of commands) {
    if (c.op === 'ADD') {
      const menuId = c.intent.menu ?? (c.pick ? recs[c.pick - 1] ?? null : null);
      const l: SimLine = { menuId, qty: c.qty ?? 1, owner: c.owner === 'GUEST' || c.name ? 'GUEST' : 'ME', ...(c.name ? { name: c.name } : {}), allergies: [], choices: {}, ...(menuId ? {} : { cond: c.intent.conditions }) };
      edit(l, { ...c, qty: null });
      next.push(l);
    } else if (c.op === 'EDIT') {
      const targets = c.line === 'ALL' ? next : c.line ? [next[c.line - 1]].filter(Boolean) : [];
      for (const l of targets) {
        // "2번 ○○로 바꿔": 메뉴를 바꾸면 그 줄 옵션은 새로
        if (c.intent.menu && c.intent.menu !== l!.menuId) Object.assign(l!, { menuId: c.intent.menu, choices: {} });
        edit(l!, c);
      }
    } else if (c.op === 'REMOVE' && typeof c.line === 'number') removed.add(c.line - 1);
    else if (c.op === 'REMOVE' && c.line === 'ALL') next.forEach((_, i) => removed.add(i));
  }
  next = next.filter((_, i) => !removed.has(i));
  return next;
}
