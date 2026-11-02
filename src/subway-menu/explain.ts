// 추천 설명 — 엔진이 돌려준 점수 조각·이유 코드와 엔진에 넣은 메뉴 사실(공식 영양·알레르기)만 쓴다.
// 지어내지 않는다: 엔진 결과에 없는 이유는 말하지 않고, 모르는 값은 "확인 필요"라고 한다.
import type { RankedCandidateOf } from '../../vendor/sophia/packages/contracts/src/decision-contract.ts';
import type { CatalogMenu } from '../catalog/subway-catalog.ts';
import type { MenuCandidate, MenuState, ScoreAxis } from './menu-domain.ts';

export type RankedMenu = RankedCandidateOf<MenuCandidate>;

const AXIS_NAME: Record<ScoreAxis | 'mealTime' | 'allergyRisk' | 'spicy', string> = {
  protein: '단백질',
  sodium: '나트륨',
  calorie: '열량',
  budget: '예산',
  satiety: '포만감',
  emotion: '기분',
  health: '건강',
  confidence: '정보 확실성',
  preference: '취향',
  mealTime: '시간대',
  allergyRisk: '알레르기 위험',
  spicy: '매운맛',
};

const num = (v: number | null | undefined, unit: string) => (v == null ? '확인 필요' : `${unit === '원' ? v.toLocaleString('ko-KR') : v}${unit}`);

// 받침에 맞는 조사 ("참치가", "잠봉 플러스가", "로스트 치킨이")
const hasBatchim = (word: string) => {
  const c = word.trim().slice(-1).charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0;
};
export const josa = (word: string, withB: string, without: string) => `${word}${hasBatchim(word) ? withB : without}`;

/** 추천 이유 (이유 코드 → 문장). 숫자는 공식 영양값 그대로. allergies를 주면 ★(포함 가능) 경고에 이름을 넣는다.
 *  mayContain: 고른 재료까지 합친 ★ 목록 (없으면 공식 메뉴 줄) — 10/15 */
export function explainMenu(c: RankedMenu, allergies: string[] = [], mayContain: string[] = c.menu.allergens.mayContain): string[] {
  const n = c.menu.nutrition15cm;
  const out: string[] = [];
  const has = (code: string) => c.reason_codes.includes(code);
  // 안전 경고는 맨 앞에
  if (has('ALLERGEN_MAY_CONTAIN_WARNING')) {
    const may = allergies.filter((a) => mayContain.includes(a)).join('·');
    out.push(`⚠ ${may ? josa(may, '이', '가') : '알레르기 재료가'} 들어 있을 수 있어요 (공식 표 ★ 포함 가능) — 매장에서 꼭 확인하세요`);
  }
  if (has('VEGETABLES_REMOVED')) out.push('말한 야채를 빼고 계산했어요');
  if (has('BREAKFAST_TIME')) out.push('지금 아침 시간이라 아침 메뉴를 먼저 골랐어요');
  if (has('SPICY_WANTED')) out.push('매운 걸 원해서 먼저 골랐어요');
  if (has('SPICY_ADDABLE')) out.push('할라피뇨·핫 칠리로 맵게 할 수 있어요');
  if (has('TASTE_FAVORITE_MENU')) out.push('자주 고른 메뉴예요');
  for (const code of c.reason_codes) {
    const m = code.match(/^TASTE_(LIKED|AVOID)_MAIN:([^:]+):(LASTING|TODAY)$/);
    if (!m) continue;
    const when = m[3] === 'TODAY' ? '오늘은' : '평소';
    out.push(m[1] === 'LIKED' ? `${when} 좋아하는 ${m[2]} 메뉴예요` : `${when} ${josa(m[2]!, '을', '를')} 피한다고 해서 아래로 내렸어요`);
  }
  if (has('HIGH_PROTEIN')) out.push(`단백질이 ${num(n?.proteinG, 'g')}으로 많아요`);
  if (has('LIGHT_MEAL')) out.push(`${num(n?.energyKcal, 'kcal')}로 가벼워요`);
  if (has('LIGHTER_FOR_EVENING')) out.push(`저녁이라 가벼운 쪽(${num(n?.energyKcal, 'kcal')})을 올렸어요`);
  if (has('LOW_SODIUM')) out.push(`나트륨이 ${num(n?.sodiumMg, 'mg')}로 낮은 편이에요`);
  if (has('LOW_FAT')) out.push(`기름기(포화지방 ${num(n?.saturatedFatG, 'g')})가 적은 편이에요`);
  if (has('SALTY_WANTED')) out.push(`짭짤한 편이에요 (나트륨 ${num(n?.sodiumMg, 'mg')})`);
  if (has('FILLING')) out.push('든든한 편이에요');
  if (has('WITHIN_BUDGET')) out.push(`예산 안이에요 (${num(c.menu.price.price15cm, '원')}, 15cm)`);
  if (has('PRICE_NEEDS_CHECK')) out.push('가격은 매장에서 확인이 필요해요');
  if (has('NUTRITION_UNKNOWN')) out.push('영양 정보가 없어 확인이 필요해요');
  if (!out.length) out.push(`${AXIS_NAME[topAxis(c)]} 점수가 가장 좋았어요`);
  return out;
}

