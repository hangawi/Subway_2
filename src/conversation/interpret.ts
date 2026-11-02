// 말 해석: 규칙(항상) + AI(있으면, 규칙이 못 알아들은 부분만 보탬) → 검사 → 엔진 입력·주문서 선택.
// AI는 값을 옮기기만 한다. 규칙과 AI가 다르면 규칙을 따른다 (같은 말 → 같은 결과).
// AI가 없거나 실패해도 규칙만으로 진행한다 (로드맵 30번).
// 대화 기억: 앞 대화의 메뉴·선택(context)을 받아 "아까 거기서 소스만 바꿔"를 이어 붙인다 (휴대폰이 들고 있다가 보냄).
import { randomUUID } from 'node:crypto';
import type { AiRequest, AiResult } from '../../vendor/sophia/packages/contracts/src/ai-contract.ts';
import type { MenuKind, SubwayCatalog } from '../catalog/subway-catalog.ts';
import type { MenuPrefs } from '../flow/recommend-flow.ts';
import { avoidAllergens, SALAD_LIKE, WRAP_LIKE } from '../order-sheet/composition.ts';
import { buildOrderSheet, buildSinglesSheet, SINGLES_ID, type OrderChoices } from '../order-sheet/order-sheet.ts';
import { josa } from '../subway-menu/explain.ts';
import { intentJsonSchema, validateIntent, type Drink, type Intent } from './intent-schema.ts';
import { KIND_KO, mentionsMenu, parseRules, resolveToppingNames } from './rules.ts';

export interface AiRoute {
  route(request: AiRequest): Promise<AiResult>;
}

export interface TalkContext {
  /** 앞에서 고른 메뉴 */
  menuId?: string;
  /** 앞에서 만든 주문서 선택 */
  choices?: OrderChoices;
  /** 앞에서 쓴 조건 */
  prefs?: Partial<MenuPrefs>;
}

export interface Interpretation {
  source: 'RULES' | 'RULES+AI';
  aiStatus: 'NOT_CONFIGURED' | 'USED' | 'FAILED' | 'SKIPPED';
  /** 알아들은 AI (10/22 말 기록): 'a100' = GPU, 'openai…' = OpenAI, 안 불렀으면 null */
  aiBy: string | null;
  intent: Intent;
  understood: string[];
  question: string | null;
  refusals: string[];
  /** 엔진에 넣을 조건 (앞 대화 조건 + 이번 말) */
  prefs: MenuPrefs;
  /** 말한 장소 ("강남역에서") — 화면이 장소를 찾는다. 없으면 null (지금 위치) */
  place: string | null;
  /** 취향 말 — 화면이 동의한 사람만 저장 */
  tastes: NonNullable<Intent['conditions']['tastes']>;
  /** 오늘 상태 */
  mood: 'TIRED' | null;
  /** 메뉴가 정해졌으면 그 메뉴의 주문서 선택 (앞 선택 + 이번 수정) */
  menuId: string | null;
  choices: OrderChoices | null;
  /** 주문서 규칙에 안 맞는 수정 → 거절 이유 */
  orderErrors: string[];
  /** 막연한 추천 요청 ("뭐 먹지?") — 메뉴를 안 골랐을 때만 */
  vague: boolean;
  /** ③에서 "2번으로 할게" — 화면이 추천 N번째를 고름 */
  pickRank: number | null;
  /** 평소 옵션과 합칠 때 (10/21): 말한 소스를 평소 소스에 더함 / 다시 넣으라고 한 야채 */
  saucesAdd: boolean;
  keepVegetables: string[];
}

export const INSTRUCTIONS = `너는 써브웨이 주문 문장을 JSON으로 옮기는 도구다.
- 문장에 있는 값만 옮긴다. 추천·판단·순위는 하지 않는다. 문장에 없는 값은 null.
- 값은 JSON 형식의 enum 목록 안에서만 고른다. 목록에 없으면 null.
- 예산은 원 단위 정수 ("만 원 이하" → 10000). "단백질 많이" → goal PROTEIN, "살 안 찌는", "가볍게" → LIGHT.
- "X 알레르기", "X 못 먹어" → allergies. "X 빼 줘"(야채) → removeVegetables. "소스 빼 줘" → sauces [].
- "좋아해", "싫어해", "안 좋아해", "별로야" 같은 취향은 알레르기가 아니다 → allergies null.
- "치즈 빼 줘" → cheese "NONE", "세트 말고 단품" → set "NONE". 말하지 않은 칸은 꼭 null (빈 목록·NONE을 넣지 않는다).
- "아까", "거기서", "그걸로" → followUp true. "왜?" → ask WHY. "1번이랑 2번" → ask COMPARE.
- 한글 숫자도 금액 ("만 삼천원" → 13000, "이만원" → 20000, "칠천오백원" → 7500).
- "매운 거 넣어", "맵게", "매콤하게", "매운 거 좋아" → wantSpicy true. "매운 거 빼", "맵게 못 먹어", "안 맵게" → avoidSpicy true. 방향을 모르면 둘 다 null.`;

