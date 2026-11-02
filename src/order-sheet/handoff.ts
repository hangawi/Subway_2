// 주문서 넘겨주기 (로드맵 39번): [확인]을 누른 뒤에만 쓰는 글·링크. 결제·자동 접수는 없다 (10단계, 무기한 연기).
// 금액은 "참고 금액(매장 확인)" — 매장마다 다를 수 있고, 가격을 모르는 토핑은 옆에 적는다.
import type { OrderSheet } from './order-sheet.ts';

export interface HandoffStore {
  name: string;
  phone: string | null;
  lat: number;
  lng: number;
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

/** 치즈 줄: 이름에 치즈가 든 메뉴(스테이크 & 치즈, 에그&치즈)는 치즈를 안 골라도 메뉴 치즈가 들어감 — "없음"이라 쓰면 빼 달라는 뜻으로 읽힘 (10/15 점검) */
export function cheeseText(sheet: Pick<OrderSheet, 'cheese' | 'menu'>): string {
  if (sheet.cheese) return sheet.cheese;
  return /치즈/.test(sheet.menu.name) ? '메뉴 기본 치즈' : '없음';
}

/** 매장에 읽어 주거나 붙여 넣을 주문서 글. allergies: 사용자가 고른 알레르기 (있으면 매장에 알리는 줄) */
export function orderText(sheet: OrderSheet, store: HandoffStore | null, allergies: readonly string[] = []): string {
  const lines: string[] = [];
  lines.push(`[써브웨이 주문서]${store ? ` ${store.name}` : ''}`);
  // 샌드위치 없이 단품만이면 메뉴 줄·소스 줄 없이 단품만 (10/19)
  const singlesOnly = sheet.menu.id === 'singles';
  if (!singlesOnly) lines.push(`${sheet.menu.name} ${sheet.size}`);
  if (sheet.bread) lines.push(`빵: ${sheet.bread}${sheet.toasted === false ? ' (토스팅 안 함)' : ''}`);
  if (sheet.bread) lines.push(`치즈: ${cheeseText(sheet)}`);
  if (sheet.vegetables.removed.length) lines.push(`야채 빼기: ${sheet.vegetables.removed.join(', ')}`);
  if (sheet.vegetables.added.length) lines.push(`야채 많이: ${sheet.vegetables.added.join(', ')}`);
  if (!singlesOnly) lines.push(`소스: ${sheet.sauces.length ? sheet.sauces.join(', ') : '없음'}`);
  if (sheet.toppings.length) lines.push(`추가 토핑: ${sheet.toppings.join(', ')}`);
  if (sheet.set) {
    const extra = [sheet.setItem, sheet.drink ? `음료: ${sheet.drink} (16oz) — 매장에서 확인` : null].filter(Boolean).join(', ');
    lines.push(`세트: ${sheet.set}${extra ? ` (${extra})` : ''}`);
  }
  if (sheet.extras?.length) lines.push(`${singlesOnly ? '' : '단품 추가: '}${sheet.extras.map((e) => `${e.name}${e.qty > 1 ? ` ${e.qty}개` : ''}`).join(', ')}`);
  const check = sheet.price.needsCheck.length ? ` (${sheet.price.needsCheck.join(', ')} 가격 매장 확인)` : '';
  lines.push(`참고 금액: ${won(sheet.price.total)}${check} — 매장에서 다를 수 있어요`);
  if (sheet.allergens.contains.length) lines.push(`알레르기 성분: ${sheet.allergens.contains.join(', ')}`);
  // 알레르기가 있는 사람: 매장에 먼저 알림 (빵·소스·도마 확인을 부탁)
  if (allergies.length) lines.push(`※ ${allergies.join(', ')} 알레르기가 있어요. 재료 확인 부탁드려요`);
  return lines.join('\n');
}

/** 전화 링크 (번호가 없으면 null — 버튼을 숨긴다) */
export function telLink(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/[^0-9+]/g, '');
  return digits.length >= 7 ? `tel:${digits}` : null;
}

/** 카카오맵 길찾기 링크 */
export function kakaoRouteLink(store: HandoffStore): string {
  return `https://map.kakao.com/link/to/${encodeURIComponent(store.name)},${store.lat},${store.lng}`;
}