const topAxis = (c: RankedMenu) =>
  Object.entries(c.score_components).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0] as ScoreAxis;

/** 뺀 이유 (거르기 이유 코드 → 문장). 어떤 알레르기 때문인지는 사용자가 말한 것과 공식 표를 맞대어 말한다 */
export function explainRejection(reasons: string[], menu: CatalogMenu, state: MenuState): string[] {
  const out: string[] = [];
  const hit = (list: string[]) => state.allergies.filter((a) => list.includes(a)).join('·');
  for (const r of reasons) {
    // 이름을 못 찾으면(기본 재료에서 온 알레르기 등) "고른 알레르기" — 빈 이름으로 " 알레르기라서"가 되지 않게
    if (r === 'ALLERGEN_CONTAINS') out.push(`${hit(menu.allergens.contains) || '고른'} 알레르기라서 뺐어요`);
    else if (r === 'ALLERGEN_MAY_CONTAIN') out.push(`${josa(hit(menu.allergens.mayContain) || '고른 알레르기', '이', '가')} 들어 있을 수 있어서 뺐어요`);
    else if (r === 'ALLERGEN_UNKNOWN') out.push('알레르기 정보가 없어서 뺐어요 (안전하다고 치지 않아요)');
    else if (r === 'MAX_ENERGY_EXCEEDED') out.push(`${num(menu.nutrition15cm?.energyKcal, 'kcal')}로 열량 상한(${state.maxEnergyKcal}kcal)을 넘어요`);
    else if (r === 'MAX_SODIUM_EXCEEDED') out.push(`나트륨 ${num(menu.nutrition15cm?.sodiumMg, 'mg')}으로 상한(${state.maxSodiumMg}mg)을 넘어요`);
    else if (r === 'OVER_BUDGET') out.push(`${num(menu.price.price15cm, '원')}으로 예산(${num(state.budgetKrw, '원')})을 넘어요`);
    else if (r === 'NOT_ON_SALE_NOW') out.push('아침 메뉴는 오전 11시까지만 팔아요 (공식 안내)');
    else if (r === 'NOT_FOR_THAT_MEAL') out.push('말씀하신 끼니에는 아침 메뉴를 팔지 않아요 (오전 11시까지)');
    else if (r === 'NUTRITION_UNKNOWN') out.push('영양 정보가 없어서 상한을 확인할 수 없어요');
    else if (r === 'KIND_NOT_REQUESTED') out.push('고른 종류가 아니에요');
    else if (r === 'TOO_SPICY') out.push('매운 메뉴라서 뺐어요');
    else if (r === 'NOT_WANTED_MAIN') out.push(`${(state.wantMains ?? []).join('·')} 메뉴가 아니라서 뺐어요`);
    else if (r === 'AVOIDED_MAIN') out.push(`${(state.avoidMains ?? []).join('·')} 메뉴라서 뺐어요`);
    else out.push(`확인 필요 (${r})`);
  }
  return out;
}

/** "1번이랑 2번 비교": 점수 조각 차이가 큰 순서 2개 */
export function compareMenus(a: RankedMenu, b: RankedMenu): string[] {
  const keys = [...new Set([...Object.keys(a.score_components), ...Object.keys(b.score_components)])];
  const diffs = keys
    .map((k) => ({ k: k as ScoreAxis | 'mealTime' | 'allergyRisk' | 'spicy', d: (a.score_components[k] ?? 0) - (b.score_components[k] ?? 0) }))
    .filter((x) => Math.abs(x.d) > 1e-9)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || (x.k < y.k ? -1 : 1))
    .slice(0, 2);
  if (!diffs.length) return [`${josa(a.menu.name, '과', '와')} ${josa(b.menu.name, '은', '는')} 점수가 거의 같아요`];
  return diffs.map(({ k, d }) => {
    const [win, lose] = d > 0 ? [a, b] : [b, a];
    return `${AXIS_NAME[k]}: ${josa(win.menu.name, '이', '가')} 더 좋아요${fact(k, win.menu, lose.menu)}`;
  });
}

function fact(k: string, w: CatalogMenu, l: CatalogMenu): string {
  const wn = w.nutrition15cm, ln = l.nutrition15cm;
  if (k === 'protein') return ` (단백질 ${num(wn?.proteinG, 'g')} vs ${num(ln?.proteinG, 'g')})`;
  if (k === 'sodium') return ` (나트륨 ${num(wn?.sodiumMg, 'mg')} vs ${num(ln?.sodiumMg, 'mg')})`;
  if (k === 'calorie' || k === 'satiety') return ` (${num(wn?.energyKcal, 'kcal')} vs ${num(ln?.energyKcal, 'kcal')})`;
  if (k === 'budget') return ` (${num(w.price.price15cm, '원')} vs ${num(l.price.price15cm, '원')})`;
  return '';
}