const ERROR_TEXT: Record<string, string> = {
  SALAD_ONLY_SAUCE_AND_TOPPING: '샐러드는 빵·치즈·야채를 바꿀 수 없어요 (소스·토핑만 바꿀 수 있어요)',
  TOO_MANY_EXTRAS: '단품은 10가지까지 담을 수 있어요',
  UNKNOWN_EXTRA: '메뉴판에 없는 단품이에요',
  BAD_EXTRA_QTY: '단품 개수는 1~20개로 해 주세요',
  DUPLICATE_EXTRA: '같은 단품이 두 번 들어갔어요',
  NO_EXTRAS: '담은 단품이 없어요',
  WRAP_BREAD_FIXED: '랩은 빵·치즈·야채가 정해져 있어요',
  WRAP_SAUCE_FIXED: '랩은 소스가 정해져 있어요',
  WRAP_TOPPING_FIXED: '랩은 토핑을 더할 수 없어요',
  SIZE_NOT_AVAILABLE: '이 메뉴는 30cm가 없어요',
  UNKNOWN_SIZE: '크기는 15cm·30cm 중에서 골라 주세요',
  TOO_MANY_SAUCES: '소스는 3개까지 고를 수 있어요',
  TOO_MANY_TOPPINGS: '추가 토핑이 너무 많아요',
  TOPPING_NOT_FOR_THIS_MENU: '이 메뉴에는 그 토핑을 더할 수 없어요',
  NOT_A_DEFAULT_VEGETABLE: '기본으로 들어가지 않는 야채는 뺄 수 없어요',
  SET_NOT_AVAILABLE: '이 메뉴는 세트로 바꿀 수 없어요',
  SET_ITEM_NOT_IN_SET: '그 세트에서 고를 수 없는 것이에요',
  TOASTING_ONLY_SANDWICH: '토스팅은 샌드위치만 돼요',
  NOT_A_MEAL: '사이드는 주문서로 만들 수 없어요',
  DUPLICATE_SAUCE: '같은 소스를 두 번 고를 수 없어요',
  DUPLICATE_VEGETABLE: '같은 야채를 두 번 고를 수 없어요',
};
export const orderErrorText = (code: string) => ERROR_TEXT[code] ?? `주문서 규칙에 안 맞아요 (${code})`;

/** 규칙에 AI가 보탠 것만 더한다 (규칙에 있는 값은 그대로) */
function merge(rule: Intent, ai: Intent): Intent {
  const out: Intent = { ...rule, conditions: { ...ai.conditions, ...rule.conditions }, options: { ...ai.options, ...rule.options } };
  // 매운 것은 넣기·빼기 중 하나만: 규칙이 정했으면 규칙, AI만 둘 다 냈으면 빼기 (더 안전한 쪽)
  if (rule.conditions.wantSpicy || rule.conditions.avoidSpicy) {
    delete out.conditions.wantSpicy;
    delete out.conditions.avoidSpicy;
    Object.assign(out.conditions, rule.conditions.avoidSpicy ? { avoidSpicy: true } : { wantSpicy: true });
  } else if (out.conditions.avoidSpicy) delete out.conditions.wantSpicy;
  if (!rule.menu && ai.menu) out.menu = ai.menu;
  if (!rule.ask && ai.ask) out.ask = ai.ask;
  if (!rule.followUp && ai.followUp) out.followUp = true;
  return out;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];


