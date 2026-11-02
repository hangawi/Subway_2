// 취향 기억하기 이야기 3차 (10/21 아침): 1·2차와 다른 말 — 사투리("소고기 억수로 좋아한다", "치킨은 원래 안 묵는다", "오늘은 참치 땡기네예"),
// 수다 속 취향, 여러 번 바꾸기(좋아함 → 싫어함), 주문 기록 + 말한 취향 섞기, 샐러드·랩 주문 기록, 오늘 상태 사투리, "뭐 묵지?" + 취향
//   npx tsx scripts/taste-stories.ts --set 3 [--live 주소] [--docs]
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import type { MainKind } from '../src/subway-menu/menu-domain.ts';
import type { Story } from './taste-stories.ts';

const NIGHT = '2026-10-20T23:10:00+09:00';
const NEXT_DAY = '2026-10-21T12:10:00+09:00';
const W: Array<[MainKind, string]> = [['쇠고기', '소고기'], ['닭고기', '닭고기'], ['돼지고기', '돼지고기'], ['새우', '새우'], ['참치', '참치'], ['달걀', '계란'], ['야채', '채식']];

export function makeStories2(): Story[] {
  const catalog = loadSubwayCatalog();
  const out: Story[] = [];
  const add = (title: string, steps: Story['steps'], consent = true, ordersOff = false) =>
    out.push({ id: `T3-${String(out.length + 1).padStart(3, '0')}`, title, consent, steps, ...(ordersOff ? { ordersOff } : {}) });
  for (const [k, w] of W) {
    add(`"${w} 억수로 좋아한다" → Top3에 ${k}`, [{ say: `평소에 ${w} 억수로 좋아한다` }, { check: { has: k, item: `평소 ${k} 좋아함` } }]);
    add(`"${w}는 원래 안 묵는다" → Top3에 ${k} 없음`, [{ say: `${w}는 원래 안 묵는다` }, { check: { lacks: k, item: `평소 ${k} 피함` } }]);
    add(`"오늘은 ${w} 땡기네예" → 오늘만`, [{ say: `오늘은 ${w} 땡기네예` }, { check: { has: k, item: `오늘은 ${k} 좋아함` }, at: NIGHT }, { check: { empty: true }, at: NEXT_DAY }]);
    add(`수다 속 취향: "회사 끝나고 왔는데 평소에 ${w} 좋아하거든"`, [{ say: `오늘 회사 끝나고 왔는데 나는 평소에 ${w} 좋아하거든` }, { check: { has: k } }]);
    add(`좋아한다 했다가 "아니 ${w} 별로야" → 싫어함으로 바뀜`, [{ say: `평소에 ${w} 좋아해` }, { say: `나 원래 ${w} 별로야` }, { check: { lacks: k, item: `평소 ${k} 피함`, noItem: `평소 ${k} 좋아함` } }]);
    add(`"평소에 ${w} 좋아해" → "뭐 묵지" → ${k} 메뉴로`, [{ say: `평소에 ${w} 좋아해` }, { check: { has: k, vague: true }, say: '뭐 묵지' }]);
  }
  const sw = catalog.menus.filter((m) => m.kind === 'SANDWICH' && !/^미니/.test(m.name));
  const salads = catalog.menus.filter((m) => m.kind === 'SALAD');
  const wraps = catalog.menus.filter((m) => m.kind === 'WRAP' && !/미니/.test(m.name));
  // 샐러드·랩 주문 기록
  for (const m of [...salads.slice(0, 5), ...wraps.slice(0, 5)]) add(`${m.name} 2번 → 자주 고른 메뉴`, [{ order: m.name }, { order: m.name }, { check: { hasMenu: m.name, item: `자주 고른 메뉴: ${m.name} (2번)` } }]);
  // 주문 기록 + 말한 취향 섞기: 자주 고른 메뉴가 있어도 "오늘은 ○○ 피할래"면 그 재료 메뉴는 오늘 빠짐
  const mainOf: Record<string, MainKind> = { 쉬림프: '새우', 참치: '참치', 에그마요: '달걀', '로스트 치킨': '닭고기', '스테이크 & 치즈': '쇠고기' };
  for (const [name, k] of Object.entries(mainOf)) {
    const w = W.find((x) => x[0] === k)![1];
    add(`${name} 2번 주문 + "오늘은 ${w} 피할래" → 오늘은 ${k} 없음, 내일은 ${name} 다시`, [{ order: name }, { order: name }, { say: `오늘은 ${w} 피할래` }, { check: { lacks: k } }, { check: { hasMenu: name }, at: NEXT_DAY }]);
  }
  // 오늘 상태 사투리
  for (const t of ['오늘 억수로 피곤하다', '아 진짜 녹초다 오늘', '오늘 기운이 하나도 없네예', '몸이 천근만근이다 오늘', '피곤해 죽겠다 진짜']) add(`"${t}" → 오늘만 든든하게`, [{ say: t }, { check: { tired: true } }, { check: { tired: false }, at: NEXT_DAY }]);
  // 여러 메뉴 3번씩 → 여러 개가 자주 고른 메뉴
  for (let i = 0; i < 5; i++) {
    const a = sw[i]!.name;
    const b = sw[i + 5]!.name;
    add(`${a}·${b} 각각 2번 → 둘 다 자주 고른 메뉴`, [{ order: a }, { order: b }, { order: a }, { order: b }, { check: { item: `자주 고른 메뉴: ${a}` } }, { check: { item: `자주 고른 메뉴: ${b}` } }]);
  }
  // 알레르기·예산과 섞기 (사투리)
  add('평소 새우 좋아함 + "새우 먹으면 큰일 나"', [{ say: '평소에 새우 좋아해' }, { check: { noAllergen: '새우', lacks: '새우' }, say: '새우 먹으면 큰일 나' }]);
  add('평소 계란 좋아함 + "계란은 못 묵는다"', [{ say: '평소에 계란 좋아해' }, { check: { noAllergen: '난류', lacks: '달걀' }, say: '계란은 못 묵는다' }]);
  add('평소 소고기 좋아함 + "만원 넘으면 안 돼"', [{ say: '평소에 소고기 좋아해' }, { check: { maxPrice: 10000 }, say: '만원 넘으면 안 돼' }]);
  add('평소 치킨 좋아함 + "칠천원까지만"', [{ say: '평소에 닭고기 좋아해' }, { check: { maxPrice: 7000 }, say: '칠천원까지만' }]);
  add('평소 돼지고기 좋아함 + "고기는 빼고"', [{ say: '평소에 돼지고기 좋아해' }, { check: { lacks: ['돼지고기', '쇠고기', '닭고기'] }, say: '오늘은 고기는 빼고 추천해줘' }]);
  // 기억하기 끔 (사투리)
  for (const [k, w] of W.slice(0, 5)) add(`기억하기 끔: "${w} 억수로 좋아한다" → 다시 열면 없음`, [{ say: `평소에 ${w} 억수로 좋아한다` }, { check: { has: k } }, { newSession: true }, { check: { empty: true } }], false);
  // 지우기
  for (const [k, w] of W.slice(2, 7)) add(`"${w}는 원래 안 묵는다" 지우기 → 추천에 다시`, [{ say: `${w}는 원래 안 묵는다` }, { del: 'record' }, { check: { empty: true } }]);
  // 막연한 말(사투리) + 취향 여러 개
  for (const [a, b] of [[0, 3], [1, 4], [3, 0], [4, 2], [5, 1]] as const) {
    const [ka, wa] = W[a]!;
    const [kb, wb] = W[b]!;
    add(`평소 ${wa} 좋아함 + ${wb}는 안 묵음 → "머 무까" → ${ka} 있고 ${kb} 없음`, [{ say: `평소에 ${wa} 좋아해` }, { say: `${wb}는 원래 안 묵는다` }, { check: { has: ka, lacks: kb, vague: true }, say: '머 무까' }]);
  }
  // 같은 재료 다른 메뉴 3번 (샌드위치·샐러드 섞어)
  const mixed: Array<[MainKind, string[]]> = [
    ['닭고기', ['로스트 치킨', '로티세리 치킨 더블치즈 샐러드', '치킨 데리야끼']],
    ['참치', ['참치', '참치 아보카도 그레인 샐러드', '참치']],
    ['새우', ['쉬림프', '스파이시 쉬림프', '쉬림프 에그마요 랩']],
  ];
  for (const [k, names] of mixed) if (names.every((n) => catalog.menus.some((m) => m.name === n))) add(`${names.join('·')} → 자주 먹는 ${k} 메뉴`, [...names.map((n) => ({ order: n })), { check: { has: k, item: `자주 먹는 ${k} 메뉴` } }]);
  // 주문 기록 끔 + 말한 취향은 남음
  for (const [k, w] of W.slice(0, 4)) add(`주문 기록 끔 + "${w} 억수로 좋아한다" → 말한 취향만`, [{ order: sw[0]!.name }, { order: sw[0]!.name }, { say: `평소에 ${w} 억수로 좋아한다` }, { check: { has: k, noItem: '자주 고른 메뉴' } }], true, true);
  // 오늘 상태 + 다음 날
  for (const t of ['오늘 진짜 녹초다', '오늘 컨디션 꽝이다', '아 피곤해 디지겠다']) add(`"${t}" → 오늘만`, [{ say: t }, { check: { tired: true } }, { check: { tired: false }, at: NEXT_DAY }]);
  // 수다 속 싫어함
  for (const [k, w] of W.slice(0, 6)) add(`수다 속 싫어함: "친구가 그러는데 나는 원래 ${w} 별로거든"`, [{ say: `친구가 맛있다고 하는데 나는 원래 ${w} 별로거든` }, { check: { lacks: k } }]);
  void sw;
  return out;
}
