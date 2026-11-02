// 장바구니 화면 점검 (10/26 예형님 "배민처럼"): [담기] → 계속 고르기 · 위 🛒 개수 · 아래 "○○원 · 주문하기 N" · 같은 건 수량 ·
// "다 드실 거예요?" · [내 거]/[같이 먹는 사람 거] · 말로 여러 개 (개수·하나는·목록·"든든한 거 하나 가벼운 거 하나"·"이거 하나 저거 하나"·사람) ·
// 줄 5개·수량 10개 · 새로고침해도 남음 · 주문하면 비움 · 한 사람 말은 그대로
// 실행: npx tsx scripts/cart-check.ts https://subway.metasolveai.com
import { chromium, type Page } from '@playwright/test';
import { closeCart, openCart, orderGo, waitMenus } from './ui-helpers.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
const browser = await chromium.launch();
let pass = 0;
let total = 0;
const ok = (name: string, v: boolean, detail = '') => {
  total++;
  if (v) pass++;
  console.log(`${v ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const idle = (p: Page) => p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 60000 });
const txt = async (p: Page, sel: string) => ((await p.textContent(sel).catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
async function open(consent: string[] = ['orders']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForTimeout(400);
  for (const k of consent) await p.check(`#ob-${k}`);
  await p.click('#onboard-done');
  await waitMenus(p);
  await idle(p);
  return { ctx, p, errors };
}
async function say(p: Page, t: string) {
  await closeCart(p);
  await p.fill('#talk-input', t);
  await p.click('#talk-send');
  await idle(p);
  await p.waitForTimeout(900);
  await idle(p);
}
const add = async (p: Page, i = 0) => {
  await closeCart(p);
  await p.locator('#menu-list .menu .actions .btn-primary').nth(i).click();
  await idle(p);
  await p.waitForTimeout(600);
};
// 문장마다 새 장바구니 (10/27: 젬마 먼저로 바뀌어 새 말은 장바구니에 이어 담김 — 배민처럼)
async function fresh(p: Page) {
  await closeCart(p);
  await p.evaluate(() => localStorage.removeItem('subway.cart'));
  await p.reload();
  await p.waitForTimeout(600);
  await waitMenus(p);
  await idle(p);
  await p.waitForFunction(() => !document.querySelector('#cart-body .cart-line'), null, { timeout: 5000 }).catch(() => undefined);
}
const lines = (p: Page) => p.locator('#cart-body .cart-line').count();
const badge = async (p: Page) => ((await p.locator('#cart-count').isVisible()) ? Number(await txt(p, '#cart-count')) : 0);
const records = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('subway.v1') ?? '{}').orders?.length ?? 0);
const won = (s: string) => Number(s.replace(/[^0-9]/g, ''));