/** AI가 보탠 것을 "이렇게 이해했어요"에 보일 말로 (규칙이 이미 읽은 것은 빼고) — 10/16: AI만 알아들었을 때 화면에 "잘 못 알아들었어요"가 뜨던 것 */
function describeAdded(rule: Intent, final: Intent, catalog: SubwayCatalog): string[] {
  const out: string[] = [];
  const r = rule.conditions, f = final.conditions;
  const name = (id: string) => catalog.ingredients.find((i) => i.id === id)?.name ?? catalog.toppings.find((x) => x.id === id)?.name ?? id;
  if (f.budgetKrw !== undefined && r.budgetKrw === undefined) out.push(`예산 ${f.budgetKrw.toLocaleString('ko-KR')}원 이하`);
  if (f.goal && !r.goal) out.push(f.goal === 'PROTEIN' ? '단백질 많은 쪽' : f.goal === 'FILLING' ? '든든한 쪽 (배부르게)' : '가벼운 쪽 (열량 낮게)');
  if (f.wantMains?.length && !r.wantMains?.length) out.push(`${f.wantMains.join('·')} 메뉴로`);
  if (f.place && !r.place) out.push(`장소: ${f.place}`);
  if (f.maxEnergyKcal !== undefined && r.maxEnergyKcal === undefined) out.push(`${f.maxEnergyKcal}kcal 이하`);
  if (f.maxSodiumMg !== undefined && r.maxSodiumMg === undefined) out.push(`나트륨 ${f.maxSodiumMg}mg 이하`);
  const newAllergies = (f.allergies ?? []).filter((a) => !(r.allergies ?? []).includes(a));
  if (newAllergies.length) out.push(`${newAllergies.join('·')} 알레르기`);
  if (f.kinds && !r.kinds) out.push(`종류: ${f.kinds.map((k) => KIND_KO[k] ?? k).join('·')}`);
  if (f.avoidSpicy && !r.avoidSpicy) out.push('매운 것 빼기 (할라피뇨·핫 칠리·스파이시 메뉴)');
  if (f.wantSpicy && !r.wantSpicy) out.push('매운 것 넣기 (스파이시 메뉴 먼저, 할라피뇨 더·핫 칠리 소스)');
  if (final.menu && !rule.menu) out.push(`메뉴: ${catalog.menus.find((m) => m.id === final.menu)?.name ?? final.menu}`);
  const o = final.options, ro = rule.options;
  if (o.size && !ro.size) out.push(`크기 ${o.size}`);
  if (o.bread && !ro.bread) out.push(`빵: ${name(o.bread)}`);
  if (o.cheese !== undefined && ro.cheese === undefined) out.push(o.cheese === null ? '치즈 빼기' : `치즈: ${name(o.cheese)}`);
  for (const v of (o.removeVegetables ?? []).filter((x) => !(ro.removeVegetables ?? []).includes(x))) out.push(`${name(v)} 빼기`);
  for (const v of (o.addVegetables ?? []).filter((x) => !(ro.addVegetables ?? []).includes(x))) out.push(`${name(v)} 더`);
  if (o.sauces && !ro.sauces) out.push(o.sauces.length ? `소스: ${o.sauces.map(name).join('·')}` : '소스 빼기');
  if (o.set !== undefined && ro.set === undefined) out.push(o.set === null ? '세트 빼기' : o.set);
  if (o.drink && !ro.drink) out.push(`음료: ${o.drink}`);
  return out;
}

/** 앞 선택 + 이번 수정 (야채·토핑은 더하고, 빵·치즈·소스·세트·크기는 바꿈) */
export function applyOptions(prev: OrderChoices, o: Intent['options'], kind: MenuKind, catalog: SubwayCatalog): { choices: OrderChoices; unknownToppings: string[] } {
  const next: OrderChoices = { ...prev };
  if (o.size) next.size = o.size;
  if (o.bread) next.bread = o.bread;
  if (o.cheese !== undefined) next.cheese = o.cheese;
  if (o.removeVegetables) {
    next.removeVegetables = uniq([...(prev.removeVegetables ?? []), ...o.removeVegetables]);
    next.addVegetables = (prev.addVegetables ?? []).filter((v) => !o.removeVegetables!.includes(v));
  }
  if (o.addVegetables) {
    next.addVegetables = uniq([...(next.addVegetables ?? prev.addVegetables ?? []), ...o.addVegetables]);
    next.removeVegetables = (next.removeVegetables ?? []).filter((v) => !o.addVegetables!.includes(v));
  }
  if (o.keepVegetables) next.removeVegetables = (next.removeVegetables ?? []).filter((v) => !o.keepVegetables!.includes(v));
  if (o.sauces) next.sauces = o.sauces;
  const t = resolveToppingNames(o.toppings, kind, catalog);
  if (t.ids.length) next.toppings = uniq([...(prev.toppings ?? []), ...t.ids]);
  if (o.set !== undefined) next.set = o.set;
  if (o.toasted !== undefined) next.toasted = o.toasted;
  if (o.drink) next.drink = o.drink;
  if (o.setItem) next.setItem = o.setItem;
  // 단품 (10/19): 이름 → id, 같은 단품을 다시 말하면 개수를 바꿈
  if (o.extras?.length) {
    const list = [...(prev.extras ?? [])];
    for (const e of o.extras) {
      const single = catalog.singles?.find((x) => x.name === e.name);
      if (!single) continue;
      const at = list.findIndex((x) => x.id === single.id);
      if (at >= 0) list[at] = { id: single.id, qty: e.qty };
      else list.push({ id: single.id, qty: e.qty });
    }
    if (list.length) next.extras = list;
  }
  for (const k of Object.keys(next) as Array<keyof OrderChoices>) {
    const v = next[k];
    if (Array.isArray(v) && v.length === 0 && k !== 'sauces') delete next[k];
  }
  // 샐러드·랩은 빵·치즈·야채를 고를 수 없으니 이어 받지 않는다 (앞 메뉴가 샌드위치였을 때)
  return { choices: next, unknownToppings: t.unknown };
}

