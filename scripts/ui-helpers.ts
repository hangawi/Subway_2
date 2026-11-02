// 화면 점검 공용 도우미
import type { Page } from '@playwright/test';

/** 추천 메뉴가 보일 때까지 기다림. 10/22부터 ③은 ②에서 말하거나 조건을 고르기 전엔 접혀 있어서, 접혀 있으면 [조건 없이 추천 보기]를 누름 */
export async function waitMenus(p: Page, timeout = 30000) {
  await p.waitForSelector('#menu-list .menu, #recs-gate:not([hidden])', { state: 'attached', timeout });
  await p.waitForFunction(() => !!document.querySelector('#menu-list .menu'), undefined, { timeout });
  if (await p.locator('#recs-gate').isVisible()) await p.click('#show-recs');
  await p.waitForSelector('#menu-list .menu', { timeout });
}

/** 아래 탭 바꾸기 (10/22: 내 취향·내 정보는 [취향 그래프] 탭으로 옮김) */
export async function tab(p: Page, which: 'order' | 'taste') {
  if (await p.locator('#cart-drawer').isVisible()) await p.click('#drawer-back'); // 10/27: 장바구니 화면을 닫고
  if ((await p.locator('#app').getAttribute('data-tab')) === which) return;
  await p.click(`#tabbtn-${which}`);
}

/** 장바구니 화면 열기 (10/27: ⑤ 장바구니·⑥ 주문서는 옆에서 열리는 화면 안) */
export async function openCart(p: Page) {
  if (await p.locator('#cart-drawer').isVisible()) return;
  await p.click('#cart-btn');
  await p.waitForSelector('#cart-drawer', { state: 'visible' });
}
/** 장바구니 화면을 열고 [이대로 주문하기] */
export async function orderGo(p: Page) {
  await openCart(p);
  await p.click('#order-go');
}
/** 장바구니 화면 닫기 (주문 화면으로) */
export async function closeCart(p: Page) {
  if (await p.locator('#cart-drawer').isVisible()) await p.click('#drawer-back');
}
