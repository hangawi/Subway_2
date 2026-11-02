// src/mvp/order-language/subway-order-aliases.ts
// 9일차: 자연어 → Subway Option ID 매핑

// ─────────────────────────────────────────────
// 빵 (subway_bread)
// ─────────────────────────────────────────────

export const BREAD_ALIASES: Record<string, string> = {
  '위트': 'bread_wheat',
  '위트브레드': 'bread_wheat',
  '위트 브레드': 'bread_wheat',
  '위트빵': 'bread_wheat',
  '허니오트': 'bread_wheat', // 매핑은 wheat로 (실제 메뉴에 없으면 wheat가 기본)
  '화이트': 'bread_white',
  '화이트브레드': 'bread_white',
  '화이트 브레드': 'bread_white',
  '화이트빵': 'bread_white',
  'wheat': 'bread_wheat',
  'white': 'bread_white',
};

// ─────────────────────────────────────────────
// 치즈 (subway_cheese)
// ─────────────────────────────────────────────

export const CHEESE_ALIASES: Record<string, string> = {
  '아메리칸': 'cheese_american',
  '아메리칸치즈': 'cheese_american',
  '아메리칸 치즈': 'cheese_american',
  '치즈': 'cheese_american', // 기본 치즈
  'american': 'cheese_american',
};

// ─────────────────────────────────────────────
// 채소 (subway_vegetables)
// ─────────────────────────────────────────────

export const VEGETABLE_ALIASES: Record<string, string> = {
  '상추': 'vegetable_lettuce',
  '레터스': 'vegetable_lettuce',
  '양상추': 'vegetable_lettuce',
  '토마토': 'vegetable_tomato',
  '오이': 'vegetable_cucumber',
  '양파': 'vegetable_onion',
  '피망': 'vegetable_green_pepper',
  '그린페퍼': 'vegetable_green_pepper',
  '올리브': 'vegetable_olive',
  '할라피뇨': 'vegetable_jalapeno',
  'lettuce': 'vegetable_lettuce',
  'tomato': 'vegetable_tomato',
  'cucumber': 'vegetable_cucumber',
  'onion': 'vegetable_onion',
  'olive': 'vegetable_olive',
  'jalapeno': 'vegetable_jalapeno',
};

// ─────────────────────────────────────────────
// 소스 (subway_sauces)
// ─────────────────────────────────────────────

export const SAUCE_ALIASES: Record<string, string> = {
  '올리브오일': 'sauce_olive_oil',
  '올리브 오일': 'sauce_olive_oil',
  '스위트칠리': 'sauce_sweet_chili',
  '스위트 칠리': 'sauce_sweet_chili',
  '허니머스타드': 'sauce_honey_mustard',
  '허니 머스타드': 'sauce_honey_mustard',
  '랜치': 'sauce_ranch',
  '사우전드': 'sauce_thousand_island',
  '사우전드아일랜드': 'sauce_thousand_island',
  '갈릭사우전드': 'sauce_garlic_thousand_island',
  '갈릭 사우전드': 'sauce_garlic_thousand_island',
  '블랙페퍼': 'seasoning_black_pepper',
  '블랙 페퍼': 'seasoning_black_pepper',
  '후추': 'seasoning_black_pepper',
  'olive oil': 'sauce_olive_oil',
  'sweet chili': 'sauce_sweet_chili',
  'honey mustard': 'sauce_honey_mustard',
  'ranch': 'sauce_ranch',
  'thousand island': 'sauce_thousand_island',
};

// ─────────────────────────────────────────────
// 사이즈 (subway_size)
// ─────────────────────────────────────────────

export const SIZE_ALIASES: Record<string, string> = {
  '15cm': 'size_15cm',
  '15 cm': 'size_15cm',
  '15': 'size_15cm',
  '하프': 'size_15cm',
  '30cm': 'size_30cm',
  '30 cm': 'size_30cm',
  '30': 'size_30cm',
  '풀': 'size_30cm',
  '풀사이즈': 'size_30cm',
};

// ─────────────────────────────────────────────
// 그룹 키워드 → groupId 매핑
// ─────────────────────────────────────────────

export const GROUP_KEYWORD_MAP: Record<string, string> = {
  '빵': 'subway_bread',
  '브레드': 'subway_bread',
  '치즈': 'subway_cheese',
  '채소': 'subway_vegetables',
  '야채': 'subway_vegetables',
  '소스': 'subway_sauces',
  '드레싱': 'subway_sauces',
  '사이즈': 'subway_size',
  '크기': 'subway_size',
};
