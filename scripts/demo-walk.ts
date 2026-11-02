// 시연 안내(docs/검수/10-15_목/10-15_실기기_시연_안내.md) 17항목을 브라우저로 그대로 따라 하며 안내 문구와 실제 화면을 맞대어 본다.
// 실행: npx tsx scripts/demo-walk.ts https://subway.metasolveai.com
// 실제 휴대폰 확인(마이크 허용 창·전화 앱·카카오맵 앱)을 대신하지 않는다 — 문서와 화면이 같은지만 본다.
// 🎤는 크롬 가짜 마이크(삐 소리)라 받아쓰기 1번(OpenAI 비용)이 든다.
import { chromium, type Page } from '@playwright/test';
import { tab, waitMenus, orderGo, closeCart } from './ui-helpers.ts';

const base = process.argv[2] ?? 'https://subway.metasolveai.com';
const out: string[] = [];
const ok = (n: string, pass: boolean, d = '') => out.push(`${pass ? 'OK ' : 'BAD'} ${n}${d ? ` — ${d}` : ''}`);
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR',
  geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation', 'microphone', 'clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => void d.accept());
const idle = (p: Page) => p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });
const text = async (sel: string) => ((await page.locator(sel).first().textContent().catch(() => '')) ?? '');
await page.goto(base);
await page.waitForTimeout(800);

