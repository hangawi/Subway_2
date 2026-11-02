// 써브웨이 말 별칭 → 공식 카탈로그 id. 줄임말·띄어쓰기·영어를 같은 재료로.
// (예전 reference/old-subway/subway-order-aliases.ts 를 지금 공식 데이터 id로 다시 씀)
import type { SubwayCatalog } from '../catalog/subway-catalog.ts';

export const BREAD_ALIASES: Record<string, string> = {
  위트: 'bread:위트', 휘트: 'bread:위트', wheat: 'bread:위트',
  화이트: 'bread:화이트', white: 'bread:화이트',
  허니오트: 'bread:허니오트', 허오: 'bread:허니오트', 허니: 'bread:허니오트', 오트: 'bread:허니오트',
  파마산오레가노: 'bread:파마산 오레가노', 파마산: 'bread:파마산 오레가노', 파오: 'bread:파마산 오레가노', 오레가노: 'bread:파마산 오레가노',
  그레인: 'bread:그레인', 멀티그레인: 'bread:그레인',
  플랫브레드: 'bread:플랫브레드', 플랫: 'bread:플랫브레드',
};

export const CHEESE_ALIASES: Record<string, string> = {
  아메리칸: 'cheese:아메리칸 치즈', 아메리칸치즈: 'cheese:아메리칸 치즈',
  슈레드: 'cheese:슈레드 치즈', 슈레드치즈: 'cheese:슈레드 치즈',
  모차렐라: 'cheese:모차렐라 치즈', 모짜렐라: 'cheese:모차렐라 치즈', 모짜: 'cheese:모차렐라 치즈', 모차: 'cheese:모차렐라 치즈', 모차렐라치즈: 'cheese:모차렐라 치즈', 모짜렐라치즈: 'cheese:모차렐라 치즈',
};

export const VEGETABLE_ALIASES: Record<string, string> = {
  양상추: 'vegetable:양상추', 상추: 'vegetable:양상추', 레터스: 'vegetable:양상추',
  토마토: 'vegetable:토마토',
  오이: 'vegetable:오이',
  피망: 'vegetable:피망(파프리카)', 파프리카: 'vegetable:피망(파프리카)',
  양파: 'vegetable:양파',
  피클: 'vegetable:피클',
  올리브: 'vegetable:올리브',
  할라피뇨: 'vegetable:할라피뇨', 할라: 'vegetable:할라피뇨',
  아보카도: 'vegetable:아보카도',
};

export const SAUCE_ALIASES: Record<string, string> = {
  랜치: 'sauce:랜치', 렌치: 'sauce:랜치',
  스위트어니언: 'sauce:스위트 어니언', 스윗어니언: 'sauce:스위트 어니언', 스윗어니언소스: 'sauce:스위트 어니언', 어니언: 'sauce:스위트 어니언',
  마요네즈: 'sauce:마요네즈', 마요: 'sauce:마요네즈',
  스위트칠리: 'sauce:스위트 칠리', 스윗칠리: 'sauce:스위트 칠리',
  스모크바비큐: 'sauce:스모크 바비큐', 바비큐소스: 'sauce:스모크 바비큐', 비비큐소스: 'sauce:스모크 바비큐',
  핫칠리: 'sauce:핫 칠리',
  허니머스터드: 'sauce:허니 머스터드', 허니머스타드: 'sauce:허니 머스터드', 머스터드: 'sauce:허니 머스터드', 머스타드: 'sauce:허니 머스터드',
  사우스웨스트치폴레: 'sauce:사우스웨스트 치폴레', 치폴레: 'sauce:사우스웨스트 치폴레', 사우스웨스트: 'sauce:사우스웨스트 치폴레',
  홀스래디쉬: 'sauce:홀스래디쉬', 홀스래디시: 'sauce:홀스래디쉬',
  저당크리미어니언: 'sauce:저당 크리미 어니언', 크리미어니언: 'sauce:저당 크리미 어니언',
  저칼로리오리엔탈: 'sauce:저칼로리 오리엔탈', 오리엔탈: 'sauce:저칼로리 오리엔탈',
  올리브오일: 'sauce:엑스트라 버진 올리브 오일', 엑스트라버진올리브오일: 'sauce:엑스트라 버진 올리브 오일',
  레드와인식초: 'sauce:레드 와인 식초', 와인식초: 'sauce:레드 와인 식초',
  소금: 'sauce:소금', 후추: 'sauce:후추',
};

/** 추가 토핑 이름 (종류별 id는 메뉴 종류로 고른다) */
export const TOPPING_ALIASES: Record<string, string> = {
  미트추가: '미트 추가', 고기추가: '미트 추가', 미트: '미트 추가',
  에그마요추가: '에그마요', 에그마요: '에그마요', 오믈렛: '오믈렛', 아보카도추가: '아보카도', 아보카도: '아보카도', 베이컨: '베이컨', 베이컨비츠: '베이컨 비츠',
  페퍼로니: '페퍼로니', 치즈추가: '치즈 추가', 치즈많이: '치즈 추가', 치즈듬뿍: '치즈 추가', 치즈더: '치즈 추가', 에그슬라이스: '에그 슬라이스', 계란추가: '에그 슬라이스', 그레인믹스: '그레인 믹스',
};