// 11/02 A100 종료 → OpenAI(gpt-5-mini low)만: p95 15.2초라 12초 → 20초 (docs/운영/A100_종료_OpenAI_전환_계획.md)
export const AI_TIMEOUT_MS = 20000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('AI_TIMEOUT')), ms);
    p.then((v) => (clearTimeout(t), resolve(v)), (e) => (clearTimeout(t), reject(e)));
  });
}

export async function interpret(text: string, catalog: SubwayCatalog, context: TalkContext = {}, ai: AiRoute | null = null, aiTimeoutMs = AI_TIMEOUT_MS): Promise<Interpretation> {
  const rules = parseRules(text, catalog);
  let intent = rules.intent;
  let aiStatus: Interpretation['aiStatus'] = ai ? 'SKIPPED' : 'NOT_CONFIGURED';
  let aiBy: string | null = null;
  // AI에 묻는 때: 규칙이 아무것도 못 알아들었거나, 규칙이 못 읽고 남긴 말이 있을 때 (10/16: "만 삼천원 이하 매운 거 넣어서"처럼
  // 규칙이 일부만 읽으면 나머지를 버리던 것). 규칙이 읽은 값은 그대로 두고 AI는 보태기만 한다 (같은 말 → 규칙 부분은 같은 결과)
  const ruleFoundSomething = rules.understood.length > 0 || rules.question || rules.refusals.length || intent.ask;
  const leftoverWorthAsking = rules.leftover.length >= 2;
  let added: string[] = [];
  let question = rules.question;
  // 10/20: 군말만 있는 말("추천해줘", "아무거나 골라줘")은 AI도 더 알아낼 게 없다 → 부르지 않음 (취향 이야기 108개에서 28번 헛부름)
  // ("힘 나는 걸로"처럼 한 글자 낱말에 뜻이 있을 수 있어 남은 말로 정하지 않고, 이 말들만일 때)
  const onlyFiller = !ruleFoundSomething && /^(?:그냥|음|아|저기|그니까)?(?:메뉴)?(?:추천|골라|아무거나|아무거|암거나)(?:해|해줘|해주세요|해봐|줘|주세요|좀|요|바|봐)*[.!?~]*$/.test(text.replace(/\s/g, ''));
  if (ai && text.trim().length >= 2 && !onlyFiller && (!ruleFoundSomething || leftoverWorthAsking)) {
    try {
      // AI가 늦으면 기다리지 않고 규칙만으로 (화면이 멈추지 않게)
      const r = await withTimeout(ai.route({
        request_id: randomUUID(), trace_id: randomUUID(), task: 'intent_structuring', lane: 'interactive',
        instructions: INSTRUCTIONS, input: text.slice(0, 300), output_schema: { name: 'subway_intent', schema: intentJsonSchema(catalog) }, max_output_tokens: 600,
      }), aiTimeoutMs);
      if ((r.code === 'SUCCESS' || r.code === 'FALLBACK_USED') && r.output) {
        const before = intent;
        const fromAi = validateIntent(r.output, catalog).intent;
        // AI가 고른 메뉴는 말에 그 이름(한 글자 오타까지)이 있을 때만 — 없으면 엉뚱한 메뉴보다 안 고르는 게 낫다
        if (fromAi.menu && !mentionsMenu(text, fromAi.menu, catalog)) delete fromAi.menu;
        // 판매 끝난 메뉴를 말했으면 AI도 비슷한 메뉴를 대신 고르지 않는다 (10/19)
        if (rules.ended.length) delete fromAi.menu;
        // 알레르기·소스도 말에 근거가 있을 때만 (10/17: "나 원래 치킨 안 좋아해" → AI가 닭고기 알레르기·소스 빼기를 지어냄.
        // 알레르기는 메뉴를 거르는 조건이라 취향을 알레르기로 읽으면 안 된다)
        if (!/알레르기|알러지|못\s*먹|먹으면\s*안|두드러기/.test(text)) delete fromAi.conditions.allergies;
        const flat = text.replace(/\s/g, '');
        const sauceName = (id: string) => (catalog.ingredients.find((i) => i.id === id)?.name ?? id).replace(/\s/g, '');
        // 추가 토핑도 말에 그 이름이 있을 때만 (10/19: "할라피뇨 듬뿍"에 AI가 토핑을 지어내 주문서가 거절됨 — 할라피뇨는 야채)
        if (fromAi.options.toppings) {
          const said = fromAi.options.toppings.filter((t) => flat.includes(t.replace(/\s/g, '')));
          if (said.length) fromAi.options.toppings = said;
          else delete fromAi.options.toppings;
        }
        // 종류·"세트 빼기"도 그 말이 있을 때만 (10/19: "제로콜라에다가 치킨을 넣어서 맵게해줘"에 AI가 샐러드·세트 빼기를 붙임)
        if (fromAi.conditions.kinds && !/샐러드|랩|샌드위치|아침|그레인|사이드|모닝/.test(flat)) delete fromAi.conditions.kinds;
        if (fromAi.options.set === null && !/세트|단품|콤보/.test(flat)) delete fromAi.options.set;
        if (typeof fromAi.options.set === 'string' && !/세트|콤보|쿠키|웨지|칩|수프|스프/.test(flat)) delete fromAi.options.set;
        // AI가 음료만 냈고 세트가 없으면 (10/19) 단품으로 — 세트는 규칙이 정한다
        // 규칙이 이미 음료를 단품으로 읽었으면 AI의 세트 음료는 버림 (같은 음료가 두 번 보이던 것)
        if (fromAi.options.drink && rules.intent.options.extras?.length && !rules.intent.options.set) delete fromAi.options.drink;
        if (fromAi.options.drink && fromAi.options.set === undefined && !rules.intent.options.set && !rules.intent.options.extras) {
          const single = ({ 콜라: '코카콜라 (355ml)', 제로콜라: '코카콜라 제로 (355ml)', 사이다: '스프라이트 (355ml)', 제로사이다: '스프라이트 제로 (355ml)', 커피: '아메리카노' } as Record<string, string>)[fromAi.options.drink];
          if (single) fromAi.options.extras = [{ name: single, qty: 1 }];
          delete fromAi.options.drink;
        }
        // 세트에서 고를 것(쿠키·웨지·수프 이름)도 말에 그 이름이 있을 때만 (10/19: "웨지세트 콜라"에 AI가 구성품을 지어내 주문서가 거절됨)
        if (fromAi.options.setItem && !flat.includes(fromAi.options.setItem.replace(/\s/g, ''))) delete fromAi.options.setItem;
        // 장소 뒤에 붙은 "써브웨이"·"점"은 뗌 (10/19: "역삼역 써브웨이 에그마요" → 장소 "역삼역 써브웨이")
        if (fromAi.conditions.place) {
          const p = fromAi.conditions.place.replace(/\s*(?:써브웨이|서브웨이|subway)\s*(?:점)?\s*$/i, '').trim();
          // 10/20: 말에 있는 장소만 ("회사에서 먹을래" → AI가 "OFFICE"를 장소로 만들던 것)
          if (p.length >= 2 && flat.toLowerCase().includes(p.replace(/\s/g, '').toLowerCase())) fromAi.conditions.place = p;
          else delete fromAi.conditions.place;
        }
        // 메인 재료("참치 메뉴로")도 그 말이 있을 때만 (10/19: "안창비프 머쉬룸 플랫브레드"에 AI가 참치를 더함)
        const MAIN_SAID: Record<string, RegExp> = { 쇠고기: /쇠고기|소고기|비프|스테이크|안창|불고기/, 닭고기: /닭|치킨/, 돼지고기: /돼지|포크|햄|베이컨|잠봉|비엠티|페퍼로니/, 새우: /새우|쉬림프/, 참치: /참치|튜나/, 달걀: /계란|달걀|에그/, 야채: /야채|채소|채식|베지|비건/ };
        for (const key of ['wantMains', 'avoidMains'] as const) {
          const said = (fromAi.conditions[key] ?? []).filter((k) => MAIN_SAID[k]?.test(flat));
          if (said.length) fromAi.conditions[key] = said;
          else delete fromAi.conditions[key];
        }
        // 질문(왜·비교·지난번)도 그 말이 있을 때만 (10/20: "…추천해줘"에 AI가 "왜 추천했어?"를 붙여 주문서로 안 넘어감)
        const ASK_SAID = { WHY: /왜|이유|어째서|뭐때문/, COMPARE: /비교|차이|달라|다른점|뭐가나/, LAST: /지난번|저번|평소처럼|평소대로|늘먹|맨날먹|먹던|같은걸로|똑같이/ } as const;
        if (fromAi.ask && !ASK_SAID[fromAi.ask].test(flat)) delete fromAi.ask;
        if (fromAi.options.sauces && !/소스|드레싱/.test(flat) && !fromAi.options.sauces.some((id) => flat.includes(sauceName(id)))) delete fromAi.options.sauces;
        intent = merge(intent, fromAi);
        added = describeAdded(before, intent, catalog);
        // 규칙이 "매운 걸 넣을까요, 뺄까요?"라고 물었는데 AI가 방향을 알아들었으면 묻지 않는다
        if (question?.startsWith('매운 걸') && (intent.conditions.wantSpicy || intent.conditions.avoidSpicy)) question = null;
        aiStatus = 'USED';
        aiBy = r.provider_id;
      } else aiStatus = 'FAILED';
    } catch {
      aiStatus = 'FAILED';
    }
  }

  const base: MenuPrefs = {
    allergies: [], maxEnergyKcal: null, maxSodiumMg: null, budgetKrw: null, kinds: null, goal: null, removeVegetables: [],
    ...(context.prefs ?? {}),
  };
  const c = intent.conditions;
  const prefs: MenuPrefs = {
    ...base,
    allergies: uniq([...base.allergies, ...(c.allergies ?? [])]),
    maxEnergyKcal: c.maxEnergyKcal ?? base.maxEnergyKcal,
    maxSodiumMg: c.maxSodiumMg ?? base.maxSodiumMg,
    budgetKrw: c.budgetKrw ?? base.budgetKrw,
    kinds: c.kinds ?? base.kinds,
    goal: c.goal ?? base.goal,
    ...(c.wantMains?.length || base.wantMains?.length ? { wantMains: c.wantMains ?? base.wantMains! } : {}),
    ...(c.avoidMains?.length || base.avoidMains?.length ? { avoidMains: c.avoidMains ?? base.avoidMains! } : {}),
    ...(c.salty || base.salty ? { salty: c.salty ?? base.salty! } : {}),
    ...(c.lowFat || base.lowFat ? { lowFat: true } : {}),
    ...(c.meal || base.meal ? { meal: c.meal ?? base.meal! } : {}),
    removeVegetables: uniq([...(base.removeVegetables ?? []), ...(c.avoidSpicy ? ['vegetable:할라피뇨'] : [])]).filter((v) => !(c.wantSpicy && v === 'vegetable:할라피뇨')),
  };
  // 매운 것: 이번 말이 정하면 이번 말, 아니면 앞 대화 그대로 (넣기·빼기는 하나만)
  delete prefs.avoidSpicy;
  delete prefs.wantSpicy;
  if (c.avoidSpicy) prefs.avoidSpicy = true;
  else if (c.wantSpicy) prefs.wantSpicy = true;
  else if (base.avoidSpicy) prefs.avoidSpicy = true;
  else if (base.wantSpicy) prefs.wantSpicy = true;

  // 메뉴: 이번에 말한 것 > (이어 말하기면) 앞 메뉴. 단품만("콜라만 줘")이면 샌드위치 없는 주문서 (10/19)
  const menuId = intent.menu ?? (intent.singlesOnly && !context.menuId ? SINGLES_ID : intent.followUp || hasOptions(intent) ? (context.menuId ?? null) : null);
  let choices: OrderChoices | null = null;
  const orderErrors: string[] = [];
  const refusals = [...rules.refusals];
  const allergyNotes: string[] = [];
  /** 단품 말을 세트로 묶었으면 "이렇게 이해했어요"도 바꿈 */
  let asSet: { drop: string[]; text: string } | null = null;
  if (menuId === SINGLES_ID) {
    const prev = context.menuId === SINGLES_ID ? (context.choices ?? {}) : {};
    const { choices: next } = applyOptions({ extras: prev.extras ?? [] } as OrderChoices, { extras: intent.options.extras ?? [] }, 'SIDE', catalog);
    const r = buildSinglesSheet(next, catalog);
    if (r.ok) choices = { extras: next.extras ?? [] };
    else if (intent.options.extras?.length) {
      orderErrors.push(...r.errors);
      refusals.push(...r.errors.map(orderErrorText));
    }
    // 알레르기: 단품에 든 것 알림
    for (const e of next.extras ?? []) {
      const single = catalog.singles?.find((x) => x.id === e.id);
      const hit = prefs.allergies.filter((a) => single?.allergens.contains.includes(a));
      if (single && hit.length) refusals.push(`${single.name}에는 ${josa(hit.join('·'), '이', '가')} 들어 있어요 (알레르기)`);
    }
  } else if (menuId) {
    const menu = catalog.menus.find((m) => m.id === menuId)!;
    const prev = intent.menu && intent.menu !== context.menuId ? {} : (context.choices ?? {});
    // 샌드위치·샐러드에 "음료 + 쿠키·칩·웨지·수프"를 단품으로 말했으면 그 세트로 (10/19: 앞 대화의 메뉴에 이어 "콜라랑 쿠키")
    // 이미 세트를 골랐으면 "쿠키는 초코칩", "콜라로"는 그 세트의 쿠키·음료 (10/19)
    if (intent.options.set === undefined && prev.set && intent.options.extras?.length) {
      const of = (n: string) => catalog.singles?.find((x) => x.name === n);
      const groupOfSet: Record<string, string> = { '쿠키 음료 세트': 'COOKIE', '칩 음료 세트': 'CHIP', '웨지 음료 세트': 'WEDGE', '수프 음료 세트': 'SOUP' };
      const toDrink: Record<string, Drink> = { '코카콜라 (355ml)': '콜라', '코카콜라 제로 (355ml)': '제로콜라', '스프라이트 (355ml)': '사이다', '스프라이트 제로 (355ml)': '제로사이다', 아메리카노: '커피', '아이스 아메리카노': '커피' };
      const keep: typeof intent.options.extras = [];
      for (const e of intent.options.extras) {
        const g = of(e.name)?.group;
        if (g === groupOfSet[prev.set] && !/개입|3개/.test(e.name)) intent.options.setItem = g === 'COOKIE' ? e.name.replace(/ 쿠키$/, '') : g === 'CHIP' ? '칩' : e.name;
        else if (g === 'DRINK' && toDrink[e.name]) intent.options.drink = toDrink[e.name]!;
        else keep.push(e);
      }
      if (keep.length) intent.options.extras = keep;
      else delete intent.options.extras;
    }
    if (intent.options.set === undefined && !prev.set && intent.options.extras?.length && !WRAP_LIKE.includes(menu.kind)) {
      const of = (n: string) => catalog.singles?.find((x) => x.name === n);
      const drink = intent.options.extras.find((e) => of(e.name)?.group === 'DRINK');
      const side = intent.options.extras.find((e) => ['COOKIE', 'CHIP', 'WEDGE', 'SOUP'].includes(of(e.name)?.group ?? '') && !/개입|3개/.test(e.name));
      const setDrink = drink ? ({ '코카콜라 (355ml)': '콜라', '코카콜라 제로 (355ml)': '제로콜라', '스프라이트 (355ml)': '사이다', '스프라이트 제로 (355ml)': '제로사이다', 아메리카노: '커피', '아이스 아메리카노': '커피', '탄산음료 16oz': '콜라' } as Record<string, Drink>)[drink.name] : undefined;
      if (drink && side && setDrink) {
        const g = of(side.name)!.group;
        const setName = g === 'COOKIE' ? '쿠키 음료 세트' : g === 'CHIP' ? '칩 음료 세트' : g === 'WEDGE' ? '웨지 음료 세트' : '수프 음료 세트';
        const item = g === 'COOKIE' ? side.name.replace(/ 쿠키$/, '') : g === 'CHIP' ? '칩' : g === 'WEDGE' ? side.name : null;
        asSet = { drop: [`단품: ${drink.name}`, `단품: ${side.name}`], text: `${setName} (${[item, setDrink].filter(Boolean).join(', ')})` };
        intent.options = { ...intent.options, set: setName, drink: setDrink, ...(item ? { setItem: item } : {}), extras: intent.options.extras.filter((e) => e !== drink && e !== side) };
        if (!intent.options.extras!.length) delete intent.options.extras;
      }
    }
    const { choices: next, unknownToppings } = applyOptions(prev, intent.options, menu.kind, catalog);
    if (c.avoidSpicy && !SALAD_LIKE.includes(menu.kind) && !WRAP_LIKE.includes(menu.kind))
      next.removeVegetables = uniq([...(next.removeVegetables ?? []), 'vegetable:할라피뇨']);
    // 매운 것 넣기: 샌드위치는 할라피뇨 더 + 핫 칠리 소스, 샐러드는 핫 칠리 소스 (랩은 정해져 있어 그대로, 소스는 3개까지)
    if (c.wantSpicy && !WRAP_LIKE.includes(menu.kind)) {
      // 이번 말에서 할라피뇨를 직접 뺐으면 ("매운 거 넣어줘 근데 할라피뇨는 빼고") 그 말이 이긴다
      const saidNoJalapeno = (intent.options.removeVegetables ?? []).includes('vegetable:할라피뇨');
      if (!SALAD_LIKE.includes(menu.kind) && !saidNoJalapeno) {
        next.removeVegetables = (next.removeVegetables ?? []).filter((v) => v !== 'vegetable:할라피뇨');
        next.addVegetables = uniq([...(next.addVegetables ?? []), 'vegetable:할라피뇨']);
      }
      const sauces = next.sauces ?? [];
      // 고른 알레르기가 든 소스는 넣지 않음 (10/19: 핫 칠리에 토마토 → 토마토 알레르기면 "메뉴를 바꿔 주세요"로 막히던 것)
      const hot = catalog.ingredients.find((i) => i.id === 'sauce:핫 칠리');
      const hotHit = prefs.allergies.filter((a) => hot?.allergens.contains.includes(a));
      if (hotHit.length) allergyNotes.push(`${hotHit.join('·')} 알레르기라서 핫 칠리 소스는 안 넣었어요 (할라피뇨만)`);
      else if (!sauces.includes('sauce:핫 칠리') && sauces.length < 3) next.sauces = [...sauces, 'sauce:핫 칠리'];
    }
    // 알레르기: 메인 재료가 아니면 그 재료를 자동으로 뺌, 메인 재료면 알림 (10/16)
    if (prefs.allergies.length) {
      const av = avoidAllergens(menu, catalog, prefs.allergies, next);
      if (av.blocked.length) refusals.push(`${menu.name}에는 ${josa(av.blocked.join('·'), '이', '가')} 들어 있어요 (알레르기). 다른 메뉴를 골라 주세요`);
      else {
        if (av.removeVegetables.length) next.removeVegetables = uniq([...(next.removeVegetables ?? []), ...av.removeVegetables]);
        if (av.bread && !next.bread) next.bread = av.bread;
        allergyNotes.push(...av.notes);
      }
    }
    for (const u of unknownToppings) refusals.push(`이 메뉴에는 ${u} 토핑을 더할 수 없어요`);
    const r = buildOrderSheet(menu, next, catalog);
    if (r.ok) choices = next;
    else {
      orderErrors.push(...r.errors);
      refusals.push(...r.errors.map(orderErrorText));
      choices = context.choices ?? {}; // 안 되는 수정은 적용하지 않고 앞 선택 그대로
    }
  } else if (hasOptions(intent) && !rules.question) {
    refusals.push('먼저 메뉴를 골라 주세요. 그다음 빵·소스를 바꿀 수 있어요');
  }

  return {
    source: aiStatus === 'USED' ? 'RULES+AI' : 'RULES',
    aiStatus,
    aiBy,
    intent,
    understood: [...rules.understood.filter((u) => !asSet?.drop.some((d) => u.startsWith(d))), ...(asSet ? [asSet.text] : []), ...added, ...allergyNotes],
    question,
    refusals: uniq(refusals),
    prefs,
    place: intent.conditions.place ?? null,
    tastes: intent.conditions.tastes ?? [],
    mood: intent.conditions.mood ?? null,
    menuId,
    choices,
    orderErrors,
    vague: !!intent.vague && !menuId,
    pickRank: intent.pickRank ?? null,
    saucesAdd: !!intent.options.saucesAdd,
    keepVegetables: intent.options.keepVegetables ?? [],
  };
}

function hasOptions(i: Intent): boolean {
  return Object.keys(i.options).length > 0;
}