// 1
ok('1 "시작하기 전에" 보임', await page.locator('#onboard').isVisible());
ok('1 위치 문구', (await text('#onboard')).includes('📍 위치는 매장을 찾을 때만 쓰고 저장하지 않아요'));
const obChecks = await page.locator('#onboard [data-consent]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).checked));
ok('1 체크 4개 모두 꺼짐 (알레르기·주문 기록·취향·말)', obChecks.length === 4 && obChecks.every((c) => !c), JSON.stringify(obChecks));
for (const w of ['알레르기 기억하기', '주문 기록 저장', '말로 입력 (🎤)']) ok(`1 "${w}"`, (await text('#onboard')).includes(w));
await page.click('#ob-orders');
await page.click('#onboard-done');
ok('1 [이대로 시작] → 사라짐', !(await page.locator('#onboard').isVisible()));

// 2
await page.fill('#place-input', '강남역');
await page.click('#place-form button');
await idle(page);
// 카카오 장소 검색이 가끔 늦게 와서 (10/21: 3번 중 1번 실패) 결과가 보일 때까지 기다림
await page.waitForFunction(() => (document.querySelector('#loc-result')?.textContent ?? '').includes('어느 곳인가요?'), null, { timeout: 15000 }).catch(() => undefined);
ok('2 "어느 곳인가요?"', (await text('#loc-result')).includes('어느 곳인가요?'));
await page.locator('#loc-result .pick').first().click();
await waitMenus(page);
await idle(page);
ok('2 첫 매장 "✓ 주문할 매장"', (await text('#store-list .store')).includes('주문할 매장'));
ok('2 메뉴 3개', (await page.locator('#menu-list .menu').count()) === 3);

// 3
const other = page.locator('#store-list button', { hasText: '다른 매장' });
if (await other.count()) {
  await other.click();
  const second = page.locator('#store-list .store').nth(1);
  const name2 = await second.locator('h3').textContent();
  await second.locator('button', { hasText: '이 매장으로' }).click();
  const chosen = await page.locator('#store-list .store[aria-current="true"] h3').textContent();
  ok('3 두 번째 매장으로 옮겨감', chosen === name2, `${name2}`);
  ok('3 첫 매장에 [이 매장으로] 다시', (await page.locator('#store-list .store').nth(0).locator('button', { hasText: '이 매장으로' }).count()) === 1);
} else ok('3 [다른 매장] 버튼', false, '매장 1곳뿐');

// 4
await page.locator('#menu-list .menu .actions .btn-primary').first().click();
await page.waitForSelector('#order-go', { state: 'attached' });
const sauce = page.locator('#options fieldset').filter({ hasText: '소스' }).locator('button').first();
await sauce.click();
await page.waitForTimeout(800);
await orderGo(page);
const conf = await text('.confirm');
ok('4 "…에 이 주문서로 주문할까요?"', /에 이 주문서로 주문할까요\?/.test(conf), conf.slice(0, 40));
ok('4 "앱이 매장에 직접 보내지 않아요…"', conf.includes('앱이 매장에 직접 보내지 않아요'));
ok('4 확인 전 주문서 글·복사·전화 없음', (await page.locator('#order-text, #order-copy, #order-tel').count()) === 0);
await page.locator('.confirm button', { hasText: '다시 고르기' }).click();
ok('4 [다시 고르기] → [이대로 주문하기]만', (await page.locator('#order-go').count()) === 1 && (await page.locator('.confirm').count()) === 0);

// 5
await orderGo(page);
await page.click('#order-confirm');
const ot = await page.inputValue('#order-text');
ok('5 "주문서 넘겨주기"', (await text('#handoff h3')) === '주문서 넘겨주기');
ok('5 첫 줄 [써브웨이 주문서] 매장', /^\[써브웨이 주문서\] .+/.test(ot), ot.split('\n')[0]);
ok('5 참고 금액 줄', /참고 금액: [\d,]+원.* — 매장에서 다를 수 있어요/.test(ot));
await page.click('#order-copy');
await page.waitForTimeout(400);
ok('5 복사 안내', (await text('#handoff')).includes('복사했어요. 매장 직원에게 보여 주거나 붙여 넣으세요'));
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
// 윈도우 클립보드는 읽을 때 줄바꿈을 \r\n 으로 바꿈 → 줄바꿈만 맞춰 비교
ok('5 복사한 글 = 화면 글', clip.replace(/\r\n/g, '\n') === ot);

// 6·7
const tel = await page.getAttribute('#order-tel', 'href').catch(() => null);
ok('6 매장 전화 tel:', !!tel && /^tel:\d{7,}$/.test(tel), String(tel));
const map = await page.getAttribute('#order-map', 'href');
ok('7 길찾기 카카오맵', !!map && map.startsWith('https://map.kakao.com/link/to/'));

// 8
await page.waitForSelector('#order-recorded');
await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
ok('8 "내 주문에 기록했어요 (이 휴대폰에만)"', (await text('#handoff')).includes('내 주문에 기록했어요 (이 휴대폰에만)'));
ok('8 내 주문 1개', (await page.locator('#order-list li').count()) === 1);
await page.reload();
await page.waitForTimeout(800);
ok('8 새로고침 뒤 기록 남음·안내 안 뜸', (await page.locator('#order-list li').count()) === 1 && !(await page.locator('#onboard').isVisible()));

// 9 (위치 다시)
await page.click('#use-gps');
await waitMenus(page);
await idle(page);
await page.locator('#menu-list .menu .actions .btn-primary').nth(1).click();
await page.waitForSelector('#order-go', { state: 'attached' });
await orderGo(page);
await page.click('#order-confirm');
await page.waitForSelector('#order-recorded');
await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
ok('9 기록 2개', (await page.locator('#order-list li').count()) === 2);
const lastName = await page.locator('#order-list li .o-name').nth(1).textContent();
await closeCart(page);
await page.locator('#order-list li').nth(1).locator('button', { hasText: '다시 주문' }).click();
await page.waitForTimeout(800);
ok('9 [다시 주문] → 그 메뉴', (await text('#picked')) === lastName, `${lastName}`);
await page.locator('#order-list li').nth(0).locator('button', { hasText: '지우기' }).click();
ok('9 [지우기] → 1개', (await page.locator('#order-list li').count()) === 1);
await page.locator('#order-list button', { hasText: '전부 지우기' }).click();
ok('9 [전부 지우기] → "아직 기록이 없어요"', (await text('#order-list')).includes('아직 기록이 없어요'));

// 10
await orderGo(page).catch(() => undefined);
await page.click('#order-confirm').catch(() => undefined);
await page.waitForSelector('#order-recorded', { timeout: 5000 }).catch(() => undefined);
await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
await tab(page, 'taste');
await page.click('#set-orders');
await tab(page, 'order');
ok('10 동의 끄면 "내 주문" 사라짐', !(await page.locator('#my-orders').isVisible()));
await page.locator('#menu-list .menu .actions .btn-primary').first().click();
await page.waitForSelector('#order-go', { state: 'attached' });
await orderGo(page);
await page.click('#order-confirm');
await page.waitForSelector('#order-recorded');
await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
ok('10 "주문 기록 저장을 꺼 두셔서 기록하지 않았어요…"', (await text('#handoff')).includes('주문 기록 저장을 꺼 두셔서 기록하지 않았어요. 아래 [취향 그래프] → "내 정보"에서 켤 수 있어요'));
await tab(page, 'taste');
await page.click('#set-orders');
await tab(page, 'order');
ok('10 다시 켜면 비어 있음', (await page.locator('#my-orders').isVisible()) && (await page.locator('#order-list li').count()) === 0);

// 11
await page.click('.allergy summary');
await page.click('#allergy-chips [data-a="우유"]');
await idle(page);
await page.reload();
await page.waitForTimeout(800);
ok('11 동의 없이 → 새로고침하면 (우유) 없음', !(await text('#allergy-count')).includes('우유'));
await tab(page, 'taste');
await page.click('#set-allergy');
await tab(page, 'order');
await page.click('.allergy summary');
await page.click('#allergy-chips [data-a="우유"]');
await page.waitForTimeout(500);
await page.reload();
await page.waitForTimeout(800);
ok('11 동의 켜면 → 새로고침해도 (우유)', (await text('#allergy-count')).includes('우유'));
await tab(page, 'taste');
await page.click('#set-allergy');
await page.reload();
await page.waitForTimeout(800);
ok('11 끄면 → (우유) 사라짐', !(await text('#allergy-count')).includes('우유'));

// 12
await page.click('#use-gps');
await waitMenus(page);
await idle(page);
await page.click('.allergy summary');
await page.click('#allergy-chips [data-a="우유"]');
await idle(page);
await page.click('[data-kind="SANDWICH"]');
await idle(page);
await page.waitForTimeout(500);
await page.locator('#menu-list .menu .actions .btn-primary').first().click();
await page.waitForSelector('#sheet .sheet', { state: 'attached' });
const cheeseSet = page.locator('#options fieldset').filter({ hasText: '치즈' });
for (const c of ['아메리칸 치즈', '슈레드 치즈', '모차렐라 치즈']) {
  const b = cheeseSet.locator('button', { hasText: c });
  ok(`12 ${c} "우유 들어 있음" + 빨간 바탕`, ((await b.textContent()) ?? '').includes('우유 들어 있음') && (await b.evaluate((x) => x.classList.contains('allergy-hit'))));
}
const breads = page.locator('#options fieldset').filter({ hasText: '빵' }).first().locator('button');
const breadTexts = await breads.allTextContents();
ok('12 파마산 오레가노·플랫브레드 "우유 들어 있음"', breadTexts.filter((t) => /파마산|플랫/.test(t)).every((t) => t.includes('우유 들어 있음')), breadTexts.join(' / '));
ok('12 나머지 빵 "우유 ★"', breadTexts.filter((t) => !/파마산|플랫/.test(t)).every((t) => t.includes('우유 ★')), breadTexts.join(' / '));
ok('12 노란 경고 (위트빵 ★)', (await page.locator('#sheet-allergy.warn').count()) === 1 && (await text('#sheet-allergy')).startsWith('⚠ 고른 알레르기 우유가 들어 있을 수 있어요 (★)'), await text('#sheet-allergy'));
await cheeseSet.locator('button', { hasText: '아메리칸 치즈' }).click();
await page.waitForSelector('#sheet-allergy.bad');
ok('12 치즈 눌림(막지 않음)', (await cheeseSet.locator('button', { hasText: '아메리칸 치즈' }).getAttribute('aria-pressed')) === 'true');
ok('12 빨간 경고 문구', (await text('#sheet-allergy')) === '⚠ 고른 알레르기 우유가 들어 있어요. 메뉴나 재료를 바꿔 주세요', await text('#sheet-allergy'));
await orderGo(page);
await page.click('#order-confirm');
ok('12 주문서 글 알레르기 줄', (await page.inputValue('#order-text')).trim().endsWith('※ 우유 알레르기가 있어요. 재료 확인 부탁드려요'));
await closeCart(page);
await cheeseSet.locator('button').first().click();
await page.waitForSelector('#sheet-allergy.warn');
ok('12 치즈 없음 → 노란 경고로', (await page.locator('#sheet-allergy.warn').count()) === 1);

// 13
await page.click('#allergy-chips [data-a="우유"]');
await idle(page);
await page.click('[data-kind="SANDWICH"]');
await idle(page);
await page.click('#spicy');
await idle(page);
await page.waitForTimeout(500);
const top = (await page.locator('#menu-list .menu h3').allTextContents()).join(',');
ok('13 Top3에 스파이시 없음', !/스파이시/.test(top), top);
ok('13 "매운 메뉴라서 뺐어요"', (await text('#rejected-list')).includes('매운 메뉴라서 뺐어요'));
await page.click('#spicy');
await idle(page);
await page.waitForTimeout(500);
ok('13 끄면 사라짐', !(await text('#rejected-list')).includes('매운 메뉴라서 뺐어요'));

// 14
ok('14 🎤 흐림(동의 필요)', await page.locator('#mic').evaluate((b) => b.classList.contains('needs-consent')));
await page.click('#mic');
ok('14 받아쓰기 안내(휴대폰·OpenAI) + [동의하고 켜기]', (await text('#talk-result')).includes('휴대폰 음성 인식') && (await text('#talk-result')).includes('OpenAI') && (await text('#talk-result')).includes('녹음은 저장하지 않아요') && (await page.locator('#talk-result button', { hasText: '동의하고 켜기' }).count()) === 1);
ok('14 녹음 안 함', !(await page.locator('#mic').evaluate((b) => b.classList.contains('rec'))));

// 15 (가짜 마이크: 삐 소리)
await page.locator('#talk-result button', { hasText: '동의하고 켜기' }).click();
await page.waitForTimeout(800);
ok('15 녹음 중 빨간 표시 + "듣고 있어요… 말을 멈추면 2초 뒤 저절로 보내요"', (await page.locator('#mic').evaluate((b) => b.classList.contains('rec'))) && (await text('#talk-result')).includes('듣고 있어요… 말을 멈추면 2초 뒤 저절로 보내요'));
// 10/22: 가짜 마이크는 삐 소리가 계속이라 조용해지지 않음 → 🎤를 다시 눌러 끝 (조용하면 끝나는 것은 scripts/mic-check.ts)
await page.waitForTimeout(2000);
await page.click('#mic');
await page.waitForTimeout(500);
ok('15 🎤 다시 누르면 끝', !(await page.locator('#mic').evaluate((b) => b.classList.contains('rec'))));
await idle(page);
ok('15 끝난 뒤 안내 또는 글 (멈추지 않음)', (await text('#talk-result')).length > 0, (await text('#talk-result')).slice(0, 50));

// 16
await ctx.setOffline(true);
await page.waitForTimeout(500);
ok('16 끊김 띠', (await page.locator('#offline').isVisible()) && (await text('#offline')) === '인터넷이 끊겼어요. 화면은 그대로 두고, 다시 연결되면 이어서 할 수 있어요');
ok('16 화면 그대로', (await page.locator('#menu-list .menu').count()) === 3 && (await page.locator('#sheet .sheet').count()) === 1);
await page.fill('#talk-input', '가볍게');
await page.click('#talk-send');
await page.waitForTimeout(1000);
ok('16 "인터넷 연결을 확인하고 다시 시도해 주세요" + 글 그대로', (await text('#talk-result')).includes('인터넷 연결을 확인하고 다시 시도해 주세요') && (await page.inputValue('#talk-input')) === '가볍게');
await ctx.setOffline(false);
await page.waitForTimeout(500);
await page.click('#talk-send');
await idle(page);
await page.waitForTimeout(500);
ok('16 다시 연결 → 띠 사라짐 + "가벼운 쪽 (열량 낮게)"', !(await page.locator('#offline').isVisible()) && (await text('#talk-result')).includes('가벼운 쪽 (열량 낮게)'));

// 17
await tab(page, 'taste');
await page.locator('#settings-body button', { hasText: '내 기록 전부 지우기' }).click();
const setChecks = await page.locator('#settings-body [data-consent]').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).checked));
ok('17 체크 4개 꺼짐', setChecks.every((c) => !c), JSON.stringify(setChecks));
await page.reload();
await page.waitForTimeout(800);
ok('17 새로고침 뒤 내 주문 없음·알레르기 없음', !(await page.locator('#my-orders').isVisible()) && !(await text('#allergy-count')).includes('우유'));

// 일부러 만든 실패는 뺀다: 가짜 마이크 삐 소리를 못 알아들음(502), 비행기 모드 중 요청
const unexpected = errors.filter((e) => !/status of 502|ERR_INTERNET_DISCONNECTED/.test(e));
ok('화면 오류(콘솔) 없음 (일부러 만든 실패 빼고)', !unexpected.length, unexpected.join(' | ').slice(0, 200));
const failed = out.filter((x) => x.startsWith('BAD')).length;
console.log(out.join('\n'));
console.log(`\n${out.filter((x) => x.startsWith('OK')).length} / ${out.length}`);
await browser.close();
process.exit(failed ? 1 : 0);
