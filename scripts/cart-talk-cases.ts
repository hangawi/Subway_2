// 장바구니 말 100문장 (10/26) — cart-talk-check.ts(화면)와 ai-command-eval.ts(AI 비교)가 같이 씀
const COND = ['든든한 거', '가벼운 거', '매운 거', '안 매운 거', '해장할 거', '단백질 많은 거', '닭고기 들어간 거', '소고기 들어간 거', '샐러드'];
const MENU = ['로스트 치킨', '이탈리안 비엠티', '에그마요', '참치', '스테이크 & 치즈', '쉬림프', '써브웨이 클럽'];
const QTY = [['하나', 1], ['한 개', 1], ['한개', 1], ['두 개', 2], ['둘', 2], ['세 개', 3]] as const;
const pick = <T,>(xs: readonly T[], i: number) => xs[i % xs.length]!;
export type CartCase = { text: string; lines: number; qty?: number; single?: boolean; /** 이렇게 알아들어도 맞음 */ alt?: number };
export const CART_CASES: CartCase[] = [];
// 1) 조건 A 하나 B 하나 (C 하나)
for (let i = 0; i < 15; i++) {
  const a = pick(COND, i), b = pick(COND, i + 2), c = pick(COND, i + 4);
  const q1 = pick(QTY, i), q2 = pick(QTY, i + 1);
  CART_CASES.push(i % 3 === 0 ? { text: `${a} ${q1[0]} ${b} ${q2[0]} ${c} 하나`, lines: 3 } : { text: `${a} ${q1[0]}${i % 2 ? '랑' : ''} ${b} ${q2[0]}`, lines: 2 });
}
// 2) "A랑 B 하나씩"
for (let i = 0; i < 8; i++) CART_CASES.push({ text: `${pick(COND, i)}${i % 2 ? '이랑' : '랑'} ${pick(COND, i + 3)} ${i % 3 ? '하나씩' : '한 개씩'}`, lines: 2 });
// 3) "하나는 A, 하나는 B"
for (let i = 0; i < 10; i++) CART_CASES.push({ text: `하나는 ${pick(COND, i)}${i % 2 ? ',' : ''} 하나는 ${pick(COND, i + 5)}`, lines: 2 });
// 4) 메뉴 목록·메뉴 하나씩
for (let i = 0; i < 12; i++) {
  const a = pick(MENU, i), b = pick(MENU, i + 1), c = pick(MENU, i + 3);
  CART_CASES.push(i % 3 === 0 ? { text: `${a}, ${b}, ${c}`, lines: 3 } : i % 3 === 1 ? { text: `${a} 하나랑 ${b} 하나`, lines: 2 } : { text: `${a}이랑 ${b}`, lines: 2 });
}
// 5) 같은 메뉴 개수 → 한 줄
for (let i = 0; i < 10; i++) CART_CASES.push({ text: `${pick(MENU, i)} ${pick(['2개', '두 개', '세 개', '3개', '4개'], i)}`, lines: 1, qty: [2, 2, 3, 3, 4][i % 5]! });
// 6) 이거 하나 저거 하나 (③ 1·2번)
for (const t of ['이거 하나 저거 하나', '이거 하나랑 저거 하나', '요거 하나 그거 하나', '이거 한 개 저거 한 개', '이거 둘 저거 하나']) CART_CASES.push({ text: t, lines: 2 });
// 7) 사람
for (const [t, n] of [['나는 두 개 민수는 하나', 2], ['저는 하나 지은이는 하나', 2], ['3명이야', 3], ['우리 네 명이서 먹을 거야', 4], ['3명이야, 민수는 매운 거 못 먹고 지은이는 새우 알레르기', 3], ['민수는 매운 거 못 먹고 지은이는 새우 알레르기', 2], ['두 명이야', 2], ['나는 가벼운 거 하나 민수는 든든한 거 하나', 2], ['5명이야', 5], ['민수는 가벼운 거 하나 지은이는 매운 거 하나', 2]] as const) CART_CASES.push({ text: t, lines: n, ...(/^민수는/.test(t) ? { alt: 3 } : {}) });
// 7-2) 규칙에 없는 말투 (AI → 화면 규칙)
for (const [t, n] of [['배고픈 사람 거 하나랑 다이어트 중인 사람 거 하나 줘', 2], ['하나는 든든하게 하나는 가볍게', 2], ['든든한 걸로 두 개 가벼운 걸로 하나', 2], ['매운 거 두 개랑 안 매운 거 하나', 2], ['로스트 치킨이랑 에그마요 하나씩', 2], ['에그마요 하나 참치 하나 쉬림프 하나', 3], ['해장할 거 하나 단백질 많은 거 하나', 2], ['소고기 들어간 거 하나 닭고기 들어간 거 하나', 2], ['이거 두 개', 1], ['샐러드 하나 샌드위치 하나', 2]] as const) CART_CASES.push({ text: t, lines: n });
// 8) 한 사람 말 (나누면 안 됨): 1줄
for (const t of [
  '로스트 치킨 하나', '로스트 치킨 하나 주세요', '이탈리안 비엠티 양파 빼고 하나', '에그마요 하나만', '로스트 치킨에 콜라랑 초코칩 쿠키',
  '로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기', '참치 양파 오이 빼주세요 소스는 마요네즈랑 스위트어니언', '치킨 데리야끼, 매콤하게 추천해줘', '로스트 치킨 하나랑 콜라 하나', '나는 매운 거 좋아해',
  '든든한 거 추천해줘', '가볍고 싼 거', '매운 걸로 하나', '스테이크 & 치즈 하나 토마토 빼고', '로스트 치킨이랑 이탈리안 비엠티 중에 뭐가 나아',
  '오늘 점심 뭐 먹지', '쉬림프 하나 콜라는 제로로', '샐러드 하나', '에그마요 30센치 하나', '로스트 치킨 하나 쿠키 세트로',
]) CART_CASES.push({ text: t, lines: 1, single: true });
