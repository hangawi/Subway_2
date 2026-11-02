// 취향 기억하기 이야기 2차 (10/20 저녁): 1차(taste-stories.ts)와 다른 말투·순서
//  새 말투("치킨파야", "소고기 원래 좋아함", "오늘은 참치 당겨", "오늘 소고기 패스"), 여러 취향 섞기, 같은 재료 다른 메뉴 3번 주문,
//  [평소처럼] 더 넣기, 주문 기록 끔, "지난번처럼", 새벽 4시 경계, "뭐 먹지?" + 취향, 알레르기·예산과 섞기, 피곤함 새 말투
//   npx tsx scripts/taste-stories.ts --set 2 [--live 주소] [--docs]
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import type { MainKind } from '../src/subway-menu/menu-domain.ts';
import type { Story } from './taste-stories.ts';

const NOON = '2026-10-20T12:10:00+09:00';
const NIGHT = '2026-10-20T23:00:00+09:00';
const BEFORE4 = '2026-10-21T03:59:00+09:00';
const AFTER4 = '2026-10-21T04:01:00+09:00';
const NEXT_DAY = '2026-10-21T12:10:00+09:00';
const W: Array<[MainKind, string]> = [['쇠고기', '소고기'], ['닭고기', '치킨'], ['돼지고기', '돼지고기'], ['새우', '새우'], ['참치', '참치'], ['달걀', '계란'], ['야채', '채식']];