export const MENU_ALIASES: Record<string, string> = {
  로티: '로티세리 바비큐 치킨', 로티세리: '로티세리 바비큐 치킨', 로티세리치킨: '로티세리 바비큐 치킨',
  비엠티: '이탈리안 비엠티', bmt: '이탈리안 비엠티', 이탈리안bmt: '이탈리안 비엠티',
  스테치: '스테이크 & 치즈', 스테이크치즈: '스테이크 & 치즈', 스테이크앤치즈: '스테이크 & 치즈',
  에그마요: '에그마요', 에마: '에그마요',
  쉬림프: '쉬림프', 새우: '쉬림프',
  참치: '참치', 튜나: '참치',
  치데: '치킨 데리야끼', 데리야끼: '치킨 데리야끼',
  클럽: '써브웨이 클럽', 써브웨이클럽: '써브웨이 클럽',
  풀드포크: '풀드포크 바비큐',
  비엘티: '비엘티', blt: '비엘티',
  베지: '베지', 야채샌드위치: '베지',
  잠봉: '잠봉',
  피자: '피자썹', 피자썹: '피자썹',
  // 10/20 2차: 줄임말·영어 이름
  치베아: '치킨 베이컨 아보카도', 치킨데리야끼: '치킨 데리야끼', 데리야끼치킨: '치킨 데리야끼', 참치샌드위치: '참치', 쉬림프샌드위치: '쉬림프', 베지샌드위치: '베지',
  steakandcheese: '스테이크 & 치즈', 'steak&cheese': '스테이크 & 치즈', eggmayo: '에그마요', tuna: '참치', italianbmt: '이탈리안 비엠티', shrimp: '쉬림프', veggie: '베지',
  chickenteriyaki: '치킨 데리야끼', subwayclub: '써브웨이 클럽', roastchicken: '로스트 치킨', pulledpork: '풀드포크 바비큐',
};

/** 알레르기 말 → 공식 19종 */
export const ALLERGY_ALIASES: Record<string, string[]> = {
  계란: ['난류'], 달걀: ['난류'], 난류: ['난류'], 에그: ['난류'],
  우유: ['우유'], 유제품: ['우유'],
  메밀: ['메밀'], 땅콩: ['땅콩'], 대두: ['대두'], 콩: ['대두'], 밀: ['밀'], 글루텐: ['밀'], 밀가루: ['밀'],
  고등어: ['고등어'], 게: ['게'], 새우: ['새우'], 갑각류: ['게', '새우'],
  돼지고기: ['돼지고기'], 돼지: ['돼지고기'], 복숭아: ['복숭아'], 토마토: ['토마토'], 아황산류: ['아황산류'], 아황산: ['아황산류'],
  호두: ['호두'], 견과류: ['호두', '땅콩', '잣'], 닭고기: ['닭고기'], 닭: ['닭고기'], 쇠고기: ['쇠고기'], 소고기: ['쇠고기'],
  오징어: ['오징어'], 조개류: ['조개류'], 조개: ['조개류'], 잣: ['잣'],
  // 10/21 예형님: 공식 19종에서 생선은 고등어뿐 — "생선·어류 알레르기"는 고등어로 (참치 메뉴는 rules가 따로 뺌)
  생선: ['고등어'], 어류: ['고등어'], 물고기: ['고등어'], 해산물: ['고등어', '새우', '게', '조개류', '오징어'], 해물: ['고등어', '새우', '게', '조개류', '오징어'],
};

/** 공백·대소문자 무시한 비교용 */
export const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 카탈로그 이름 자체도 별칭으로 (예: "스위트 어니언", "로스트 치킨 아보카도") */
export function nameIndex(catalog: SubwayCatalog) {
  const byCat = (cat: string) => Object.fromEntries(catalog.ingredients.filter((i) => i.category === cat).map((i) => [squash(i.name), i.id]));
  return {
    bread: { ...byCat('BREAD'), ...Object.fromEntries(Object.entries(BREAD_ALIASES).map(([k, v]) => [squash(k), v])) },
    cheese: { ...byCat('CHEESE'), ...Object.fromEntries(Object.entries(CHEESE_ALIASES).map(([k, v]) => [squash(k), v])) },
    vegetable: { ...byCat('VEGETABLE'), ...Object.fromEntries(Object.entries(VEGETABLE_ALIASES).map(([k, v]) => [squash(k), v])) },
    sauce: { ...byCat('SAUCE'), ...Object.fromEntries(Object.entries(SAUCE_ALIASES).map(([k, v]) => [squash(k), v])) },
    menu: {
      // "&"가 든 이름은 "&" 없이·"앤"·"엔"·"and"로 말해도 (10/19: "안창비프 머쉬룸", "스테이크 앤 치즈 아보카도 랩"을 못 찾던 것)
      ...Object.fromEntries(catalog.menus.flatMap((m) => {
        const k = squash(m.name);
        return [...new Set([k, k.replace(/&/g, ''), k.replace(/&/g, '앤'), k.replace(/&/g, '엔'), k.replace(/&/g, 'and')])].map((x) => [x, m.id]);
      })),
      ...Object.fromEntries(Object.entries(MENU_ALIASES).flatMap(([k, n]) => {
        const m = catalog.menus.find((x) => x.name === n);
        return m ? [[squash(k), m.id]] : [];
      })),
    },
  };
}
