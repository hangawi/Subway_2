// 추천 Top3 AI 한마디 (10/21 예형님): 정해진 이유 문구 아래에 AI가 쓴 한 줄.
// - AI에게는 그 메뉴의 실제 값(열량·단백질·나트륨·가격·메인 재료·알레르기 성분)과 손님이 말한 조건만 준다
// - 답에 그 값에 없는 숫자가 있거나, 효능·안전을 장담하는 말이 있으면 그 줄은 버린다 (지어내기 막기)
// - A100만 (OpenAI로 넘기지 않음 — 없어도 되는 설명이라 돈을 쓰지 않는다), 늦으면 없이. 같은 요청은 저장해 둔 답
import { randomUUID } from 'node:crypto';
import type { SubwayCatalog } from '../catalog/subway-catalog.ts';
import type { AiRoute } from '../conversation/interpret.ts';
import type { MenuPrefs } from '../flow/recommend-flow.ts';
import { mainKindsOf } from './menu-domain.ts';

// 11/02: A100 젬마(4초) → OpenAI minimal (p50 약 3초)이라 8초
export const EXPLAIN_TIMEOUT_MS = 8000;
const KIND_KO: Record<string, string> = { SANDWICH: '샌드위치', SALAD: '샐러드', GRAIN_SALAD: '그레인 샐러드', WRAP: '랩', MORNING_SANDWICH: '아침 샌드위치', MORNING_WRAP: '아침 랩', SIDE: '사이드' };
const MEAL_KO: Record<string, string> = { BREAKFAST: '아침', LUNCH: '점심', DINNER: '저녁', LATE_NIGHT: '야식' };
const INSTRUCTIONS = `너는 써브웨이 추천 메뉴에 한 줄 설명을 붙이는 도구다.
- 메뉴마다 한국어 한 문장, 25~70자. "~예요/~해요" 말투. 손님 조건과 그 메뉴가 왜 맞는지 자연스럽게.
- 손님 상황이 있으면 (예: 감기, 야구부 운동 후) 그 상황에 이 메뉴가 왜 맞는지를 주어진 값(열량·단백질·나트륨·수프 세트·맵지 않음 등)으로 말한다. 메뉴 소개만 하지 않는다. 상황을 낫게 한다·좋아진다는 말은 하지 않는다.
- 주어진 값만 쓴다. 주어진 값에 없는 숫자·재료·맛·효능은 쓰지 않는다. 건강·다이어트·알레르기 안전을 장담하지 않는다.
- 숫자를 쓸 때는 주어진 값 그대로 (예: 193kcal, 단백질 20.2g).
- 메뉴 이름을 그대로 다시 쓰지 않아도 된다. 광고 문구·느낌표·이모지는 쓰지 않는다.
- 추천한 메뉴를 깎아내리지 않는다. 조건에 덜 맞는 점은 쓰지 말고, 맞는 점(가격·단백질·열량 등)을 쓴다.`;
// 11/02: OpenAI가 "포화지방이 높아 덜 적합해요"처럼 추천 메뉴를 깎던 것 → 그런 줄은 안 보임
const NEGATIVE = /덜\s*적합|적합하지|맞지\s*않|안\s*맞|아쉬|권하지|추천하지|피하는\s*게|높아서?\s*(?:덜|별로|아쉬)|높은\s*편이라|상대적으로\s*높/;
const BANNED = /치료|효능|효과가|건강에 좋|살이 빠|살 빠|면역|최고의|무조건|안전해요|걱정 없|걱정없|알레르기 없|보장|낫|회복|!|[\u{1F300}-\u{1FAFF}]/u;

// 메인 재료 말 → 종류 (그 메뉴에 없는 재료를 말하면 지어낸 것 — 10/21: 머쉬룸에 "쇠고기와 버섯의 조합")
const MAIN_SAID: Array<[RegExp, string]> = [[/쇠고기|소고기|비프|스테이크/, '쇠고기'], [/닭|치킨/, '닭고기'], [/돼지|햄|베이컨|포크/, '돼지고기'], [/새우|쉬림프/, '새우'], [/참치|튜나/, '참치'], [/계란|달걀|에그/, '달걀']];

const cache = new Map<string, Record<string, string>>();