export function makeStories2(): Story[] {
  const catalog = loadSubwayCatalog();
  const out: Story[] = [];
  const add = (title: string, steps: Story['steps'], consent = true, ordersOff = false) =>
    out.push({ id: `T2-${String(out.length + 1).padStart(3, '0')}`, title, consent, steps, ...(ordersOff ? { ordersOff } : {}) });
  for (const [k, w] of W) {
    add(`"${w} 원래 좋아함" (순서 바뀐 말) → Top3에 ${k}`, [{ say: `${w} 원래 좋아함` }, { check: { has: k, item: `평소 ${k} 좋아함` } }]);
    add(`"나 ${w}파야" → Top3에 ${k}`, [{ say: `나 ${w}파야` }, { check: { has: k, item: `평소 ${k} 좋아함` } }]);
    add(`"평소에 ${w} 잘 안 먹어" → Top3에 ${k} 없음`, [{ say: `평소에 ${w} 잘 안 먹어` }, { check: { lacks: k, item: `평소 ${k} 피함` } }]);
    add(`"오늘은 ${w} 당겨" → 밤까지, 다음 날 없음`, [{ say: `오늘은 ${w} 당겨` }, { check: { has: k, item: `오늘은 ${k} 좋아함` }, at: NIGHT }, { check: { empty: true }, at: NEXT_DAY }]);
    add(`"평소에 ${w} 좋아해" → "뭐 먹지?" → ${k} 메뉴로`, [{ say: `평소에 ${w} 좋아해` }, { check: { has: k, vague: true }, say: '뭐 먹지?' }]);
    add(`평소 ${w} 좋아함 + "오늘 ${w} 패스" → 오늘은 빼고 내일은 다시`, [{ say: `평소에 ${w} 좋아해` }, { say: `오늘 ${w} 패스` }, { check: { lacks: k } }, { check: { has: k }, at: NEXT_DAY }]);
  }
  // 여러 취향 섞기 (좋아함 + 싫어함)
  const pairs: Array<[number, number]> = [[0, 1], [1, 2], [2, 0], [3, 1], [4, 0], [1, 4], [0, 3], [2, 4]];
  for (const [a, b] of pairs) {
    const [ka, wa] = W[a]!;
    const [kb, wb] = W[b]!;
    add(`평소 ${wa} 좋아하고 ${wb}는 별로 → ${ka} 있고 ${kb} 없음`, [{ say: `평소에 ${wa} 좋아해` }, { say: `나 원래 ${wb} 별로야` }, { check: { has: ka, lacks: kb } }]);
  }
  // 같은 재료 다른 메뉴 3번 → "자주 먹는 ○○ 메뉴"
  const sw = catalog.menus.filter((m) => m.kind === 'SANDWICH' && !/^미니/.test(m.name));
  const byMain = (re: RegExp) => sw.filter((m) => re.test(m.name)).map((m) => m.name);
  const trios: Array<[MainKind, string[]]> = [
    ['닭고기', byMain(/치킨|로티세리/).slice(0, 3)], ['닭고기', byMain(/치킨|로티세리/).slice(1, 4)],
    ['돼지고기', byMain(/햄|베이컨|잠봉|비엠티|이탈리안|피자썹|비엘티/).slice(0, 3)], ['돼지고기', byMain(/햄|베이컨|잠봉|비엠티|이탈리안|피자썹|비엘티/).slice(2, 5)],
    ['쇠고기', byMain(/스테이크|비프/).slice(0, 3)], ['쇠고기', [...byMain(/스테이크|비프/).slice(0, 2), byMain(/스테이크|비프/)[0]!]],
  ];
  for (const [k, names] of trios) add(`${names.join('·')} 주문 → 자주 먹는 ${k} 메뉴`, [...names.map((n) => ({ order: n })), { check: { has: k, item: `자주 먹는 ${k} 메뉴` } }]);
  // 같은 메뉴 3번
  for (const m of sw.slice(0, 10)) add(`${m.name} 3번 → 자주 고른 메뉴 (3번)`, [{ order: m.name }, { order: m.name }, { order: m.name }, { check: { hasMenu: m.name, item: `자주 고른 메뉴: ${m.name} (3번)` } }]);
  // [평소처럼]에 더 넣기
  for (const [i, v] of (['피클', '할라피뇨', '올리브', '오이'] as const).entries())
    add(`${v} 더 넣고 2번 주문 → [평소처럼]에 ${v} 더`, [{ order: sw[i]!.name, add: [v] }, { order: sw[i + 1]!.name, add: [v] }, { check: { usualAdd: v, item: `늘 ${v} 더` } }]);
  // [평소처럼] 말로
  for (const [i, v] of (['양파', '피망(파프리카)', '토마토', '올리브'] as const).entries())
    add(`${v} 빼고 2번 → "평소처럼"`, [{ order: sw[i + 3]!.name, remove: [v] }, { order: sw[i + 4]!.name, remove: [v] }, { check: { usualRemove: v, ask: 'LAST' }, say: '평소처럼 해줘' }]);
  // 주문 기록 끔 → 안 배움
  for (const m of sw.slice(10, 14)) add(`주문 기록 끔: ${m.name} 2번 → 안 배움`, [{ order: m.name }, { order: m.name }, { check: { noItem: '자주 고른 메뉴', empty: true } }], true, true);
  // "지난번처럼"
  for (const [i, t] of ['지난번처럼', '저번이랑 똑같이', '저번 거로 줘', '늘 먹던 걸로'].entries()) add(`주문 뒤 "${t}"`, [{ order: sw[i]!.name }, { check: { ask: 'LAST' }, say: t }]);
  // 새벽 4시 경계
  for (const [k, w] of W.slice(0, 4))
    add(`"오늘은 ${w} 땡겨" 밤 11시 → 새벽 3:59엔 남고 4:01엔 없음`, [{ say: `오늘은 ${w} 땡겨`, at: NIGHT }, { check: { item: `오늘은 ${k} 좋아함` }, at: BEFORE4 }, { check: { empty: true }, at: AFTER4 }]);
  // 알레르기·예산과 섞기
  add('평소 새우 좋아함 + "새우 먹으면 안 돼" → 새우 메뉴 없음', [{ say: '평소에 새우 좋아해' }, { check: { noAllergen: '새우', lacks: '새우' }, say: '새우 먹으면 안 돼' }]);
  add('평소 계란 좋아함 + 계란 알러지 → 달걀 메뉴 없음', [{ say: '평소에 계란 좋아해' }, { check: { noAllergen: '난류', lacks: '달걀' }, say: '계란 알러지임' }]);
  add('평소 소고기 좋아함 + 1.2만원 이하', [{ say: '평소에 소고기 좋아해' }, { check: { maxPrice: 12000 }, say: '1.2만원 이하로 ㄱㄱ' }]);
  add('평소 치킨 좋아함 + 8000원 밑으로', [{ say: '나 치킨파야' }, { check: { maxPrice: 8000 }, say: '8000원 밑으로 추천' }]);
  add('평소 참치 좋아함 + 대두 알레르기', [{ say: '참치 원래 좋아함' }, { check: { noAllergen: '대두' }, say: '대두 알레르기 있음' }]);
  add('주문 기록 돼지고기 3번 + "오늘은 돼지고기 피할래"', [...byMain(/햄|베이컨|잠봉|비엠티|이탈리안|피자썹|비엘티/).slice(0, 3).map((n) => ({ order: n })), { say: '오늘은 돼지고기 피할래' }, { check: { lacks: '돼지고기' } }]);
  // 취향 기억하기 끔 + 주문 기록 켬 → 말한 취향은 사라지고 주문 기록은 남음
  for (const m of sw.slice(14, 18))
    add(`기억하기 끔 + ${m.name} 2번 → 다시 열면 말한 취향은 없고 자주 고른 메뉴는 있음`, [{ say: '평소에 새우 좋아해' }, { order: m.name }, { order: m.name }, { newSession: true }, { check: { item: `자주 고른 메뉴: ${m.name}`, noItem: '평소 새우' } }], false);
  // 피곤함 새 말투
  for (const t of ['오늘 컨디션 별로야', '피곤해서 죽겠다', '오늘 완전 녹초야', '몸이 너무 피곤함']) add(`"${t}" → 오늘만 든든하게`, [{ say: t }, { check: { tired: true } }, { check: { tired: false }, at: NEXT_DAY }]);
  void NOON;
  return out;
}