// A. 1개: 담기 → 🛒 1 · 아래 주문하기 1 · 장바구니에서 주문 → 글은 전과 같음 · 주문하면 비움
{
  const { ctx, p, errors } = await open();
  ok('A 처음엔 🛒 개수·아래 주문 버튼 없음', (await badge(p)) === 0 && (await p.locator('#cart-bar').isHidden()));
  ok('A ③ 카드 버튼 = [담기]', ((await p.locator('#menu-list .menu .actions .btn-primary').first().textContent()) ?? '').trim() === '담기');
  await p.locator('#menu-list .menu .actions .btn-primary').first().scrollIntoViewIfNeeded();
  const y0 = await p.evaluate(() => scrollY);
  // 앱이 화면을 움직이는지만 보려고 페이지 안에서 직접 누름 (Playwright의 자동 스크롤 없이)
  await p.locator('#menu-list .menu .actions .btn-primary').first().evaluate((b) => (b as HTMLElement).click());
  await idle(p);
  await p.waitForTimeout(600);
  const y1 = await p.evaluate(() => scrollY);
  ok('A [담기] → 🛒 1, 아래 "○○원 장바구니 보기 1", ④ 옵션 고르기로 내려감 (10/27)', (await badge(p)) === 1 && (await txt(p, '#cart-bar')).includes('장바구니 보기') && (await txt(p, '#cart-bar-n')) === '1' && y1 > y0 && Math.abs(await p.locator('#step-order').evaluate((e) => e.getBoundingClientRect().top)) < 200, `scroll ${y0}→${y1}`);
  ok('A ③ 카드에 "담음 1"', (await txt(p, '#menu-list .menu .in-cart')) === '담음 1');
  ok('A 주문 전엔 ⑥ 주문서 안 보임 (10/27)', await p.locator('#step-sheet').isHidden());
  await p.click('#cart-bar');
  await p.waitForTimeout(600);
  ok('A 아래 [장바구니 보기] → 장바구니 화면이 열림 (⑤, 1줄, "다 드실 거예요?" 없음, ⑥은 아직)', (await p.locator('#cart-drawer').isVisible()) && (await p.locator('#step-cart').isVisible()) && (await lines(p)) === 1 && (await p.locator('#who-ask').count()) === 0 && (await p.locator('#step-sheet').isHidden()));
  await p.click('#order-go');
  await p.waitForTimeout(600);
  ok('A [이대로 주문하기] → 같은 화면에 ⑥ 주문서, 1줄·사진 1장', (await p.locator('#step-sheet').isVisible()) && (await p.locator('#order-lines .order-line').count()) === 1 && (await p.locator('#order-lines .order-pic').count()) === 1);
  await p.click('#order-confirm');
  await p.waitForSelector('#order-recorded');
  await p.click('#drawer-back');
  ok('A [←] → 장바구니 화면 닫힘', await p.locator('#cart-drawer').isHidden());
  const t = await p.inputValue('#order-text');
  ok('A 1개 주문서 글은 전과 같음 ("모두 n개" 없음), 기록 1개', !t.includes('모두') && t.startsWith('[써브웨이 주문서]') && (await records(p)) === 1);
  ok('A 주문하면 장바구니 저장 비움', (await p.evaluate(() => localStorage.getItem('subway.cart'))) === null);
  await add(p, 1);
  ok('A 다시 담으면 새 장바구니 (🛒 1)', (await badge(p)) === 1 && (await lines(p)) === 1);
  ok('A 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// B. 같은 것 두 번 → 한 줄 수량 2 · 다른 것 → 2줄 · 합계 · 수량 +/− · 하나만 따로 · 새로고침해도 남음
{
  const { ctx, p, errors } = await open();
  await add(p, 0);
  await add(p, 0);
  ok('B 같은 메뉴 두 번 → 한 줄 · 2개, 🛒 2, "담음 2"', (await lines(p)) === 1 && (await badge(p)) === 2 && (await txt(p, '#cart-body .cart-n')) === '2개' && (await txt(p, '#menu-list .menu .in-cart')) === '담음 2');
  ok('B 2개부터 "다 드실 거예요?" — ② 메뉴 주문 아래 (장바구니 안 아님)', (await p.locator('#conditions #who-ask').isVisible()) && (await p.locator('#step-cart #who-ask').count()) === 0);
  ok('B 순서 ⑤ 장바구니 → ⑥ 주문서', (await p.evaluate(() => [...document.querySelectorAll('#cart-drawer section.step')].map((x) => x.id).join('>'))) === 'step-cart>step-sheet');
  await p.click('#who-mine');
  await add(p, 1);
  const prices = await p.locator('#cart-body .cart-price').allTextContents();
  ok('B 다른 메뉴 → 2줄, 🛒 3, 합계 = 줄 금액 합, 아래 버튼 금액도 같음', (await lines(p)) === 2 && (await badge(p)) === 3 && (await txt(p, '#slot-total')).includes(prices.map(won).reduce((a, b) => a + b, 0).toLocaleString('ko-KR')) && (await txt(p, '#cart-bar-total')) === `${prices.map(won).reduce((a, b) => a + b, 0).toLocaleString('ko-KR')}원`, `${prices.join(' + ')} / ${await txt(p, '#slot-total')} / ${await txt(p, '#cart-bar-total')}`);
  await openCart(p);
  await p.click('[data-qty-plus="1"]');
  ok('B [+] → 2번 줄 2개, 🛒 4', (await badge(p)) === 4);
  await p.click('[data-qty-minus="1"]');
  await p.click('[data-qty-minus="1"]');
  ok('B 1개에서 [🗑] → 그 줄 빠짐', (await lines(p)) === 1 && (await badge(p)) === 2);
  await p.locator('#cart-body .cart-line').first().click();
  await idle(p);
  await p.waitForTimeout(500);
  ok('B 줄을 누르면 ④ 옵션, "2개 모두 바뀌어요" + [하나만 따로 바꾸기]', (await txt(p, '#slot-head')).includes('2개 모두 바뀌어요') && (await p.locator('#split-one').isVisible()));
  await p.click('#split-one');
  await idle(p);
  await p.waitForTimeout(500);
  ok('B 하나만 따로 → 2줄 (1개 + 1개)', (await lines(p)) === 2 && (await badge(p)) === 2);
  await p.reload();
  await p.waitForTimeout(1500);
  await idle(p);
  await p.waitForTimeout(800);
  ok('B 새로고침해도 장바구니 그대로 (🛒 2, 2줄)', (await badge(p)) === 2 && (await lines(p)) === 2);
  await p.click('#cart-btn');
  await p.waitForTimeout(1300);
  ok('B 위 🛒 → 장바구니로', Math.abs(await p.locator('#step-cart').evaluate((e) => e.getBoundingClientRect().top)) < 200);
  // 비교 질문은 고치기가 아님
  await say(p, '1번이랑 2번 뭐가 달라');
  ok('B 담은 게 2줄이어도 "1번이랑 2번 뭐가 달라"는 비교', (await p.locator('#compare-result .notice').count()) === 1 && (await badge(p)) === 2);
  ok('B 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// C. 같이 먹는 사람: [내 거]/[같이 먹는 사람 거] 두 개만 · 그 사람 알레르기만 · 앞 줄 사람과 같아요 · 기록은 내 것만
{
  const { ctx, p, errors } = await open(['orders', 'allergy']);
  await p.click('.allergy summary');
  await p.click('#allergy-chips [data-a="우유"]');
  await idle(p);
  await add(p, 0);
  await add(p, 1);
  await p.click('#who-shared');
  await idle(p);
  await p.waitForTimeout(800);
  await openCart(p);
  await p.locator('#cart-body .cart-line').nth(1).click();
  await idle(p);
  await p.waitForTimeout(500);
  const owners = (await p.locator('#slot-head fieldset', { hasText: '누가 먹어요?' }).locator('button').allTextContents()).map((x) => x.replace('✓', '').trim());
  ok('C "누가 먹어요?"는 사람 + 고른 메뉴 (나 · ○○ / 같이 먹는 사람 1 · ○○ / + 사람 추가)', owners.length === 3 && owners[0]!.startsWith('나 · ') && owners[1]!.startsWith('같이 먹는 사람 1 · ') && owners[2] === '+ 사람 추가', owners.join('|'));
  ok('C 2번 줄 = 같이 먹는 사람 1, 내 우유 알레르기 경고 없음', (await txt(p, '#slot-head')).includes('2번 · 같이 먹는 사람 1') && !(await txt(p, '#sheet-allergy')).includes('우유'));
  ok('C [앞 줄 사람과 같아요]·[이 줄 빼기] 없음 (10/27)', (await p.locator('#same-person').count()) === 0 && (await p.locator('#slot-remove').count()) === 0);
  await p.click('#guest-allergy summary');
  await p.locator('#slot-head fieldset', { hasText: '알레르기' }).locator('button', { hasText: '땅콩' }).click();
  await idle(p);
  await p.waitForTimeout(500);
  ok('C 같이 먹는 사람 알레르기 땅콩 → 막대에 (땅콩)', (await txt(p, '#guest-allergy-count')) === '(땅콩)');
  await add(p, 2);
  await openCart(p);
  await p.locator('#cart-body .cart-line').nth(2).click();
  await idle(p);
  await p.waitForTimeout(500);
  const owners3 = await p.locator('#slot-head fieldset', { hasText: '누가 먹어요?' }).locator('button').allTextContents();
  ok('C 3번 줄은 새 사람 (같이 먹는 사람 2), 버튼에 3명', (await txt(p, '#slot-head')).includes('3번 · 같이 먹는 사람 2') && owners3.length === 4, owners3.join('|'));
  await p.locator('#slot-head fieldset', { hasText: '누가 먹어요?' }).locator('button', { hasText: '같이 먹는 사람 1' }).click();
  await idle(p);
  await p.waitForTimeout(500);
  ok('C 3번 줄을 [같이 먹는 사람 1]로 → 그 사람 알레르기 (땅콩)', (await txt(p, '#guest-allergy-count')) === '(땅콩)' && (await txt(p, '#slot-head')).includes('3번 · 같이 먹는 사람 1'));
  ok('C 장바구니는 사람마다 묶음 (나 · 같이 먹는 사람 1 · 같이 먹는 사람 2 아님)', (await p.locator('#cart-body .cart-person-head strong').allTextContents()).join('|') === '나|같이 먹는 사람 1', (await p.locator('#cart-body .cart-person-head strong').allTextContents()).join('|'));
  await orderGo(p);
  ok('C [이대로 주문하기] → ⑥ 주문서에 3줄·사진 3장', (await p.locator('#order-lines .order-line').count()) === 3 && (await p.locator('#order-lines .order-pic').count()) === 3);
  await p.click('#order-confirm');
  await p.waitForSelector('#order-recorded');
  const t = await p.inputValue('#order-text');
  ok('C 글: 1번 나(우유) · 2·3번 같이 먹는 사람 1(땅콩)', t.includes('── 1번 · 나 ──') && t.includes('── 2번 · 같이 먹는 사람 1 ──') && t.includes('── 3번 · 같이 먹는 사람 1 ──') && /1번 · 나[\s\S]*우유 알레르기[\s\S]*2번 · 같이 먹는 사람 1[\s\S]*땅콩 알레르기/.test(t));
  ok('C 기록은 내 것 1줄만', (await records(p)) === 1 && (await txt(p, '#order-recorded')).includes('2줄은 안 남겨요'));
  ok('C 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// D. 말로: "로스트 치킨 2개" → 한 줄 2개, "전부 토마토 빼", "1번은 제로콜라"
{
  const { ctx, p, errors } = await open();
  await say(p, '로스트 치킨 2개');
  ok('D "로스트 치킨 2개" → 한 줄 · 2개', (await lines(p)) === 1 && (await badge(p)) === 2 && (await txt(p, '#cart-body .cart-name')).startsWith('로스트 치킨'));
  await say(p, '전부 토마토 빼');
  ok('D "전부 토마토 빼" → 그 줄 토마토 빼기', (await txt(p, '#cart-body .cart-opts')).includes('토마토 빼기'), await txt(p, '#cart-body .cart-opts'));
  ok('D 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// E. "든든한 거 하나 가벼운 거 하나 매운 거 하나" → 줄 3개, 줄마다 따로 추천
{
  const { ctx, p, errors } = await open();
  await say(p, '든든한 거 하나 가벼운 거 하나 매운 거 하나');
  ok('E 줄 3개 (아직 안 고름) + 줄마다 추천 (3칸 모두 빨강)', (await lines(p)) === 3 && (await p.locator('#plan-bar [data-plan].todo').count()) === 3, await txt(p, '#plan-bar'));
  await add(p, 0);
  await p.waitForTimeout(800);
  await idle(p);
  ok('E 담아도 1번 그대로 (옵션 고를 수 있게) + ④ 아래 [다음 사람 고르기], 1번은 초록', ((await p.locator('#plan-bar button[aria-pressed="true"]').textContent()) ?? '').includes('1번') && (await p.locator('#next-person-go').isVisible()) && (await p.locator('#plan-bar [data-plan="0"].done').count()) === 1);
  await add(p, 1);
  ok('E 같은 사람이 또 [담기] → 1번 사람 줄이 둘 (2번 사람으로 안 넘어감)', (await p.locator('#cart-body .cart-line.empty').count()) === 2 && (await badge(p)) === 2 && ((await p.locator('#plan-bar button[aria-pressed="true"]').textContent()) ?? '').includes('1번'));
  await p.click('#next-person-go');
  await idle(p);
  await p.waitForTimeout(800);
  ok('E [다음 사람 고르기] → 다음 줄 추천으로', /^[23]번/.test(((await p.locator('#plan-bar button[aria-pressed="true"]').textContent()) ?? '').trim()), await txt(p, '#plan-bar button[aria-pressed="true"]'));
  await add(p, 0);
  await p.click('#next-person-go');
  await idle(p);
  await p.waitForTimeout(800);
  const spicy = await p.locator('#menu-list .menu .reasons').first().textContent();
  ok('E 3번(매운 거) 추천은 매운 쪽', /매운|맵게|스파이시/.test(spicy ?? ''), (spicy ?? '').slice(0, 60));
  await add(p, 0);
  ok('E 다 담김, 🛒 4, [다 골랐어요]', (await p.locator('#cart-body .cart-line.empty').count()) === 0 && (await badge(p)) === 4 && (await txt(p, '#next-person-go')).includes('다 골랐어요'));
  ok('E 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// F. "이거 하나 저거 하나" = ③ 1번·2번 / "든든한거 한개랑 가벼운거 한개" / "나는 두 개 민수는 하나"
{
  const { ctx, p, errors } = await open();
  const names = (await p.locator('#menu-list .menu h3').allTextContents()).map((x) => x.replace(/^\d/, '').trim());
  await say(p, '이거 하나 저거 하나');
  const got = await p.locator('#cart-body .cart-name').allTextContents();
  ok('F "이거 하나 저거 하나" → ③ 1번·2번 담김', got.length === 2 && got[0]!.startsWith(names[0]!) && got[1]!.startsWith(names[1]!), `${got.join(' / ')} ← ${names.slice(0, 2).join(' / ')}`);
  await fresh(p);
  await say(p, '든든한거 한개랑 가벼운거 한개');
  ok('F "든든한거 한개랑 가벼운거 한개" → 줄 2개 (든든한·가벼운 따로, 사람을 말 안 했으니 나 혼자 두 개)', (await lines(p)) === 2 && /든든/.test(await txt(p, '#plan-bar')) && /가볍|가벼/.test(await txt(p, '#plan-bar')), `${await lines(p)}줄 · ${await txt(p, '#plan-bar')}`);
  await fresh(p);
  await say(p, '나는 두 개 민수는 하나');
  const who = await p.locator('#cart-body .cart-person-head strong').allTextContents();
  ok('F "나는 두 개 민수는 하나" → 나 · 민수 (사람마다 묶음)', who.join('|') === '나|민수' && (await txt(p, '#plan-bar')).includes('나'), who.join('|'));
  ok('F 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// G. 목록·하나는·사람
{
  const { ctx, p, errors } = await open();
  await say(p, '잠봉, 치킨, 스파이시');
  const n1 = await p.locator('#cart-body .cart-name').allTextContents();
  ok('G "잠봉, 치킨, 스파이시" → 1번 잠봉 + 2·3번 고르기', n1.length === 3 && n1[0]!.startsWith('잠봉') && /치킨/.test(n1[1]!) && /스파이시|매운/.test(n1[2]!), n1.join(' / '));
  await fresh(p);
  await say(p, '하나는 해장할 거, 하나는 가벼운 거');
  ok('G "하나는 해장할 거, 하나는 가벼운 거" → 2줄 + 1번 추천 = 해장', (await lines(p)) === 2 && /기름기|나트륨/.test(await txt(p, '#menu-list .menu')));
  await add(p, 0);
  ok('G 해장 줄엔 수프 세트', (await txt(p, '#cart-body .cart-opts')).includes('수프'), await txt(p, '#cart-body .cart-opts'));
  await fresh(p);
  await say(p, '3명이야, 민수는 매운 거 못 먹고 지은이는 새우 알레르기');
  const who = await p.locator('#cart-body .cart-person-head strong').allTextContents();
  ok('G "3명이야, 민수는…지은이는…" → 나 · 민수 · 지은', who.join('|') === '나|민수|지은', who.join('|'));
  await add(p, 0);
  await p.waitForTimeout(800);
  await idle(p);
  await p.click('#next-person-go');
  await idle(p);
  await p.waitForTimeout(800);
  const minsu = await p.locator('#menu-list .menu h3').allTextContents();
  ok('G 민수 추천엔 스파이시 없음', minsu.length > 0 && !minsu.some((n) => /스파이시/.test(n)), minsu.join(', '));
  ok('G 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
// H. 최대: 줄마다 10개, 줄 5개 / 한 사람 긴 말은 그대로
{
  const { ctx, p, errors } = await open();
  await say(p, '로스트 치킨 12개');
  ok('H "12개" → 한 줄 10개까지 (10개로 맞추거나 10 + 2)', ((await badge(p)) === 10 && (await lines(p)) === 1) || ((await badge(p)) === 12 && (await lines(p)) === 2), `${await badge(p)}개 ${await lines(p)}줄`);
  for (let i = 0; i < 4; i++) await add(p, i % 3 === 0 ? 1 : i % 3);
  ok('H 줄 10개면 [+ 메뉴 더 담기] 없음 + "10줄까지" (10/27 예형님: 10명까지)', (await lines(p)) <= 10 && ((await lines(p)) < 10 || ((await p.locator('#slot-add').count()) === 0 && (await txt(p, '#slot-max')).includes('10줄'))), `${await lines(p)}줄`);
  ok('H 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
{
  const { ctx, p, errors } = await open();
  await say(p, '로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기');
  ok('H 한 사람 긴 말 → 1줄 (나누지 않음)', (await lines(p)) === 1 && (await badge(p)) === 1);
  ok('H 오류 없음 (한 사람)', !errors.length, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(`장바구니 ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
