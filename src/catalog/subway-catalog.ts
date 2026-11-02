// 공식 자료로 만든 써브웨이 카탈로그(subway-catalog.json)를 읽는다.
// 만드는 곳: scripts/build-catalog.ts. 이 파일은 읽기만 한다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export type Status = 'KNOWN' | 'UNKNOWN';

export interface CatalogAllergens {
  status: Status;
  contains: string[];
  mayContain: string[];
  rows: string[];
}

export interface CatalogNutrition {
  weightG: number | null;
  energyKcal: number | null;
  proteinG: number | null;
  saturatedFatG: number | null;
  sugarG: number | null;
  sodiumMg: number | null;
  basis: string;
}

export interface CatalogPrice {
  status: 'KNOWN' | 'NEEDS_CHECK';
  price15cm: number | null;
  price30cm: number | null;
  checkedAt: string | null;
  checkedWhere: string | null;
}

export type MenuKind = 'SANDWICH' | 'SALAD' | 'GRAIN_SALAD' | 'WRAP' | 'MORNING_SANDWICH' | 'MORNING_WRAP' | 'SIDE';

export interface CatalogMenu {
  id: string;
  officialIdx: string | null;
  name: string;
  nameEn: string | null;
  kind: MenuKind;
  label: string | null;
  summary: string | null;
  nutrition15cm: CatalogNutrition | null;
  allergens: CatalogAllergens;
  price: CatalogPrice;
  /** 기본 야채가 보통과 다른 메뉴 (아침 샌드위치, 10/19). 없으면 보통 8가지 */
  defaultVegetables?: string[] | null;
}

/** 단품 (10/19): 공식 주문 시스템 "사이드.음료" — 음료·쿠키·칩·웨지·수프 */
export interface CatalogSingle {
  id: string;
  name: string;
  group: 'DRINK' | 'COOKIE' | 'CHIP' | 'WEDGE' | 'SOUP';
  price: number;
  checkedAt: string;
  nutrition: CatalogNutrition | null;
  allergens: CatalogAllergens;
  /** 이 시각(서울, 분)부터 판매 (웨지 11:00 = 660) */
  fromMinute?: number;
}

export interface CatalogTopping {
  id: string;
  officialIdx: string | null;
  name: string;
  appliesTo: 'SANDWICH' | 'SALAD' | 'GRAIN_SALAD';
  allergens: CatalogAllergens;
  price: CatalogPrice;
}

export interface CatalogIngredient {
  id: string;
  category: 'BREAD' | 'VEGETABLE' | 'CHEESE' | 'SAUCE';
  name: string;
  nameEn: string | null;
  energyKcal: number | null;
  allergens: CatalogAllergens;
}

export interface CatalogMain {
  id: string;
  name: string;
  allergens: CatalogAllergens;
}

export interface CatalogOptionRule {
  group: string;
  appliesTo: string;
  min: number | null;
  max: number | null;
  note: string;
  status: 'CONFIRMED' | 'NEEDS_CHECK';
  source: string;
}

export interface SubwayCatalog {
  source: { site: string; retrievedAt: string; notes: string[] };
  allergenList: string[];
  menus: CatalogMenu[];
  toppings: CatalogTopping[];
  ingredients: CatalogIngredient[];
  mains: CatalogMain[];
  optionRules: CatalogOptionRule[];
  sets: CatalogSet[];
  /** 단품 (10/19) */
  singles?: CatalogSingle[];
  /** 판매가 끝나 메뉴판에서 뺀 것 (data/입력표/판매끝.csv, 10/19) — 말로 찾으면 "판매가 끝났어요" */
  ended?: Array<{ officialIdx: string; name: string; kind: string; checkedAt: string }>;
}

export interface CatalogSet {
  name: string;
  item: string;
  addPrice: number;
  checkedAt: string;
}

const CATALOG_PATH = fileURLToPath(new URL('./subway-catalog.json', import.meta.url));

export function loadSubwayCatalog(path: string = CATALOG_PATH): SubwayCatalog {
  return JSON.parse(readFileSync(path, 'utf8')) as SubwayCatalog;
}
