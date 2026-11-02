// 여러 개 주문 나누기 (10/26 예형님 "AI가 무슨 말이든 알아들어서"): 규칙이 못 나눈 말만 AI에게 "몇 줄로, 줄마다 무슨 말"을 묻는다.
// AI는 나누기만 하고, 줄마다 뜻(메뉴·조건)은 화면이 규칙으로 다시 읽는다. 순서는 A100 gemma → 안 되면 OpenAI (라우터 그대로).
// 지키는 것: 줄마다 말은 원래 문장에 있는 말(띄어쓰기 빼고 그대로)만, 2~5줄, 줄마다 1~10개 — 아니면 버리고 한 사람 주문으로.
import { randomUUID } from 'node:crypto';
import type { AiRoute } from './interpret.ts';

export const SPLIT_INSTRUCTIONS = `너는 써브웨이 주문 문장을 "여러 개 주문"이면 줄로 나누는 도우미다.
- 한 사람이 메뉴 하나를 시키는 말이면 items를 빈 배열로.
- 여러 개면 줄마다 {text, qty}: text는 그 줄을 말한 부분을 문장에서 그대로 옮긴다 (새 말을 만들지 않는다). qty는 그 줄 개수 (말 안 했으면 1).
- "하나씩"이면 각 줄 1. "나는 ~ 민수는 ~"처럼 사람이 나뉘면 사람마다 줄 (text에 그 사람 말 포함).
- 매운 정도·소스·빼기 같은 꾸밈은 그 메뉴 줄에 붙인다 (따로 줄로 만들지 않는다).
- 음료·사이드만 여러 개("콜라 하나 쿠키 하나")는 한 사람 주문이라 빈 배열.`;

const squash = (s: string) => s.normalize('NFC').replace(/[\s,.!?~]/g, '');
export const MAX_SPLIT = 5;

export type SplitRoute = Pick<AiRoute, 'route'>;

/** AI로 나누기. 못 나누거나 믿을 수 없으면 null */
export async function aiSplit(ai: SplitRoute, text: string, timeoutMs = 5000): Promise<Array<{ text: string; qty: number }> | null> {
  const t = text.slice(0, 200);
  const schema = { name: 'subway_split', schema: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', maxItems: MAX_SPLIT + 2, items: { type: 'object', additionalProperties: false, required: ['text', 'qty'], properties: { text: { type: 'string' }, qty: { type: 'integer' } } } } } } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      ai.route({ request_id: randomUUID(), trace_id: randomUUID(), task: 'intent_structuring', lane: 'interactive', instructions: SPLIT_INSTRUCTIONS, input: t, output_schema: schema, max_output_tokens: 300 }),
      new Promise<null>((ok) => (timer = setTimeout(() => ok(null), timeoutMs))),
    ]);
    if (!r || (r.code !== 'SUCCESS' && r.code !== 'FALLBACK_USED') || !r.output) return null;
    const items = ((r.output as { items?: Array<{ text?: unknown; qty?: unknown }> }).items ?? [])
      .map((x) => ({ text: String(x.text ?? '').trim(), qty: Number(x.qty) }))
      .filter((x) => x.text);
    if (items.length < 2 || items.length > MAX_SPLIT) return null;
    const whole = squash(t);
    // 지어낸 말·이상한 개수는 버림 (줄마다 원래 문장에 있어야)
    if (!items.every((x) => squash(x.text).length >= 1 && whole.includes(squash(x.text)) && Number.isInteger(x.qty) && x.qty >= 1 && x.qty <= 10)) return null;
    return items;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
