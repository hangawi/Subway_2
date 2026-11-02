// 말 → 젬마 명령 → 검사 → 화면이 바로 쓸 것 (10/27 예형님 "젬마가 주도적으로": 모든 말을 젬마가 먼저 읽는다, 규칙은 검사와 비상용)
// 젬마가 정하는 것: 몇 명·몇 줄·줄마다 메뉴/조건/옵션, 담은 줄 고치기·빼기, 추천 조건, 상황 한 줄(감기·야구부…).
// 여기서 검사하는 것: 메뉴·재료는 메뉴판 이름만, 알레르기는 말한 재료만, 줄 번호는 장바구니 안, 사람은 10명까지 (command-ai.ts).
// 순서는 A100 gemma → 안 되면 OpenAI (라우터 그대로). 둘 다 안 되면 null → 화면은 규칙으로.
import { randomUUID } from 'node:crypto';
import type { SubwayCatalog } from '../catalog/subway-catalog.ts';
import { buildOrderSheet, type OrderChoices } from '../order-sheet/order-sheet.ts';
import { parseRules } from './rules.ts';
import { commandInput, commandInstructions, commandSchema, MAX_PEOPLE, validateCommands, type CartLineView } from './command-ai.ts';
import { applyOptions, type AiRoute } from './interpret.ts';
import type { Intent } from './intent-schema.ts';

export interface CartLineIn {
  menuId: string | null;
  choices: OrderChoices;
  qty: number;
  owner: 'me' | 'guest';
  name?: string;
}
export type CartOp =
  | { op: 'ADD'; menuId: string | null; pick: number | null; qty: number; owner: 'me' | 'guest'; name?: string; person: number | null; allergies: string[]; choices: OrderChoices; prefs: Intent['conditions'] }
  | { op: 'EDIT'; line: number; menuId?: string; choices?: OrderChoices; qty?: number; owner?: 'me' | 'guest'; name?: string; allergies?: string[] }
  | { op: 'REMOVE'; line: number };
export interface CartAiResult {
  /** 장바구니에 담기·고치기·빼기 (없으면 []) */
  ops: CartOp[];
  /** 한 사람 추천만 원함 ("감기 걸렸는데 추천해줘") — 조건·옵션 */
  recommend: { prefs: Intent['conditions']; choices: OrderChoices; menuId: string | null } | null;
  ask: 'WHY' | 'COMPARE' | 'LAST' | null;
  order: boolean;
  /** 젬마가 쓴 상황 한 줄 (검사함) — 화면과 AI 한마디에 */
  reason: string | null;
  /** 10명이 넘어 자른 사람 수 */
  capped: number | null;
  by: string | null;
}

