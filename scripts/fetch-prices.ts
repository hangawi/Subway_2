// 써브웨이 공식 주문 시스템(api.subway.co.kr)에서 메뉴·세트 가격을 읽어 data/official/prices.json에 저장하고,
// data/입력표/가격.csv의 빈 칸을 채운다. 이미 채워진 칸은 건드리지 않는다.
// 기준: 매장을 고르기 전 "메뉴 먼저 보기" 가격 (storCd=00001). 매장에 따라 다를 수 있다.
// 추가 토핑 가격은 매장을 고른 뒤에만 나와서 여기서는 받지 않는다.
// 실행: npx tsx scripts/fetch-prices.ts
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://api.subway.co.kr';
const QUERY = 'storCd=00001&orderType=T&preMenuYn=Y';
const OUT = process.env.OFFICIAL_OUT ?? 'data/official';
const PRICE_CSV = 'data/입력표/가격.csv';
const SOURCE = '써브웨이 공식 주문 API (매장 선택 전 기본가)';
// 2 샌드위치, 3 샐러드, 4 랩·기타, 5 사이드·음료, 10 아침메뉴, 11 그레인 샐러드
const CATEGORIES = [2, 3, 4, 5, 10, 11];

interface ApiItem {
  itemCd: string;
  itemNm: string;
  pric: number;
  itemSaleYn: string;
}
interface ApiMenu {
  menuIdx: number;
  menuTp: string;
  dsplyCatNm: string;
  menuNm: string;
  setYn: string;
  menuMst: ApiItem[] | null;
}
interface ApiSet {
  set: { setNm: string; menuMst: ApiItem | null } | null;
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  const body = (await res.json()) as { retCode: string; retMsg: string; data: T };
  if (body.retCode !== '00') throw new Error(`${path}: ${body.retCode} ${body.retMsg}`);
  return body.data;
}

// 크기는 상품 이름 끝의 15/30으로 구분한다 ("로티세리 바비큐 치킨15", "잠봉 플러스 30"). 크기가 없으면 단일 상품.
const sizeOf = (itemNm: string) => (/30\s*$/.test(itemNm) ? '30' : /15\s*$/.test(itemNm) ? '15' : 'ONE');

const norm = (s: string) => s.replace(/[\s,&]/g, '').replace(/샐러드$/, '');
// 공식 주문 시스템과 공식 홈페이지의 메뉴 이름이 다른 경우
const ALIAS: Record<string, string> = { 풀드포크: '풀드포크 바비큐' };
// 공식 홈페이지 이름 → 공식 주문 시스템 이름 (사이드·음료). 수프 3종은 "오늘의 수프"로 돌아가며 나와서 레귤러 가격을 쓴다.
const HOMEPAGE_TO_API: Record<string, string> = {
  초코칩: '초코칩 쿠키',
  '더블 초코칩': '더블 초코칩 쿠키',
  '오트밀 레이즌': '오트밀 레이즌 쿠키',
  '라즈베리 치즈케익': '라즈베리 치즈케익 쿠키',
  '화이트 초코 마카다미아': '화이트 초코 마카다미아 쿠키',
  탄산음료: '탄산음료 16oz',
  커피: '아메리카노',
  칩: '칩 (랜덤발송)',
  '포테이토 베이컨 수프': '오늘의 수프 (레귤러)',
  '콘 수프': '오늘의 수프 (레귤러)',
  '머쉬룸 수프': '오늘의 수프 (레귤러)',
};

async function main() {
  const retrievedAt = new Date().toISOString();
  const menus: Array<{ category: string; menuIdx: number; name: string; price15cm: number | null; price30cm: number | null; priceOne: number | null }> = [];
  for (const cat of CATEGORIES) {
    const data = await api<{ list: ApiMenu[] }>(`/menu/v1/list-category/${cat}?${QUERY}`);
    for (const m of data.list) {
      const items = (m.menuMst ?? []).filter((i) => i.itemSaleYn === 'Y');
      const pick = (size: string) => items.find((i) => sizeOf(i.itemNm) === size)?.pric ?? null;
      menus.push({ category: m.dsplyCatNm, menuIdx: m.menuIdx, name: m.menuNm, price15cm: pick('15'), price30cm: pick('30'), priceOne: pick('ONE') });
    }
  }
  // 세트 구성 (샌드위치에 더하는 가격). 대표 메뉴 하나로 읽는다.
  const firstSandwich = menus.find((m) => m.category === '샌드위치');
  const sets = firstSandwich
    ? (await api<{ list: ApiSet[] }>(`/menu/v1/menu-set/${firstSandwich.menuIdx}?${QUERY}`)).list
        .filter((s) => s.set?.menuMst)
        .map((s) => ({ name: s.set!.setNm, item: s.set!.menuMst!.itemNm, addPrice: s.set!.menuMst!.pric }))
    : [];

  writeFileSync(`${OUT}/prices.json`, JSON.stringify({ source: { api: API, query: QUERY, retrievedAt }, menus, sets }, null, 2) + '\n');

  if (process.env.OFFICIAL_OUT) return; // 다시 읽어 대조하는 용도면 입력표는 건드리지 않는다
  const byName = new Map(menus.map((m) => [norm(ALIAS[m.name] ?? m.name), m]));
  const csv = readFileSync(PRICE_CSV, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  let filled = 0;
  const missing: string[] = [];
  const out = csv.map((line, i) => {
    if (i === 0 || !line.trim()) return line;
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ''));
    const [cat, rawName, p15, p30] = cells;
    if (/.(TOPPING|ETC)$/.test(cat ?? '')) return line;
    const name = rawName!.replace(/^"|"$/g, '').replace(/""/g, '"');
    if ((p15 ?? '') !== '' || (p30 ?? '') !== '') return line;
    const hit = byName.get(norm(HOMEPAGE_TO_API[name] ?? name));
    if (!hit) {
      missing.push(name);
      return line;
    }
    const first = hit.price15cm ?? hit.priceOne;
    if (first === null) {
      missing.push(name);
      return line;
    }
    filled++;
    return [cells[0], cells[1], first, hit.price30cm ?? '', SOURCE, retrievedAt.slice(0, 10)].join(',');
  });
  writeFileSync(PRICE_CSV, '﻿' + out.join('\r\n'));
  console.log(`menus ${menus.length}, sets ${sets.length}, filled ${filled}${missing.length ? `, not found: ${missing.join(' / ')}` : ''}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
