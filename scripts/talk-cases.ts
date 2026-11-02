// 말로 주문하기 정답 표 (10/19, 로드맵 7.6-2) — scripts/talk-check.ts(실제 주소)와 tests/conversation/talk-90.spec.ts(규칙만)가 같이 씀
export type Want = Partial<{
  place: string | null; menu: string | null; goal: string | null; budget: number | null; spicy: 'want' | 'avoid' | null;
  allergies: string[]; mains: string[]; kinds: string[]; remove: string[]; add: string[]; sauces: string[]; noSauce: boolean;
  set: string | null; drink: string | null; extras: string[];
  /** 10/20: 메뉴 빼기("돼지고기 빼고"), 짜게/싱겁게, 취향("쇠고기:1:LASTING"), 오늘 상태 */
  avoid: string[]; salty: 'MORE' | 'LESS'; taste: string[]; mood: string; size: string; cheese: string | null; bread: string; toasted: boolean; ask: string; question: boolean; refuse: string;
  /** 10/20 2차: 세트에서 고른 것, 막연한 말("뭐 먹지?")을 추천 요청으로 알아들음, 빼면 안 되는 야채(말 고치기) */
  setItem: string; vague: boolean; notRemove: string[];
  /** 10/21 3차: 나트륨 상한 ("너무 짜지 않은 걸로" → 700) */
  sodium: number;
  /** 10/21 4차: 말한 끼니, ③에서 "2번으로 할게" */
  meal: string; pickRank: number;
}>;
// [문장, 기대값] — 기대값에 적은 것만 본다 (적지 않은 칸은 상관없음)
export const CASES: Array<[string, Want]> = [
  ['나 지금 배고픔 매운거 넣고 콜라는 제로콜라로 먹고 싶어 그리고 쇠고기 종류로 먹고싶은데 추천해줘바', { goal: 'FILLING', spicy: 'want', mains: ['쇠고기'], extras: ['코카콜라 제로 (355ml)'] }], // 10/19: 음료는 단품
  ['강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기', { place: '강남역', menu: '로스트 치킨', remove: ['양파'], add: ['피클'], allergies: ['우유'] }],
  ['만 삼천원 이하 매운거 넣어서', { budget: 13000, spicy: 'want' }],
  ['만원 이하로 단백질 많은거', { budget: 10000, goal: 'PROTEIN' }],
  ['칠천원 안쪽으로 가볍게 먹고싶어', { budget: 7000, goal: 'LIGHT' }],
  ['이탈리안 비엠티 30센치 허니오트로 해주고 치즈는 모짜렐라', { menu: '이탈리안 비엠티', size: '30cm', bread: '허니오트', cheese: '모차렐라 치즈' }],
  ['스테이크앤치즈 할라피뇨 많이 넣고 핫칠리 소스', { menu: '스테이크 & 치즈', add: ['할라피뇨'], sauces: ['핫 칠리'] }],
  ['에그마요 토스팅 하지마', { menu: '에그마요', toasted: false }],
  ['참치 양파 오이 빼주세요 소스는 마요네즈랑 스위트어니언', { menu: '참치', remove: ['양파', '오이'], sauces: ['마요네즈', '스위트 어니언'] }],
  ['쉬림프 쿠키세트로 음료는 사이다', { menu: '쉬림프', set: '쿠키 음료 세트', drink: '사이다' }],
  ['샐러드로 아무거나 땅콩 알레르기 있어', { kinds: ['SALAD'], allergies: ['땅콩'] }],
  ['새우 못먹어 매운것도 못먹고', { allergies: ['새우'], spicy: 'avoid' }],
  ['홍대입구역 근처 써브웨이에서 든든한거', { place: '홍대입구역', goal: 'FILLING' }],
  ['판교역에서 닭고기 들어간 거', { place: '판교역', mains: ['닭고기'] }],
  ['로티세리바베큐치킨 웨지세트 콜라', { menu: '로티세리 바비큐 치킨', set: '웨지 음료 세트', drink: '콜라' }],
  ['풀드포크 소스빼줘', { menu: '풀드포크 바비큐', noSauce: true }],
  ['비엠티 치즈 빼고', { menu: '이탈리안 비엠티', cheese: null }],
  ['오늘 너무 피곤한데 든든한거 추천해줘', { goal: 'FILLING' }],
  ['지난번처럼 해줘', { ask: 'LAST' }],
  ['저번거에서 소스만 랜치로', { ask: 'LAST', sauces: ['랜치'] }],
  ['1번이랑 2번 뭐가 달라', { ask: 'COMPARE' }],
  ['왜 이거 추천했어', { ask: 'WHY' }],
  ['매운거', { question: true }],
  ['배달해줘', { refuse: '배달' }],
  ['써브웨이 클럽 15센치 위트빵 아메리칸치즈 토마토 많이', { menu: '써브웨이 클럽', size: '15cm', bread: '위트', cheese: '아메리칸 치즈', add: ['토마토'] }],
  ['치킨 데리야끼 양상추 빼고 올리브 추가 스모크바베큐', { menu: '치킨 데리야끼', remove: ['양상추'], add: ['올리브'], sauces: ['스모크 바비큐'] }],
  ['안창비프 머쉬룸 플랫브레드', { menu: '안창 비프&머쉬룸', bread: '플랫브레드' }],
  ['베지 샌드위치 우유 계란 알레르기', { menu: '베지', allergies: ['우유', '난류'] }],
  ['아침메뉴 뭐있어', { kinds: ['MORNING_SANDWICH', 'MORNING_WRAP'] }],
  ['랩으로 먹을래 매운거 빼고', { kinds: ['WRAP'], spicy: 'avoid' }],
  ['살 안찌는거 오백칼로리 이하', { goal: 'LIGHT' }],
  ['잠실역 쪽 만오천원 이하 소고기', { place: '잠실역', budget: 15000, mains: ['쇠고기'] }],
  ['에그마요 베이컨 추가해줘', { menu: '에그마요' }],
  ['스파이시 이탈리안 칩세트', { menu: '스파이시 이탈리안', set: '칩 음료 세트' }],
  ['스테이크 앤 치즈 아보카도 랩', { menu: '스테이크 & 치즈 아보카도 랩' }],
  ['쉬림프 에그마요 랩 하나', { menu: '쉬림프 에그마요 랩' }],
  ['로스트치킨 할라피뇨 빼고 홀스래디쉬', { menu: '로스트 치킨', remove: ['할라피뇨'], sauces: ['홀스래디쉬'] }],
  ['치킨베이컨아보카도 30cm 화이트빵', { menu: '치킨 베이컨 아보카도', size: '30cm', bread: '화이트' }],
  ['잠봉 피클 빼고 머스타드', { menu: '잠봉', remove: ['피클'], sauces: ['허니 머스터드'] }],
  ['오늘은 소고기 피할래 가벼운거', { goal: 'LIGHT' }],
  ['평소에 닭고기 좋아해', {}],
  ['수프세트로 바꿔줘 커피로', { set: '수프 음료 세트', drink: '커피' }],
  ['음료는 제로사이다', { menu: 'singles', extras: ['스프라이트 제로 (355ml)'] }], // 10/20: 음료만 말함 → 단품 ("음료"를 사이드 종류로 읽던 것 고침)
  ['돼지고기 빼고 다 괜찮아', {}],
  ['배고파 죽겠어 아무거나 빨리', { goal: 'FILLING' }],
  ['역삼역 써브웨이 에그마요 30', { place: '역삼역', menu: '에그마요', size: '30cm' }],
  ['피망 양파 올리브 빼', { remove: ['피망(파프리카)', '양파', '올리브'] }],
  ['토마토 알레르기 있는데 샌드위치 먹고싶어', { allergies: ['토마토'], kinds: ['SANDWICH'] }],
  ['참치로 할게 근데 세트는 말고 단품', { menu: '참치', set: null }],
  ['샐러드 말고 샌드위치', { kinds: ['SANDWICH'] }],
  // ── 2차 (10/19): 더 어려운 말투 ──
  ['아 배고프다 매콤한거 땡기는데 만오천원 안으로 뭐 없나', { spicy: 'want', budget: 15000 }],
  ['쉬림프로 할건데 양파랑 피망은 빼고 올리브 많이 소스는 스위트칠리랑 랜치', { menu: '쉬림프', remove: ['양파', '피망(파프리카)'], add: ['올리브'], sauces: ['스위트 칠리', '랜치'] }],
  ['스테이크치즈 삼십센치 화이트로 구워주고 할라피뇨 듬뿍', { menu: '스테이크 & 치즈', size: '30cm', bread: '화이트', add: ['할라피뇨'] }],
  ['이탈리안비엠티 노양파 노피클', { menu: '이탈리안 비엠티', remove: ['양파', '피클'] }],
  ['에그마요 빵은 허니오트 치즈 슈레드', { menu: '에그마요', bread: '허니오트', cheese: '슈레드 치즈' }],
  ['로티세리 치킨 샐러드 드레싱은 오리엔탈', { question: true }], // 더블치즈·타코 중 묻기
  ['신논현역에서 먹을건데 우유 땅콩 알레르기 있어 단백질 많은걸로', { place: '신논현역', allergies: ['우유', '땅콩'], goal: 'PROTEIN' }],
  ['칼로리 낮은거 400 이하로', { goal: 'LIGHT' }],
  ['나트륨 적은거', {}],
  ['애들이 먹을거라 안매운걸로', { spicy: 'avoid' }],
  ['치킨 종류 말고 돼지고기 들어간거', { mains: ['돼지고기'] }],
  ['고기 안들어간거', {}],
  ['베지로 하고 치즈 빼고 소스 빼줘', { menu: '베지', cheese: null, noSauce: true }],
  ['써브웨이클럽 쿠키세트 초코칩 콜라', { menu: '써브웨이 클럽', set: '쿠키 음료 세트', drink: '콜라' }],
  ['풀드포크 웨지세트 제로콜라로', { menu: '풀드포크 바비큐', set: '웨지 음료 세트', drink: '제로콜라' }],
  ['참치 샌드위치 하나랑 콘수프 세트', { menu: '참치', set: '수프 음료 세트' }],
  ['치킨데리야끼 토스팅 빼고 양상추 많이', { menu: '치킨 데리야끼', toasted: false, add: ['양상추'] }],
  ['스파이시쉬림프 매운거 더', { menu: '스파이시 쉬림프' }],
  ['로스트치킨 머스타드 소스로', { menu: '로스트 치킨', sauces: ['허니 머스터드'] }],
  ['안창 비프 15cm 파마산오레가노', { menu: '안창 비프', size: '15cm', bread: '파마산 오레가노' }],
  ['피자썹 하나요', { menu: '피자썹' }],
  ['잠봉 플러스 30', { menu: '잠봉 플러스', size: '30cm' }],
  ['머쉬룸 샌드위치 플랫브레드에 치즈 모짜', { menu: '머쉬룸', bread: '플랫브레드', cheese: '모차렐라 치즈' }],
  ['오늘 점심 뭐먹지 든든한걸로 골라줘', { goal: 'FILLING' }],
  ['다이어트중이야', { goal: 'LIGHT' }],
  ['운동하고 와서 단백질 땡김', { goal: 'PROTEIN' }],
  ['저녁이라 가볍게 샐러드로', { goal: 'LIGHT', kinds: ['SALAD'] }],
  ['아침메뉴로 에그 들어간거', { kinds: ['MORNING_SANDWICH', 'MORNING_WRAP'] }],
  ['아까 그거 30으로 바꿔줘', { size: '30cm' }],
  ['소스 바꿀래', { question: true }],
  ['빵 뭐있어', { question: true }],
  ['결제해줘', { refuse: '결제' }],
  ['쉬림프 에그마요랩 매운거 빼고', { menu: '쉬림프 에그마요 랩', spicy: 'avoid' }],
  ['강남역 근처에서 쇠고기 매운거', { place: '강남역', mains: ['쇠고기'], question: true }], // 10/16 정답 표: "매운 거"만은 되묻기
  ['서울역에서 만원으로 먹을수있는거', { place: '서울역', budget: 10000 }],
  ['게 알레르기 있고 새우도 안돼', { allergies: ['게', '새우'] }],
  ['소고기는 별로고 닭고기로', { mains: ['닭고기'] }],
  ['토마토 빼고 오이 빼고 양파 빼고', { remove: ['토마토', '오이', '양파'] }],
  ['할라피뇨 넣지마', { remove: ['할라피뇨'] }],
  ['피클 두배로', { add: ['피클'] }],
  // ── 3차 (10/19): 단품·세트·없는 음식 ──
  ['콜라만 줘', { menu: 'singles', extras: ['코카콜라 (355ml)'] }],
  ['제로콜라 두개', { menu: 'singles', extras: ['코카콜라 제로 (355ml)'] }],
  ['콜라랑 쿠키만', { menu: 'singles', extras: ['코카콜라 (355ml)'], question: true }],
  ['물 하나랑 웨지감자', { menu: 'singles', extras: ['생수', '웨지 포테이토'] }],
  ['아아 한잔', { menu: 'singles', extras: ['아이스 아메리카노'] }],
  ['콜라 사이다 하나씩', { menu: 'singles', extras: ['코카콜라 (355ml)', '스프라이트 (355ml)'] }],
  ['라떼 하나랑 쿠키 3개', { menu: 'singles', extras: ['바리스타룰스 저당 라떼(350ml)', '쿠키 3개'] }],
  ['로스트 치킨에 콜라', { menu: '로스트 치킨', extras: ['코카콜라 (355ml)'] }],
  ['로스트 치킨에 콜라랑 초코칩 쿠키', { menu: '로스트 치킨', set: '쿠키 음료 세트', drink: '콜라' }],
  ['에그마요에 웨지 세트 콜라', { menu: '에그마요', set: '웨지 음료 세트', drink: '콜라' }],
  ['제로콜라에다가 치킨을 넣어서 맵게해줘', { spicy: 'want', mains: ['닭고기'], extras: ['코카콜라 제로 (355ml)'] }],
  ['콜라는 제로콜라로', { menu: 'singles', extras: ['코카콜라 제로 (355ml)'] }],
  ['생선회에 맵게 해줘', { spicy: 'want', mains: ['새우', '참치'], refuse: '생선회는 써브웨이 메뉴에 없어요' }],
  ['회 먹고싶어', { mains: ['새우', '참치'], refuse: '회는 써브웨이 메뉴에 없어요' }],
  ['짜장면 줘', { refuse: '짜장면은 써브웨이 메뉴에 없어요' }],
  ['햄버거 먹고싶어', { mains: ['쇠고기'], refuse: '햄버거는 써브웨이 메뉴에 없어요' }],
  ['환타 있어?', { refuse: '환타는 써브웨이에 없어요' }],
  ['쿠키 하나', { question: true }],
  ['수프 하나', { question: true }],
  ['스테이크 앤 치즈 맵게', { menu: '스테이크 & 치즈', spicy: 'want' }],
  // 10/21 예형님 화면에서: 소스를 이름 없이 개수만 → 묻기 (전엔 조용히 버림)
  ['소고기 메뉴로 소스 3개 다 넣어주고 추가로 에그마요도 넣어줘', { mains: ['쇠고기'], question: true }],
  // 10/21 예형님: 묶음 말 (어류처럼)
  ['어류가 들어간 음식 추천해줘', { mains: ['새우', '참치'] }],
  ['육류 들어간 거 추천해줘', { mains: ['쇠고기', '닭고기', '돼지고기'] }],
  ['고기 없는 거', { avoid: ['쇠고기', '닭고기', '돼지고기'] }],
  ['붉은 고기로', { mains: ['쇠고기'] }],
  ['가금류로', { mains: ['닭고기'] }],
  ['베이컨 들어간 거', { mains: ['돼지고기'] }],
  ['갑각류 들어간 거', { mains: ['새우'] }],
  ['채식주의자야', { mains: ['야채'], avoid: ['쇠고기', '닭고기', '돼지고기'] }],
  ['탄수화물 적은 거', { kinds: ['SALAD'] }],
  ['생선 알레르기 있어', { allergies: ['고등어'], avoid: ['참치'] }],
  // 10/22 예형님 말투 (실제로 쓰신 말 + 같은 말투: 오타·"추천해바"·끼니·순번)
  ['나 지금 배고프고 돼직고기로 먹고시퍼 맵게 해주고 제로콜라에다가 스프 야무진거 하나 추가해주고 나 고등어알레르기 있어', { goal: 'FILLING', mains: ['돼지고기'], spicy: 'want', allergies: ['고등어'] }],
  ['좀있다가 점심을먹을거니까 점심추천해줘', { meal: 'LUNCH' }],
  ['소고기들어간걸로 가볍게 추천해줘', { mains: ['쇠고기'], goal: 'LIGHT' }],
  ['아나 뭐 먹을까?', { vague: true }],
  ['오늘 뭐먹을지 추턴해줘', { vague: true }],
  ['어류가 들어간 음식을 추천해줘바', { mains: ['새우', '참치'] }],
  ['2번으로 할게', { pickRank: 2 }],
  ['저녁에 먹을건데 든든한거 추천해바', { meal: 'DINNER', goal: 'FILLING' }],
  ['야식으로 가볍게 먹고싶어', { meal: 'LATE_NIGHT', goal: 'LIGHT' }],
  ['닭고기로 매운거 말고 추천해줘바', { mains: ['닭고기'], spicy: 'avoid' }],
  ['소고기 들어간거 만원 이하로 해줘', { mains: ['쇠고기'], budget: 10000 }],
  ['우유 알레르기 있는데 치즈 들어간거 빼줘', { allergies: ['우유'] }],
  ['콜라 하나만 줘', { menu: 'singles', extras: ['코카콜라 (355ml)'] }],
  ['돼지고기는 빼고 추천해줘', { avoid: ['돼지고기'] }],
  ['새우 들어간거 먹고싶어', { mains: ['새우'] }],
  ['배고파 죽겠어 든든한거', { goal: 'FILLING' }],
  ['살빼는중이라 가벼운걸로', { goal: 'LIGHT' }],
  ['단백질 많은걸로 추천해바', { goal: 'PROTEIN' }],
  ['강변역에서 먹을건데 매운거', { place: '강변역', question: true }],
  ['첫번째꺼로 할게', { pickRank: 1 }],
  ['점심으로 소고기 들어간거 맵게', { meal: 'LUNCH', mains: ['쇠고기'], spicy: 'want' }],
  ['에그마요 양파빼고 소스는 랜치로 해줘', { menu: '에그마요', remove: ['양파'], sauces: ['랜치'] }],
  ['이탈리안비엠티 쿠키세트로 음료는 제로콜라', { menu: '이탈리안 비엠티', set: '쿠키 음료 세트' }],
  ['너무 짜지않은걸로 추천해줘', { sodium: 700 }],
  ['채소 위주로 먹고싶어', { mains: ['야채'] }],
  // 10/26 해장 (예형님 결정: 오늘의 수프 세트 + 기름기·나트륨 덜한 쪽)
  ['해장할 거', { salty: 'LESS', set: '수프 음료 세트' }],
  ['어제 술 마셔서 해장하고 싶어', { salty: 'LESS', set: '수프 음료 세트' }],
  ['로스트 치킨으로 해장', { menu: '로스트 치킨', salty: 'LESS', set: '수프 음료 세트' }],
  // 10/26 주소로 말한 장소 (번지까지 한 장소로)
  ['압구정동에서 먹을래', { place: '압구정동' }],
  ['역삼동 737 근처 매운 거', { place: '역삼동 737' }],
  ['테헤란로 152에서 가볍게', { place: '테헤란로 152', goal: 'LIGHT' }],
  ['서울 강남구 테헤란로 152에서 로스트 치킨', { place: '서울 강남구 테헤란로 152', menu: '로스트 치킨' }],
];
/** 해석 결과(서버 /api/interpret 모양)를 기대값과 대조 — 틀린 것 목록 (빈 목록 = 통과) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function judge(text: string, want: Want, r: any, ch: any, nameOf: (id: string | null) => string | null, ing: (id: string) => string): string[] {
  const got: Record<string, unknown> = {
    place: r.place ?? null, menu: nameOf(r.menuId ?? null), goal: r.prefs?.goal ?? null, budget: r.prefs?.budgetKrw ?? null,
    spicy: r.prefs?.wantSpicy ? 'want' : r.prefs?.avoidSpicy ? 'avoid' : null,
    allergies: r.prefs?.allergies ?? [], mains: r.prefs?.wantMains ?? [], kinds: r.prefs?.kinds ?? [],
    avoid: r.prefs?.avoidMains ?? [], salty: r.prefs?.salty ?? null, taste: (r.tastes ?? []).map((t: { main: string; sign: number; scope: string }) => `${t.main}:${t.sign}:${t.scope}`), mood: r.mood ?? null,
    remove: [...(ch.removeVegetables ?? []), ...(r.prefs?.removeVegetables ?? [])].map(ing), add: (ch.addVegetables ?? []).map(ing),
    sauces: (ch.sauces ?? []).map(ing), noSauce: Array.isArray(ch.sauces) && ch.sauces.length === 0,
    set: ch.set === undefined ? undefined : ch.set, drink: ch.drink ?? null, extras: (ch.extras ?? []).map((e: { id: string }) => ing(e.id)), size: ch.size ?? '15cm', cheese: ch.cheese === undefined ? undefined : ch.cheese === null ? null : ing(ch.cheese),
    bread: ch.bread ? ing(ch.bread) : undefined, toasted: ch.toasted, ask: r.ask ?? undefined, question: !!r.question,
    refuse: (r.refusals ?? []).join(' '),
    setItem: ch.setItem ?? null, vague: !!r.vague, sodium: r.prefs?.maxSodiumMg ?? null, meal: r.prefs?.meal ?? null, pickRank: r.pickRank ?? null,
  };
  const bad: string[] = [];
  for (const [k, v] of Object.entries(want)) {
    if (k === 'notRemove') {
      const hit = (v as string[]).filter((x) => (got.remove as string[]).includes(x));
      if (hit.length) bad.push(`빼면 안 되는 야채를 뺌 ${JSON.stringify(hit)}`);
      continue;
    }
    const g = got[k];
    const ok = Array.isArray(v) ? v.every((x) => (g as string[]).includes(x)) : k === 'refuse' ? String(g).includes(String(v)) : g === v;
    if (!ok) bad.push(`${k}: 기대 ${JSON.stringify(v)} / 실제 ${JSON.stringify(g)}`);
  }
  // 엉뚱하게 더한 것 (말하지 않은 알레르기·메뉴)
  if (!want.allergies && (got.allergies as string[]).length) bad.push(`말 안 한 알레르기 ${JSON.stringify(got.allergies)}`);
  if (want.menu === undefined && got.menu && !/메뉴|이걸로/.test(text)) bad.push(`말 안 한 메뉴 ${got.menu}`);
  return bad;
}
/** 화면과 같게: 메뉴를 안 말했으면 1위 메뉴(여기서는 로스트 치킨)에 같은 말을 다시 적용하는지 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const needsSecondPass = (r: any) => !r.menuId && (r.understood ?? []).length > 0 && (!r.ask || r.ask === 'LAST');