/** null = AI가 없거나·늦거나·알아들은 게 없음 (화면은 지금처럼 규칙으로) */
// 10/27 예형님 "젬마가 끝까지 판단": 사람이 많으면 답이 길어 25초를 넘김 → 40초. 그래도 늦으면 late (화면은 규칙으로 넘기지 않고 "다시 말해 주세요")
export const CART_AI_TIMEOUT_MS = 40000;
export async function aiCartCommands(ai: Pick<AiRoute, 'route'>, catalog: SubwayCatalog, text: string, cart: CartLineIn[], recs: string[], timeoutMs = CART_AI_TIMEOUT_MS, active: number | null = null): Promise<CartAiResult | { late: true } | null> {
  const nameOf = (id: string | null) => (id ? catalog.menus.find((m) => m.id === id)?.name ?? null : null);
  const view: CartLineView[] = cart.map((l, i) => ({ no: i + 1, menu: nameOf(l.menuId) ?? '(아직 안 고름)', qty: l.qty, owner: l.owner === 'guest' ? 'GUEST' : 'ME', ...(l.name ? { name: l.name } : {}), ...(i === active ? { current: true } : {}) }));
  const recNames = recs.map(nameOf).filter((x): x is string => !!x);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      ai.route({ request_id: randomUUID(), trace_id: randomUUID(), task: 'intent_structuring', lane: 'interactive', instructions: commandInstructions(catalog), input: commandInput(text, view, recNames), output_schema: { name: 'cart_commands', schema: commandSchema(catalog) }, max_output_tokens: 3000 }),
      new Promise<'late'>((ok) => (timer = setTimeout(() => ok('late'), timeoutMs))),
    ]);
    if (r === 'late') return { late: true };
    if (!r || (r.code !== 'SUCCESS' && r.code !== 'FALLBACK_USED') || !r.output) return null;
    const { commands, reason } = validateCommands(r.output, catalog, text, cart.length);
    const kindOf = (id: string | null) => catalog.menus.find((m) => m.id === id)?.kind ?? 'SANDWICH';
    const ops: CartOp[] = [];
    let recommend: CartAiResult['recommend'] = null;
    let ask: CartAiResult['ask'] = null;
    let order = false;
    // 사람 10명까지: 11번째 사람부터는 자름 (줄도 10줄까지)
    // (사람 번호 칸은 1~10만 고를 수 있어 11번째 사람은 번호 없이 오기도 함 → 담기 줄 수로 셈)
    const adds = commands.filter((c) => c.op === 'ADD').length;
    const capped = adds > MAX_PEOPLE ? adds : null;
    for (const c of commands) {
      if (c.op === 'ADD') {
        if ((c.person ?? 1) > MAX_PEOPLE || ops.filter((o) => o.op === 'ADD').length >= MAX_PEOPLE) continue;
        const menuId = c.intent.menu ?? null;
        ops.push({ op: 'ADD', menuId, pick: menuId ? null : c.pick, qty: c.qty ?? 1, owner: c.owner === 'GUEST' ? 'guest' : 'me', ...(c.name ? { name: c.name } : {}), person: c.person, allergies: c.intent.conditions.allergies ?? [], choices: applyOptions({}, c.intent.options, kindOf(menuId), catalog).choices, prefs: c.intent.conditions });
      } else if (c.op === 'EDIT') {
        const lines = c.line === 'ALL' ? cart.map((_, i) => i) : typeof c.line === 'number' ? [c.line - 1] : [];
        for (const i of lines) {
          const l = cart[i];
          if (!l) continue;
          const menuId = c.intent.menu && c.intent.menu !== l.menuId ? c.intent.menu : undefined;
          const hasOpt = Object.values(c.intent.options).some((v) => v !== undefined);
          // "랜치도 추가": 지금 그 줄 소스에 더함 (10/27: 소금·후추가 랜치로 바뀌던 것)
          if (c.intent.options.saucesAdd && c.intent.options.sauces?.length) c.intent.options.sauces = [...new Set([...(l.choices.sauces ?? []), ...c.intent.options.sauces])];
          // 조건만 말함 ("가볍게") → 줄 고치기가 아니라 추천 (10/27: 담은 게 있으면 "가볍게"가 빈 고치기로 사라지던 것)
          if (!menuId && !hasOpt && !c.qty && !c.name && !c.owner && !c.intent.conditions.allergies?.length) {
            recommend ??= { prefs: c.intent.conditions, choices: {}, menuId: null };
            continue;
          }
          ops.push({
            op: 'EDIT', line: i,
            ...(menuId ? { menuId } : {}),
            ...(hasOpt || menuId ? { choices: applyOptions(menuId ? {} : l.choices, c.intent.options, kindOf(menuId ?? l.menuId), catalog).choices } : {}),
            ...(c.qty ? { qty: c.qty } : {}),
            ...(c.owner === 'GUEST' ? { owner: 'guest' as const } : c.owner === 'ME' ? { owner: 'me' as const } : {}),
            ...(c.name ? { name: c.name } : {}),
            ...(c.intent.conditions.allergies?.length ? { allergies: c.intent.conditions.allergies } : {}),
          });
        }
      } else if (c.op === 'REMOVE') {
        const lines = c.line === 'ALL' ? cart.map((_, i) => i) : typeof c.line === 'number' ? [c.line - 1] : [];
        for (const i of lines) if (cart[i]) ops.push({ op: 'REMOVE', line: i });
      } else if (c.op === 'RECOMMEND') {
        recommend ??= { prefs: c.intent.conditions, choices: applyOptions({}, c.intent.options, kindOf(c.intent.menu ?? null), catalog).choices, menuId: c.intent.menu ?? null };
      } else if (c.op === 'ASK_WHY') ask = 'WHY';
      else if (c.op === 'COMPARE') ask = 'COMPARE';
      else if (c.op === 'ORDER') order = true;
    }
    // 음료·사이드만 따로 담은 줄은 바로 앞 메뉴 줄에 단품으로 붙인다 (11/02: "로스트 치킨 하나랑 콜라 하나"가 OpenAI에서 2줄이 되던 것.
    // 규칙 해석도 같은 줄 단품으로 읽는다)
    for (let i = ops.length - 1; i > 0; i--) {
      const o = ops[i]!;
      if (o.op !== 'ADD' || o.menuId || o.pick || o.name || o.allergies.length) continue;
      const keys = Object.keys(o.choices).filter((k) => (o.choices as Record<string, unknown>)[k] !== undefined);
      const prefs = Object.values(o.prefs ?? {}).some((v) => v != null && v !== false && !(Array.isArray(v) && !v.length));
      if (!keys.length || keys.some((k) => k !== 'extras' && k !== 'drink') || prefs) continue;
      const prev = ops.slice(0, i).reverse().find((p): p is Extract<CartOp, { op: 'ADD' }> => p.op === 'ADD' && (p.person ?? 1) === (o.person ?? 1) && !!(p.menuId || p.pick));
      if (!prev || (o.choices.drink && prev.choices.drink)) continue;
      prev.choices = { ...prev.choices, ...(o.choices.extras?.length ? { extras: [...(prev.choices.extras ?? []), ...o.choices.extras] } : {}), ...(o.choices.drink ? { drink: o.choices.drink } : {}) };
      ops.splice(i, 1);
    }
    // 주문 규칙 검사 (11/02: 1위가 "로티세리 치킨 … 샐러드"일 때 "로티 허니오트로" → OpenAI가 샐러드에 빵을 넣어
    // 주문서가 400으로 거절되던 것). 규칙에 안 맞는 줄은 규칙이 읽은 메뉴로 바꿔 보고, 그래도 안 맞으면 AI 답을 버린다 → 화면은 규칙으로
    const menuOf = (id: string | null | undefined) => (id ? catalog.menus.find((m) => m.id === id) ?? null : null);
    const fits = (id: string | null | undefined, ch: OrderChoices | undefined) => {
      const m = menuOf(id);
      return !m || !ch || m.kind === 'SIDE' || buildOrderSheet(m, ch, catalog).ok;
    };
    let ruleMenu: string | null | undefined;
    for (const o of ops) {
      if (o.op === 'REMOVE') continue;
      const id = o.op === 'ADD' ? o.menuId : (o.menuId ?? cart[o.line]?.menuId);
      if (fits(id, o.choices)) continue;
      ruleMenu ??= parseRules(text, catalog).intent.menu ?? null;
      if (ruleMenu && ruleMenu !== id && fits(ruleMenu, o.choices)) o.menuId = ruleMenu;
      else return null;
    }
    // "지난번처럼": 장바구니 명령은 버리고 화면의 지난 주문 불러오기로
    if (commands.some((c) => c.op === 'LAST')) return { ops: [], recommend: null, ask: 'LAST', order: false, reason: null, capped: null, by: r.provider_id ?? null };
    if (!ops.length && !recommend && !ask && !order && !reason) return null;
    return { ops, recommend, ask, order, reason, capped, by: r.provider_id ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