function conditionsText(p: Partial<MenuPrefs>): string {
  const out: string[] = [];
  if (p.goal === 'LIGHT') out.push('가볍게');
  if (p.goal === 'FILLING') out.push('든든하게');
  if (p.goal === 'PROTEIN') out.push('단백질 많이');
  if (p.wantMains?.length) out.push(`${p.wantMains.join('·')} 메뉴로`);
  if (p.avoidMains?.length) out.push(`${p.avoidMains.join('·')} 빼고`);
  if (p.wantSpicy) out.push('맵게');
  if (p.avoidSpicy) out.push('안 맵게');
  if (p.budgetKrw) out.push(`${p.budgetKrw}원 이하`);
  if (p.maxSodiumMg) out.push(`나트륨 ${p.maxSodiumMg}mg 이하`);
  if (p.salty === 'MORE') out.push('짭짤하게');
  if (p.salty === 'LESS') out.push('싱겁게');
  if (p.lowFat) out.push('기름기 적게 (포화지방 낮게)');
  if (p.allergies?.length) out.push(`${p.allergies.join('·')} 알레르기`);
  if (p.meal) out.push(`${MEAL_KO[p.meal]}으로`);
  return out.length ? out.join(', ') : '따로 말한 조건 없음';
}

/** 메뉴 id → 한 줄 (못 쓴 메뉴는 빠짐) */
export async function aiExplain(ai: AiRoute, catalog: SubwayCatalog, menuIds: string[], prefs: Partial<MenuPrefs>, timeoutMs = EXPLAIN_TIMEOUT_MS, situation: string | null = null): Promise<Record<string, string>> {
  const menus = menuIds.map((id) => catalog.menus.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m);
  if (!menus.length) return {};
  const cond = conditionsText(prefs);
  const key = `${menus.map((m) => m.id).join(',')}|${cond}|${situation ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const facts = menus.map((m) => {
    const n = m.nutrition15cm;
    return { id: m.id, 이름: m.name, 종류: KIND_KO[m.kind] ?? m.kind, 열량: n?.energyKcal != null ? `${n.energyKcal}kcal` : null, 단백질: n?.proteinG != null ? `${n.proteinG}g` : null, 나트륨: n?.sodiumMg != null ? `${n.sodiumMg}mg` : null, 포화지방: n?.saturatedFatG != null ? `${n.saturatedFatG}g` : null, 가격: m.price.price15cm != null ? `${m.price.price15cm}원 (15cm)` : null, 메인재료: mainKindsOf(m).join('·') || null, 알레르기성분: m.allergens.contains.join('·') || null };
  });
  // 답에 써도 되는 숫자 = 값에 있는 숫자 + 조건의 숫자
  const allowed = new Set(JSON.stringify({ facts, cond, situation }).match(/\d+(?:\.\d+)?/g) ?? []);
  // 10/27 예형님: "감기 걸렸는데"라고 하면 그 상황에 왜 맞는지 (전엔 메뉴 소개만)
  const input = `${situation ? `손님 상황: ${situation}\n` : ''}손님 조건: ${cond}\n메뉴 값: ${JSON.stringify(facts)}`;
  const schema = { name: 'menu_lines', schema: { type: 'object', additionalProperties: false, required: ['lines'], properties: { lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string', enum: menus.map((m) => m.id) }, text: { type: 'string' } } } } } } };
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      ai.route({ request_id: randomUUID(), trace_id: randomUUID(), task: 'explanation', lane: 'interactive', instructions: INSTRUCTIONS, input, output_schema: schema, max_output_tokens: 400 }),
      new Promise<null>((ok) => (t = setTimeout(() => ok(null), timeoutMs))),
    ]);
    if (!r || r.code !== 'SUCCESS' || !r.output) return {};
    const lines = (r.output as { lines?: Array<{ id: string; text: string }> }).lines ?? [];
    const out: Record<string, string> = {};
    for (const l of lines) {
      const text = String(l.text ?? '').replace(/\s+/g, ' ').trim();
      const menu = menus.find((m) => m.id === l.id);
      if (!menu || out[l.id] || text.length < 8 || text.length > 90 || BANNED.test(text) || NEGATIVE.test(text) || /알레르기|알러지/.test(text)) continue;
      // 말한 조건과 반대되는 말 (10/21: "가볍게"인데 "든든하게 즐겨보세요")
      if ((prefs.goal === 'LIGHT' && /든든|배부르|배불리|푸짐|포만/.test(text)) || (prefs.goal === 'FILLING' && /가볍|가벼운/.test(text)) || (prefs.avoidSpicy && /매콤|맵|매운/.test(text))) continue;
      const kinds = mainKindsOf(menu);
      if (MAIN_SAID.some(([re, k]) => re.test(text) && !kinds.includes(k as never) && !re.test(menu.name))) continue;
      const nums = text.match(/\d+(?:\.\d+)?/g) ?? [];
      if (nums.some((x) => !allowed.has(x))) continue; // 값에 없는 숫자 = 지어낸 것
      out[l.id] = text;
    }
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(key, out);
    return out;
  } catch {
    return {};
  } finally {
    clearTimeout(t);
  }
}
