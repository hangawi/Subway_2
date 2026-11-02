// 화면 점검 (여러 상황): 실제 주소에서 눌러 보며 이상한 동작을 찾는다.
// 실행: npx tsx scripts/screens-audit.ts https://subway.metasolveai.com [저장 폴더]
import { chromium, type Page } from '@playwright/test';
import { tab, waitMenus, orderGo, closeCart } from './ui-helpers.ts';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
const out = process.argv[3] ?? 'var/audit';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = '') => results.push([name, ok, detail]);

async function open(opts: { width?: number; geo?: boolean } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR',
    ...(opts.geo === false ? {} : { geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(base);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}
const idle = (p: Page) => p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });
const busyVisible = (p: Page) => p.locator('#busy').isVisible();
const wide = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth);

// 1. 장소 직접 입력 (여러 곳 → 고르기)
{
  const { ctx, page, errors } = await open();
  await page.fill('#place-input', '강남역');
  await page.click('#place-form button');
  await idle(page);
  await page.waitForTimeout(300);
  const txt = (await page.textContent('#loc-result')) ?? '';
  check('직접 입력 "강남역" → 고르기 목록', txt.includes('어느 곳인가요'), txt.slice(0, 60));
  const picks = page.locator('#loc-result .pick');
  if (await picks.count()) {
    await picks.first().click();
    await idle(page);
    await page.waitForTimeout(500);
    check('고른 뒤 매장·메뉴', (await page.locator('#menu-list .menu').count()) === 3, `menus=${await page.locator('#menu-list .menu').count()}`);
    check('상단 "지금 … · 강남역"', ((await page.textContent('#now')) ?? '').includes('강남역'), (await page.textContent('#now')) ?? '');
  }
  check('오류 없음 (직접 입력)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/1-place.png`, fullPage: true });
  await ctx.close();
}
// 2. 없는 장소
{
  const { ctx, page } = await open();
  await page.fill('#place-input', '없는곳가나다라');
  await page.click('#place-form button');
  await idle(page);
  await page.waitForTimeout(300);
  check('없는 장소 → 안내', ((await page.textContent('#loc-result')) ?? '').includes('역 이름이나 동 이름'), (await page.textContent('#loc-result')) ?? '');
  await ctx.close();
}
// 3. 위치 거부
{
  const { ctx, page } = await open({ geo: false });
  await page.click('#use-gps');
  await page.waitForTimeout(3000);
  await idle(page);
  check('위치 거부 → 직접 입력 안내', ((await page.textContent('#loc-result')) ?? '').includes('직접 입력'), (await page.textContent('#loc-result')) ?? '');
  check('위치 거부 → 찾고 있어요 사라짐', !(await busyVisible(page)));
  await ctx.close();
}
// 4. 위치 → 조건 버튼들 → 샐러드 고르기 → 옵션 (빵 없음·소스 3개 제한)
{
  const { ctx, page, errors } = await open();
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  await page.click('[data-kind="SALAD"]');
  await idle(page);
  await page.waitForTimeout(500);
  const names = await page.locator('#menu-list .menu h3').allTextContents();
  check('샐러드만 → 샐러드', names.length > 0 && names.every((n) => n.includes('샐러드')), names.join(', '));
  await page.click('#menu-list .menu .actions .btn-primary');
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  const legends = await page.locator('#options legend').allTextContents();
  check('샐러드 옵션: 빵·치즈·야채 없음', !legends.some((l) => /빵|치즈|야채/.test(l)), legends.join(','));
  const sauce = page.locator('#options fieldset').filter({ hasText: '소스' }).locator('button');
  for (let i = 0; i < 4; i++) await sauce.nth(i).click();
  await page.waitForTimeout(600);
  const pressed = await page.locator('#options fieldset').filter({ hasText: '소스' }).locator('button[aria-pressed="true"]').count();
  check('소스는 3개까지만', pressed === 3, `pressed=${pressed}`);
  // 알레르기 칩
  await page.click('.allergy summary');
  await page.click('#allergy-chips [data-a="우유"]');
  await idle(page);
  await page.waitForTimeout(500);
  check('알레르기 칩 → 개수 표시', ((await page.textContent('#allergy-count')) ?? '').includes('우유'));
  check('오류 없음 (조건·샐러드)', !errors.length, errors.join(' | '));
  check('넘침 없음 360', (await wide(page)) <= 360, String(await wide(page)));
  await page.screenshot({ path: `${out}/4-salad.png`, fullPage: true });
  await ctx.close();
}
// 5. 샌드위치 30cm·토핑·세트 → 금액
{
  const { ctx, page, errors } = await open();
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  await page.click('[data-kind="SANDWICH"]');
  await idle(page);
  await page.waitForTimeout(500);
  await page.click('#menu-list .menu .actions .btn-primary');
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  const before = (await page.textContent('#sheet .total')) ?? '';
  await page.locator('#options button', { hasText: '30cm' }).click();
  await page.waitForTimeout(600);
  const after = (await page.textContent('#sheet .total')) ?? '';
  check('30cm → 금액 바뀜', before !== after, `${before} → ${after}`);
  check('30cm → 열량 추정', ((await page.textContent('#sheet')) ?? '').includes('추정'));
  await page.locator('#options button', { hasText: '쿠키 음료 세트' }).click();
  await page.waitForTimeout(600);
  check('세트 → 주문서에 세트', ((await page.textContent('#sheet')) ?? '').includes('쿠키 음료 세트'));
  check('오류 없음 (샌드위치)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/5-sandwich.png`, fullPage: true });
  await ctx.close();
}
// 6. 말: 거절·질문·메뉴 없이 옵션·이어 말하기·비교·왜
{
  const { ctx, page, errors } = await open();
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  const say = async (t: string) => {
    await page.fill('#talk-input', t);
    await page.click('#talk-send');
    await idle(page);
    await page.waitForTimeout(400);
    return (await page.textContent('#talk-result')) ?? '';
  };
  check('말: 배달 → 거절', (await say('배달해줘')).includes('배달'));
  check('말: 빵 바꿔 → 질문', (await say('빵 바꿔줘')).includes('어떤 걸로'));
  // 10/16부터: 메뉴를 안 말하면 1위를 골라 두고 그 메뉴에 옵션을 적용 ("먼저 메뉴를 골라 주세요" 대신)
  const said = await say('소스 빼 줘');
  await page.waitForTimeout(800);
  // 10/21: 메뉴를 안 말하면 ③에서 멈추고, 고른 메뉴에 소스 빼기를 넣음
  check('말: 옵션만 → ③에서 멈추고 "소스 빼기도 넣어 드려요"', !said.includes('먼저 메뉴') && said.includes('소스 빼기도 넣어 드려요') && (await page.locator('#step-order').isHidden()));
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  await page.waitForTimeout(800);
  check('말: 1위를 고르면 소스 빼기가 들어감', ((await page.locator('#sheet dt', { hasText: '소스' }).locator('xpath=following-sibling::dd[1]').textContent()) ?? '') === '없음');
  await say('로티 허니오트로');
  check('말: 메뉴+빵 → 주문서', ((await page.textContent('#sheet')) ?? '').includes('허니오트'), ((await page.textContent('#picked')) ?? ''));
  await say('아까 거기서 소스만 랜치로');
  check('말: 이어 말하기 → 빵 유지 + 소스', /허니오트/.test((await page.textContent('#sheet')) ?? '') && /랜치/.test((await page.textContent('#sheet')) ?? ''));
  await say('1번이랑 2번 비교');
  check('말: 비교 → 비교 글', ((await page.textContent('#compare-result')) ?? '').length > 5);
  await say('왜 이거야?');
  check('말: 왜 → 점수 펼침', await page.locator('#menu-list .parts').first().isVisible());
  check('말 다 끝나면 찾고 있어요 사라짐', !(await busyVisible(page)));
  check('오류 없음 (말)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/6-talk.png`, fullPage: true });
  await ctx.close();
}
// 7. 320px 화면
{
  const { ctx, page } = await open({ width: 320 });
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  await page.click('#menu-list .menu .actions .btn-primary');
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  check('넘침 없음 320', (await wide(page)) <= 320, String(await wide(page)));
  await page.screenshot({ path: `${out}/7-320.png`, fullPage: true });
  await ctx.close();
}
// 8. 서버가 끊기면 (찾고 있어요가 멈춰 있지 않은지)
{
  const { ctx, page } = await open();
  await page.route('**/api/menus/recommend', (r) => r.abort());
  await page.click('#use-gps');
  await page.waitForTimeout(3000);
  check('연결 끊김 → 찾고 있어요 사라짐', !(await busyVisible(page)));
  check('연결 끊김 → 안내', ((await page.textContent('body')) ?? '').includes('다시 시도'));
  await ctx.close();
}
// 10. 처음 동의 → 주문서 넘겨주기 ([확인] 전엔 아무것도 안 나감) → 주문 기록 → 지우기·동의 끄기 (10/15)
{
  const { ctx, page, errors } = await open();
  await ctx.grantPermissions(['geolocation', 'clipboard-read', 'clipboard-write'], { origin: base });
  check('처음 동의 안내 보임', await page.locator('#onboard').isVisible());
  await page.click('#ob-orders');
  await page.click('#onboard-done');
  check('이대로 시작 → 안내 닫힘', !(await page.locator('#onboard').isVisible()));
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  await page.click('#menu-list .menu .actions .btn-primary');
  await page.waitForSelector('#order-go', { state: 'attached' });
  await orderGo(page);
  check('[확인] 전: 주문서 글·복사 없음', (await page.locator('#order-text, #order-copy').count()) === 0);
  await page.click('#order-confirm');
  const text = await page.inputValue('#order-text');
  check('[확인] 뒤: 주문서 글 (매장·참고 금액)', text.startsWith('[써브웨이 주문서]') && text.includes('참고 금액'), text.split('\n')[0] ?? '');
  check('길찾기 링크', ((await page.getAttribute('#order-map', 'href')) ?? '').startsWith('https://map.kakao.com/link/to/'));
  const tel = await page.locator('#order-tel').count();
  check('전화: 번호 있으면 tel:, 없으면 숨김', tel === 0 || ((await page.getAttribute('#order-tel', 'href')) ?? '').startsWith('tel:'));
  await page.click('#order-copy');
  await page.waitForTimeout(300);
  check('주문서 복사 → 안내', ((await page.textContent('#handoff')) ?? '').includes('복사'));
  await page.waitForSelector('#order-recorded');
  await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
  check('[확인] → 바로 내 주문 1개 (10/22)', (await page.locator('#order-list li').count()) === 1);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('subway.v1') ?? '{}'));
  check('기록: account_id 빈 칸·동의 목적', saved.orders?.[0]?.account_id === null && saved.consents?.orders?.purpose === 'subway_food_recommendation');
  await page.reload();
  await page.waitForTimeout(800);
  check('다시 열어도 기록 유지·안내 안 뜸', (await page.locator('#order-list li').count()) === 1 && !(await page.locator('#onboard').isVisible()));
  await tab(page, 'taste');
  await page.click('#set-orders');
  await tab(page, 'order');
  check('주문 기록 동의 끄면 기록 지움', !(await page.locator('#my-orders').isVisible()) && (await page.evaluate(() => JSON.parse(localStorage.getItem('subway.v1') ?? '{}').orders.length)) === 0);
  check('오류 없음 (넘겨주기·기록)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/10-handoff.png`, fullPage: true });
  await ctx.close();
}
// 11. 🎤 동의 없으면 녹음 안 함, 인터넷 끊김 안내 + 글 유지 (10/15)
{
  const { ctx, page } = await open();
  const mic = page.locator('#mic');
  if (await mic.isVisible()) {
    await mic.click();
    check('🎤 동의 전: 외부 AI 안내만 (녹음 안 함)', ((await page.textContent('#talk-result')) ?? '').includes('OpenAI') && !(await mic.evaluate((b) => b.classList.contains('rec'))));
  } else check('🎤 버튼 (음성 준비됨)', false, 'voice off');
  await ctx.setOffline(true);
  await page.fill('#talk-input', '단백질 많이');
  await page.click('#talk-send');
  await page.waitForTimeout(1000);
  check('끊김 → 위 안내 띠 + 쓴 글 그대로', (await page.locator('#offline').isVisible()) && (await page.inputValue('#talk-input')) === '단백질 많이');
  await ctx.setOffline(false);
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(500);
  check('다시 연결 → 띠 사라지고 이어서', !(await page.locator('#offline').isVisible()) && ((await page.textContent('#talk-result')) ?? '').includes('단백질'));
  await ctx.close();
}
// 12. 우유 알레르기 → 옵션에 "우유 들어 있음", 치즈 넣으면 빨간 경고, 주문서 글에 알레르기 알림 (10/15 점검)
{
  const { ctx, page, errors } = await open();
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  await page.click('.allergy summary');
  await page.click('#allergy-chips [data-a="우유"]');
  await idle(page);
  await page.waitForTimeout(500);
  await page.click('[data-kind="SANDWICH"]');
  await idle(page);
  await page.waitForTimeout(500);
  await page.click('#menu-list .menu .actions .btn-primary');
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  const cheese = page.locator('#options fieldset').filter({ hasText: '치즈' }).locator('button', { hasText: '아메리칸 치즈' });
  check('우유 알레르기: 치즈 버튼에 "우유 들어 있음"', ((await cheese.textContent()) ?? '').includes('우유 들어 있음'));
  await cheese.click();
  await page.waitForSelector('#sheet-allergy.bad', { timeout: 10000 }).catch(() => undefined);
  check('치즈 넣으면 주문서에 빨간 경고', ((await page.locator('#sheet-allergy.bad').textContent().catch(() => '')) ?? '').includes('우유가 들어 있어요'));
  await orderGo(page);
  await page.click('#order-confirm');
  check('주문서 글에 "우유 알레르기가 있어요"', (await page.inputValue('#order-text')).includes('우유 알레르기가 있어요'));
  check('오류 없음 (알레르기 표시)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/12-allergy.png`, fullPage: true });
  await ctx.close();
}
// 13. 매운 것 빼기 → 스파이시 메뉴가 뺀 메뉴로 (10/15 점검: 서버가 값을 버리던 문제)
{
  const { ctx, page } = await open();
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  await page.click('#spicy');
  await idle(page);
  await page.waitForTimeout(500);
  const rejected = (await page.textContent('#rejected-list')) ?? '';
  const top = (await page.locator('#menu-list .menu h3').allTextContents()).join(',');
  check('매운 것 빼기 → "매운 메뉴라서 뺐어요", Top3에 스파이시 없음', rejected.includes('매운 메뉴라서 뺐어요') && !/스파이시/.test(top), top);
  await ctx.close();
}
// 14. 카카오톡 안 브라우저 흉내 → Chrome으로 옮기기 시도, 안 열리면 안내가 남고 앱은 그대로 동작 (10/16)
{
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR',
    userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 KAKAOTALK 10.5.0',
    geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'],
  });
  const page = await ctx.newPage();
  const tried: string[] = [];
  page.on('request', (r) => /^(intent|kakaotalk|googlechromes?):/.test(r.url()) && tried.push(r.url()));
  page.on('framenavigated', (f) => /^(intent|kakaotalk):/.test(f.url()) && tried.push(f.url()));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForTimeout(2500);
  check('카카오톡: Chrome으로 옮기기 시도', tried.some((u) => u.startsWith('intent://')), tried.join(' ').slice(0, 80));
  check('카카오톡: 안 열리면 안내 [Chrome에서 열기]', await page.locator('#kakao-guide').isVisible() && (await page.locator('#kakao-open').count()) === 1);
  await page.click('#onboard-done');
  await page.click('#use-gps');
  await waitMenus(page);
  check('카카오톡: 안내가 있어도 앱은 그대로 (메뉴 3개)', (await page.locator('#menu-list .menu').count()) === 3);
  await page.click('#kakao-stay');
  await page.reload();
  await page.waitForTimeout(800);
  check('카카오톡: [안에서 계속] 고르면 다시 안 뜸', !(await page.locator('#kakao-guide').isVisible()));
  check('카카오톡: 오류 없음', !errors.length, errors.join(' | '));
  await ctx.close();
}
{
  const { ctx, page } = await open();
  check('일반 브라우저: 카카오톡 안내 없음', !(await page.locator('#kakao-guide').isVisible()));
  await ctx.close();
}
// 15. 맨 위 설치 안내 (10/16): 아이폰 "홈 화면에 추가하기", 안드로이드 [앱 설치], 설치한 앱으로 열면 안 보임
{
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', userAgent: IPHONE });
  let p = await ios.newPage();
  await p.goto(base);
  await p.waitForTimeout(600);
  check('아이폰: "홈 화면에 추가하기" 안내', (await p.locator('#install-bar').isVisible()) && ((await p.textContent('#install-text')) ?? '').includes('홈 화면에 추가'));
  check('아이폰: [앱 설치] 버튼은 없음', !(await p.locator('#install-go').isVisible()));
  await p.click('#install-close');
  await p.reload();
  await p.waitForTimeout(600);
  check('아이폰: 닫으면 다시 안 뜸', !(await p.locator('#install-bar').isVisible()));
  await ios.close();
  // 홈 화면 앱으로 연 아이폰 (navigator.standalone = true 흉내)
  const home = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, userAgent: IPHONE });
  // SOPHIA e2e와 같은 흉내 (value 방식 — get 함수 방식은 tsx가 넣는 __name 때문에 화면 안에서 깨짐)
  await home.addInitScript(() => Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true }));
  p = await home.newPage();
  await p.goto(base);
  await p.waitForTimeout(600);
  check('아이폰 홈 화면 앱으로 열면 안내 없음', !(await p.locator('#install-bar').isVisible()));
  await home.close();
  // 안드로이드: 브라우저가 설치를 허락했다고 흉내 (beforeinstallprompt) → 버튼 → 설치 → 버튼 사라짐
  const { ctx, page } = await open();
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    e.prompt = async () => undefined;
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    dispatchEvent(e);
  });
  await page.waitForTimeout(200);
  check('안드로이드: [앱 설치] 버튼', await page.locator('#install-go').isVisible());
  await page.click('#install-go');
  await page.waitForTimeout(300);
  check('안드로이드: 설치 뒤 버튼 사라지고 "설치됐어요"', !(await page.locator('#install-go').isVisible()) && ((await page.textContent('#install-text')) ?? '').includes('설치됐어요'));
  await ctx.close();
  const icons = await Promise.all(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'].map((u) => fetch(base + u).then((r) => r.status + ' ' + r.headers.get('content-type'))));
  check('앱 아이콘 PNG 3개', icons.every((x) => x.startsWith('200 image/png')), icons.join(', '));
  const mf = await fetch(base + '/manifest.webmanifest').then((r) => r.json());
  check('설치 정보: 192·512 PNG 아이콘, standalone', mf.display === 'standalone' && ['192x192', '512x512'].every((s: string) => mf.icons.some((i: { sizes: string; type: string }) => i.sizes === s && i.type === 'image/png')));
}
// 16. 화면 순서 (10/16): ① 어디서 드세요?가 맨 위, 말 입력칸은 조건 칸 안. 위치 전에 조건만 넣으면 안내
{
  const { ctx, page } = await open();
  // 화면 안에서 도는 코드라 안쪽 함수를 만들지 않음 (tsx가 넣는 __name이 화면에는 없음)
  const order = await page.evaluate(() => ({
    loc: document.getElementById('step-location')!.getBoundingClientRect().top,
    cond: document.getElementById('conditions')!.getBoundingClientRect().top,
    talk: document.getElementById('talk-form')!.getBoundingClientRect().top,
    inCond: !!document.querySelector('#conditions #talk-form'),
  }));
  check('① 어디서 드세요?가 조건보다 위', order.loc < order.cond && order.loc < order.talk);
  check('말 입력칸은 조건 칸 안', order.inCond);
  await page.click('[data-goal="PROTEIN"]');
  check('위치 전에 조건 → "조건을 기억했어요…"', await page.locator('#cond-hint').isVisible());
  await page.click('#use-gps');
  await waitMenus(page);
  await idle(page);
  check('위치 정하면 안내 사라지고 그 조건으로 추천', !(await page.locator('#cond-hint').isVisible()) && (await page.locator('[data-goal="PROTEIN"]').getAttribute('aria-pressed')) === 'true');
  // 10/21 순서: ① 위치 → ② 매장 → 조건 → ③ 추천 메뉴
  const tops = await page.evaluate(() => ['step-location', 'step-store', 'conditions', 'step-menu'].map((id) => document.getElementById(id)!.getBoundingClientRect().top));
  check('순서: ① 위치 → ② 매장 → 조건 → ③ 추천 메뉴', tops.every((t, i) => i === 0 || tops[i - 1]! < t), tops.map(Math.round).join(' < '));
  await ctx.close();
}
// 17. 표시·안내 (10/16 B-3) + 처음 동의 뒤 위치 자동
{
  const { ctx, page } = await open();
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  check('동의 뒤 버튼 안 눌러도 지금 위치로 추천', (await page.locator('#menu-list .menu').count()) === 3);
  check('Why? 버튼', ((await page.locator('#menu-list .menu .actions button').first().textContent()) ?? '') === 'Why?');
  await page.click('#spicy');
  await idle(page);
  await page.waitForTimeout(400);
  check('추천 위 "매운 것 빼기로 N개 … 뺐어요"', /매운 것 빼기로 \d+개.*뺐어요/.test((await page.textContent('#rejected-summary')) ?? ''), (await page.textContent('#rejected-summary')) ?? '');
  await page.click('#spicy');
  await idle(page);
  // 예산 7,000원 + 샌드위치 + 세트 → 합계가 예산을 넘으면 경고
  await page.selectOption('#budget', '7000');
  await idle(page);
  await page.click('[data-kind="SANDWICH"]');
  await idle(page);
  await page.waitForTimeout(400);
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  await page.locator('#options button', { hasText: '쿠키 음료 세트' }).click();
  await page.waitForSelector('#sheet-budget', { timeout: 10000 }).catch(() => undefined);
  check('세트로 예산을 넘으면 "예산 … 넘어요"', /예산 7,000원보다 [\d,]+원 넘어요/.test((await page.textContent('#sheet-budget').catch(() => '')) ?? ''));
  const sizes = await page.locator('#options fieldset').filter({ hasText: '크기' }).textContent();
  check('크기: 30cm 버튼 또는 "15cm만 있어요"', /30cm|15cm만 있어요/.test(sizes ?? ''), (sizes ?? '').slice(0, 30));
  // 샐러드 안내
  await page.click('[data-kind="SANDWICH"]');
  await page.click('[data-kind="SALAD"]');
  await page.selectOption('#budget', '');
  await idle(page);
  await page.waitForTimeout(400);
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  check('샐러드: "빵·치즈·야채가 정해져 있어요"', ((await page.textContent('#options')) ?? '').includes('샐러드는 빵·치즈·야채가 정해져 있어요'));
  // 지울 기록이 없으면 묻지 않음
  let asked = false;
  page.on('dialog', (d) => {
    asked = true;
    void d.dismiss();
  });
  await tab(page, 'taste');
  await page.locator('#clear-all').click();
  await page.waitForTimeout(200);
  check('기록이 없으면 묻지 않고 "지울 기록이 없어요"', !asked && ((await page.textContent('#clear-result')) ?? '') === '지울 기록이 없어요');
  await ctx.close();
}
// 18. 알레르기 두 묶음 (10/16 B-1): 토마토 → 샌드위치는 남고, 고르면 토마토가 자동으로 빠지고 알림
{
  const { ctx, page } = await open();
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  await page.click('.allergy summary');
  check('알레르기 두 묶음 (고기·해산물 / 그 밖 재료)', ((await page.textContent('#allergy-chips')) ?? '').includes('고기·해산물') && ((await page.textContent('#allergy-chips')) ?? '').includes('그 밖 재료'));
  await page.click('#allergy-chips [data-a="토마토"]');
  await idle(page);
  await page.click('[data-kind="SANDWICH"]');
  await idle(page);
  await page.waitForTimeout(400);
  check('토마토 알레르기여도 샌드위치 추천이 나옴', (await page.locator('#menu-list .menu').count()) > 0);
  check('추천 카드에 "토마토를 뺐어요"', ((await page.textContent('#menu-list .menu')) ?? '').includes('토마토 알레르기라서 토마토를 뺐어요'));
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('[data-allergy-note]', { timeout: 10000 }).catch(() => undefined);
  const tomato = page.locator('#options fieldset').filter({ hasText: '누르면 빼기' }).locator('button', { hasText: '토마토' });
  check('고르면 야채 빼기에 토마토가 자동으로 빠짐', (await tomato.getAttribute('aria-pressed')) === 'false');
  check('주문서에 "✓ 토마토 알레르기라서 토마토를 뺐어요"', ((await page.textContent('#line-notes')) ?? '').includes('토마토 알레르기라서 토마토를 뺐어요'));
  // 야채 줄에는 "토마토 빼기"가 있으니 알레르기 줄(dt 다음 dd)만 본다
  const allergyRow = await page.locator('#sheet dt', { hasText: '알레르기' }).locator('xpath=following-sibling::dd[1]').textContent();
  check('주문서 알레르기 줄에 토마토 없음, 야채 줄에 "토마토 빼기"', !(allergyRow ?? '').includes('토마토') && ((await page.locator('#sheet dl').textContent()) ?? '').includes('토마토 빼기'), allergyRow ?? '');
  await ctx.close();
}
// 19. 한 번에 말하기 (10/16 B-2): 장소·메뉴·옵션·알레르기가 버튼에 다 채워지고, 말 안 한 메뉴는 1위 + "AI가 추천했어요!"
{
  const { ctx, page, errors } = await open();
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  check('🎤가 ② 보내기 옆 (음성 준비됐을 때, 10/22)', (await page.locator('#talk-form #mic').count()) === 1);
  await page.fill('#talk-input', '강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(500);
  check('말한 장소가 장소 칸에', (await page.inputValue('#place-input')) === '강남역');
  const picks = page.locator('#loc-result .pick');
  if (await picks.count()) {
    await picks.first().click();
    await idle(page);
  }
  await page.waitForSelector('#sheet .sheet', { state: 'attached', timeout: 30000 });
  await page.waitForTimeout(800);
  check('말한 메뉴 로스트 치킨이 골라짐', ((await page.textContent('#picked')) ?? '').startsWith('로스트 치킨') && !((await page.textContent('#picked')) ?? '').includes('AI가 추천'));
  const veg = page.locator('#options fieldset').filter({ hasText: '누르면 빼기' });
  check('양파 빼기가 눌림', (await veg.locator('button', { hasText: '양파' }).getAttribute('aria-pressed')) === 'false');
  check('피클 더가 눌림', (await page.locator('#options fieldset').filter({ hasText: '야채 더 넣기' }).locator('button', { hasText: '피클 더' }).getAttribute('aria-pressed')) === 'true');
  check('우유 알레르기 버튼이 눌림', (await page.locator('#allergy-chips [data-a="우유"]').getAttribute('aria-pressed')) === 'true');
  // 메뉴를 안 말함 → 1위를 골라 두고 "AI가 추천했어요!"
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
  const p2 = await ctx2.newPage();
  await p2.goto(base);
  await p2.waitForTimeout(500);
  await p2.click('#onboard-done');
  await waitMenus(p2);
  await idle(p2);
  await p2.fill('#talk-input', '나 지금 배고픔 매운거 넣고 콜라는 제로콜라로 먹고 싶어 그리고 쇠고기 종류로 먹고싶은데 추천해줘바');
  await p2.click('#talk-send');
  await idle(p2);
  await p2.waitForTimeout(800);
  check('메뉴를 안 말하면 ③에서 멈춤 (1위를 알아서 안 고름)', await p2.locator('#step-order').isHidden());
  await p2.waitForTimeout(3500);
  check('Top3에 AI 한마디', (await p2.locator('#menu-list .ai-line:not([hidden])').count()) >= 1, String(await p2.locator('#menu-list .ai-line:not([hidden])').count()));
  await p2.locator('#menu-list .menu .actions .btn-primary').first().click();
  await p2.waitForSelector('#sheet .sheet', { state: 'attached' });
  await idle(p2);
  const picked = (await p2.textContent('#picked')) ?? '';
  check('쇠고기 메뉴가 골라짐 (맵게 만들 수 있는 샌드위치 — 랩은 구성이 정해져 안 됨)', /스테이크|비프/.test(picked) && !/랩/.test(picked), picked.slice(0, 20));
  check('든든하게 버튼이 눌림', (await p2.locator('[data-goal="FILLING"]').getAttribute('aria-pressed')) === 'true');
  const said = (await p2.textContent('#talk-result')) ?? '';
  check('알아들은 것: 매운 것 넣기·든든·쇠고기·제로콜라 단품 (10/19: 세트를 안 말하면 음료는 단품)', ['매운 것 넣기', '든든한 쪽', '쇠고기 메뉴로', '단품: 코카콜라 제로'].every((x) => said.includes(x)), said.slice(0, 80));
  check('주문서에 단품 코카콜라 제로', ((await p2.textContent('#sheet')) ?? '').includes('코카콜라 제로 (355ml)'));
  check('"먼저 메뉴를 골라 주세요"는 안 보임', !said.includes('먼저 메뉴를 골라 주세요'));
  check('오류 없음 (한 번에 말하기)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/19-one-shot.png`, fullPage: true });
  await p2.screenshot({ path: `${out}/19-ai-pick.png`, fullPage: true });
  await ctx2.close();
  await ctx.close();
}
// 20. 세트 자세히 (10/16 B-4): 쿠키 고르면 열량에 더함, 음료는 공식 자료대로 "매장에서 확인"
{
  const { ctx, page } = await open();
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  await page.click('[data-kind="SANDWICH"]');
  await idle(page);
  await page.waitForTimeout(400);
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  const kcalOf = async () => Number(((await page.locator('#sheet dt', { hasText: '열량' }).locator('xpath=following-sibling::dd[1]').textContent()) ?? '').replace(/[^0-9.]/g, '').replace(/\.$/, ''));
  const before = await kcalOf();
  await page.locator('#options button', { hasText: '쿠키 음료 세트' }).click();
  await page.waitForTimeout(600);
  check('쿠키 세트 → 쿠키 5가지 고르기', (await page.locator('#options fieldset').filter({ hasText: '쿠키 고르기' }).locator('button').count()) === 5);
  check('세트 음료 → "매장 기계 음료(16oz)" 안내', ((await page.textContent('#options')) ?? '').includes('세트 음료는 매장 기계 음료(16oz)예요'));
  await page.locator('#options fieldset').filter({ hasText: '쿠키 고르기' }).locator('button', { hasText: '초코칩' }).first().click();
  await page.waitForTimeout(600);
  const after = await kcalOf();
  check('초코칩을 고르면 열량 +228kcal', Math.round(after - before) === 228, `${before} → ${after}`);
  check('주문서 세트 줄에 초코칩', ((await page.locator('#sheet dt', { hasText: '세트' }).locator('xpath=following-sibling::dd[1]').textContent()) ?? '').includes('초코칩'));
  await ctx.close();
}
// 21. 개인화 (10/17): 취향 기억하기 동의·★ 즐겨찾기·주문 기록에서 배우기·평소처럼·지난번처럼·내 취향 지우기·피곤해
{
  const { ctx, page, errors } = await open();
  const consents = await page.locator('#onboard [data-consent]').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-consent')));
  check('처음 안내에 "취향 기억하기" 동의', consents.includes('taste'), consents.join(','));
  await page.check('#ob-orders');
  await page.check('#ob-taste');
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  await page.click('[data-kind="SANDWICH"]');
  await idle(page);
  await page.waitForTimeout(400);
  const first = ((await page.locator('#menu-list .menu h3').first().textContent()) ?? '').replace(/^\d/, '');
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  await page.locator('#options fieldset').filter({ hasText: '야채 (누르면 빼기)' }).locator('button', { hasText: '양파' }).click();
  await page.waitForTimeout(600);
  // ★ 즐겨찾기
  await page.click('#fav');
  await page.waitForTimeout(200);
  check('★ 누르면 내 주문에 즐겨찾기', ((await page.textContent('#fav-list')) ?? '').includes(first), ((await page.textContent('#fav-list')) ?? '').slice(0, 40));
  const orderOnce = async () => {
    await orderGo(page);
    await page.click('#order-confirm');
    await page.waitForSelector('#order-recorded');
    await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
    await page.waitForTimeout(200);
  };
  await orderOnce();
  // 다시 주문 → "지난 주문 그대로 불러왔어요" → 한 번 더 주문 (같은 메뉴 2번 = 자주 고른 메뉴)
  await closeCart(page);
  await page.locator('#order-list button', { hasText: '다시 주문' }).first().click();
  await page.waitForSelector('#line-notes [data-reorder-note]');
  check('다시 주문 → "지난 주문 그대로 불러왔어요"', ((await page.textContent('#line-notes')) ?? '').includes('지난 주문 그대로 불러왔어요'));
  check('다시 주문해도 양파 빼기 그대로', (await page.locator('#options fieldset').filter({ hasText: '야채 (누르면 빼기)' }).locator('button', { hasText: '양파' }).getAttribute('aria-pressed')) === 'false');
  await orderOnce();
  await idle(page);
  await page.waitForTimeout(400);
  check('내 취향에 "자주 고른 메뉴"', ((await page.textContent('#my-tastes')) ?? '').includes(`자주 고른 메뉴: ${first}`), ((await page.textContent('#my-tastes')) ?? '').slice(0, 60));
  check('내 취향에 "늘 양파 빼기"', ((await page.textContent('#my-tastes')) ?? '').includes('늘 양파 빼기'));
  check('추천 1위가 자주 고른 메뉴', ((await page.locator('#menu-list .menu h3').first().textContent()) ?? '').includes(first) && ((await page.textContent('#menu-list .menu')) ?? '').includes('자주 고른 메뉴예요'));
  // 평소처럼
  await page.locator('#menu-list .menu .actions .btn-primary').nth(1).click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  // 10/21부터: 말 안 한 옵션은 평소대로 자동으로 → "평소대로 넣었어요: 양파 빼기 [되돌리기]"
  await page.waitForTimeout(600);
  check('평소대로 → "평소대로 넣었어요: 양파 빼기"', ((await page.textContent('#usual-applied').catch(() => '')) ?? '').includes('양파 빼기'));
  check('평소대로 → 주문서에서 양파가 빠짐', ((await page.locator('#sheet dl').textContent()) ?? '').includes('양파'));
  await page.click('#usual-undo');
  await page.waitForTimeout(600);
  check('[되돌리기] → [평소처럼] 버튼이 다시 나옴', ((await page.textContent('#options .usual').catch(() => '')) ?? '').includes('양파 빼기'));
  // 말로 한 취향 → 저장 → 지우기
  await page.fill('#talk-input', '평소에 소고기 좋아해');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(400);
  check('"평소에 소고기 좋아해" → 내 취향에 저장', ((await page.textContent('#my-tastes')) ?? '').includes('평소 쇠고기 좋아함'));
  await tab(page, 'taste');
  await page.locator('#my-tastes li', { hasText: '평소 쇠고기 좋아함' }).locator('button').click();
  await tab(page, 'order');
  await page.waitForTimeout(300);
  check('하나 지우기', !((await page.textContent('#my-tastes')) ?? '').includes('평소 쇠고기 좋아함'));
  // 지난번처럼
  await page.fill('#talk-input', '지난번처럼 근데 피클 추가');
  await page.click('#talk-send');
  await page.waitForSelector('#line-notes [data-reorder-note]', { timeout: 30000 });
  await idle(page);
  await page.waitForTimeout(600);
  check('"지난번처럼" → 지난 메뉴가 골라짐', ((await page.textContent('#picked')) ?? '').startsWith(first), (await page.textContent('#picked')) ?? '');
  check('"지난번처럼 근데 피클 추가" → 피클 더까지', (await page.locator('#options fieldset').filter({ hasText: '야채 더 넣기' }).locator('button', { hasText: '피클 더' }).getAttribute('aria-pressed')) === 'true');
  check('"지난번처럼"에 "먼저 메뉴를 골라 주세요" 안 뜸', !((await page.textContent('#talk-result')) ?? '').includes('먼저 메뉴를 골라'));
  // 피곤해 → 다시 열어도 든든하게 (새벽 4시까지)
  await page.fill('#talk-input', '오늘 너무 피곤해');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(400);
  check('"피곤해" → 든든하게 + 내 취향 "오늘 피곤함"', (await page.locator('[data-goal="FILLING"]').getAttribute('aria-pressed')) === 'true' && ((await page.textContent('#my-tastes')) ?? '').includes('오늘 피곤함'));
  await page.reload();
  await page.waitForSelector('#tired-note', { timeout: 15000 });
  check('다시 열어도 피곤함 → 든든하게 (안내와 함께)', (await page.locator('[data-goal="FILLING"]').getAttribute('aria-pressed')) === 'true');
  await page.click('[data-goal="FILLING"]');
  await idle(page);
  await page.reload();
  await page.waitForTimeout(1500);
  check('[든든하게]를 끄면 다시 열어도 안 켜짐', (await page.locator('[data-goal="FILLING"]').getAttribute('aria-pressed')) === 'false' && !(await page.locator('#tired-note').count()));
  // 취향 전부 지우기 → 주문 기록에서 배운 것도 다시 안 배움
  page.once('dialog', (d) => void d.accept());
  await tab(page, 'taste');
  await page.click('#taste-clear');
  await page.waitForTimeout(300);
  check('취향 전부 지우기 → "아직 없어요"', ((await page.textContent('#my-tastes')) ?? '').includes('아직 없어요'));
  check('오류 없음 (개인화)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/21-taste.png`, fullPage: true });
  await ctx.close();
}
// 23. 메뉴 사진 (10/17, 2-7): 우리 서버의 공식 사진, 없으면 이름만
{
  const { ctx, page, errors } = await open();
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  await page.waitForTimeout(800);
  const imgs = await page.locator('#menu-list .menu img.menu-img').evaluateAll((xs) => xs.map((x) => ({ src: (x as HTMLImageElement).getAttribute('src') ?? '', ok: (x as HTMLImageElement).complete && (x as HTMLImageElement).naturalWidth > 0 })));
  check('추천 카드 3개 모두 사진', imgs.length === 3 && imgs.every((x) => x.ok), JSON.stringify(imgs).slice(0, 80));
  check('사진은 우리 서버 것 (/menu-img/)', imgs.every((x) => x.src.startsWith('/menu-img/')));
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached' });
  await page.waitForTimeout(500);
  check('주문서에도 사진', await page.locator('#sheet img.sheet-img').evaluate((x) => (x as HTMLImageElement).naturalWidth > 0).catch(() => false));
  const o = await (await fetch(base + '/api/options')).json();
  const noImg = (o.menus as Array<{ name: string; image: string | null }>).filter((m) => !m.image).map((m) => m.name);
  check('사진 없는 메뉴는 image: null (화면은 이름만) — 10/19 판매 끝난 3개를 빼서 지금은 0개', noImg.length <= 3, noImg.join(',') || '없음');
  const one = await fetch(base + (o.menus.find((m: { image: string | null }) => m.image).image as string));
  const size = (await one.arrayBuffer()).byteLength;
  check('사진 한 장 50KB 이하·webp', one.headers.get('content-type') === 'image/webp' && size <= 50 * 1024, `${Math.round(size / 1024)}KB`);
  check('넓이 넘침 없음 (사진)', (await wide(page)) <= 360, String(await wide(page)));
  check('오류 없음 (사진)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/23-photos.png`, fullPage: true });
  await ctx.close();
}
// 24. 개인정보 처리방침·내 정보 보기 (10/19)
{
  const { ctx, page, errors } = await open();
  check('처음 안내에 처리방침 링크', (await page.locator('#onboard a[href="/privacy.html"]').count()) === 1);
  await page.check('#ob-allergy');
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  await page.click('details.allergy summary');
  await page.click('#allergy-chips [data-a="우유"]');
  await idle(page);
  await tab(page, 'taste');
  await page.click('#my-data summary');
  const raw = (await page.textContent('#my-data .my-data-raw')) ?? '';
  check('내 정보 보기: 저장된 알레르기가 보임', raw.includes('"우유"') && ((await page.textContent('#my-data')) ?? '').includes('저장된 알레르기 1개'), raw.slice(0, 60));
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.click('#my-data-download')]);
  check('내 정보 파일로 내려받기', dl?.suggestedFilename() === 'subway-my-data.json', dl?.suggestedFilename() ?? '없음');
  await page.click('#privacy-link');
  await page.waitForLoadState();
  const body = (await page.textContent('body')) ?? '';
  check('처리방침 페이지: 위치 저장 안 함·받는 곳·지우기', body.includes('저장하지 않음') && body.includes('OpenAI') && body.includes('내 기록 전부 지우기'));
  check('처리방침 넓이 넘침 없음', (await wide(page)) <= 360, String(await wide(page)));
  check('오류 없음 (처리방침)', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/24-privacy.png`, fullPage: true });
  await ctx.close();
}
// 22. 취향 기억하기를 안 켰으면 이번에만
{
  const { ctx, page } = await open();
  await page.click('#onboard-done');
  await waitMenus(page);
  await idle(page);
  await page.fill('#talk-input', '평소에 새우 좋아해');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(400);
  check('동의 안 하면 "이번에만 반영해요"', ((await page.textContent('#talk-result')) ?? '').includes('이번에만 반영해요'));
  await page.fill('#talk-input', '지난번처럼');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(300);
  check('주문 기록이 꺼져 있으면 "지난 주문을 몰라요"', ((await page.textContent('#talk-result')) ?? '').includes('지난 주문을 몰라요'));
  await ctx.close();
}
// 9. 보안 헤더
{
  const r = await fetch(base);
  const csp = r.headers.get('content-security-policy') ?? '';
  check('마이크는 우리 화면만 (permissions-policy)', /microphone=\(self\)/.test(r.headers.get('permissions-policy') ?? ''));
  check('CSP: 우리 서버 것만 (외부 스크립트·글꼴 없음)', /default-src 'self'/.test(csp) && /script-src 'self'(?!.*unsafe)/.test(csp) && /frame-ancestors 'none'/.test(csp), csp.slice(0, 60));
  const trav = await fetch(base + '/%2e%2e/%2e%2e/package.json');
  check('폴더 밖 파일 못 읽음', trav.status === 404, String(trav.status));
  const sw = await fetch(base + '/sw.js');
  check('sw.js 200', sw.status === 200, String(sw.status));
  const mf = await fetch(base + '/manifest.webmanifest');
  check('manifest 200', mf.status === 200, String(mf.status));
}

// 30. 10/22 예형님 8가지: ③ 접기·잠금, 마지막 단품 빼기, 보내기 뒤 이동, 🎤 위치, 매장 버튼 한 줄, 이름, 안 고른 것
{
  const { ctx, page, errors } = await open();
  check('10/22 "현재 위치로 찾기"', ((await page.textContent('#use-gps')) ?? '').trim() === '현재 위치로 찾기');
  check('10/22 🎤는 ② 보내기 옆', (await page.locator('#talk-form #mic + #talk-send').count()) === 1 && (await page.locator('#step-location #mic').count()) === 0);
  await page.click('#onboard-done');
  await page.waitForSelector('#recs-gate:not([hidden])', { state: 'visible', timeout: 30000 });
  await idle(page);
  check('10/22 처음엔 ③ 추천 접힘', (await page.locator('#recs-body').isHidden()) && (await page.locator('#recs-gate').isVisible()));
  // 매장 카드 버튼 줄맞춤
  const boxes = await page.locator('#store-list .store').first().locator('.actions > *').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }));
  check('10/22 매장 버튼 한 줄·같은 높이', boxes.length >= 2 && boxes.every((b) => b[0] === boxes[0]![0] && b[1] === boxes[0]![1]), JSON.stringify(boxes));
  // 음료·사이드만: ③ 잠금
  await page.click('#singles-only');
  await page.waitForSelector('#step-order:not([hidden])');
  const inert = await page.evaluate(() => (document.getElementById('recs-body') as HTMLElement & { inert: boolean }).inert);
  check('10/22 음료·사이드만이면 ③ 못 누름 (inert)', inert && (await page.locator('#recs-unlock').isVisible()));
  // 음료 하나 담았다가 하나 빼기 → 비워짐
  await page.locator('#extras .chip').first().click();
  await page.waitForSelector('#extras .extras-qty .qty');
  await page.locator('#extras .extras-qty .qty').first().click();
  await page.waitForSelector('#sheet-empty', { timeout: 10000 }).catch(() => null);
  check('10/22 마지막 단품을 −로 뺄 수 있음', (await page.locator('#sheet-empty').count()) === 1 && (await page.locator('#extras .extras-qty').count()) === 0);
  // 잠금 풀기
  await page.click('#recs-unlock');
  const inert2 = await page.evaluate(() => (document.getElementById('recs-body') as HTMLElement & { inert: boolean }).inert);
  check('10/22 [샌드위치 고르기로 돌아가기] → ③ 다시 누름', !inert2 && !(await page.locator('#step-menu').evaluate((e) => e.classList.contains('dimmed'))) && (await page.locator('#recs-body').isVisible()));
  // 말하면 ③ 열리고 ③으로 이동
  await page.fill('#talk-input', '매운 걸로 추천해줘');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(1500);
  const top3 = await page.locator('#step-menu').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  check('10/22 보내기 → ③ 열림·③으로 이동', (await page.locator('#recs-body').isVisible()) && Math.abs(top3) < 120, String(top3));
  // 비교는 다시 누르면 닫힘
  if (await page.locator('#compare').isVisible()) {
    await page.click('#compare');
    const opened = (await page.locator('#compare-result .notice').count()) === 1 && ((await page.textContent('#compare')) ?? '').includes('닫기');
    await page.click('#compare');
    check('10/22 [1번이랑 2번 비교] 다시 누르면 닫힘', opened && (await page.locator('#compare-result .notice').count()) === 0 && ((await page.textContent('#compare')) ?? '').includes('1번이랑 2번'));
  } else check('10/22 [1번이랑 2번 비교] 다시 누르면 닫힘', false, '비교 버튼 없음');
  // 메뉴 고르면 안 고른 것 알림
  await page.locator('#menu-list .menu .actions .btn-primary').first().click();
  await page.waitForSelector('#sheet .sheet', { state: 'attached', timeout: 15000 });
  const miss = (await page.locator('#sheet-missing').textContent().catch(() => '')) ?? '';
  check('10/22 주문서에 "아직 안 고른 것" (막지 않음)', miss.includes('아직 안 고른 것') && (await page.locator('#sheet .total').count()) === 1, miss.slice(0, 80));
  // [이대로 주문하기] → [확인]에서 끝: 바로 기록, [이걸로 주문했어요] 없음
  await orderGo(page);
  await page.click('#order-confirm');
  await page.waitForSelector('#order-recorded', { timeout: 5000 }).catch(() => null);
  await closeCart(page); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
  check('10/22 [확인]에서 끝 ([이걸로 주문했어요] 없음, 동의 꺼짐이면 안내)', (await page.locator('#order-done').count()) === 0 && (await page.locator('#order-recorded').count()) === 1 && (await page.locator('#order-copy').count()) === 1, JSON.stringify([await page.locator('#order-done').count(), await page.locator('#order-recorded').textContent().catch(() => null), await page.locator('#order-list li').count(), await page.locator('#order-copy').count()]));
  // 장소를 말하면 ①로
  await page.fill('#talk-input', '역삼역에서 먹을래');
  await page.click('#talk-send');
  await idle(page);
  await page.waitForTimeout(1500);
  const top1 = await page.locator('#step-location').evaluate((e) => Math.round(e.getBoundingClientRect().top));
  check('10/22 장소를 말하면 ① 매장으로 이동', Math.abs(top1) < 120, String(top1));
  check('10/22 넓이 넘침 없음', (await wide(page)) <= 360, String(await wide(page)));
  check('10/22 오류 없음', !errors.length, errors.join(' | '));
  await page.screenshot({ path: `${out}/30-1022.png`, fullPage: true });
  await ctx.close();
}

for (const [n, ok, d] of results) console.log(`${ok ? '✅' : '❌'} ${n}${d ? `  — ${d}` : ''}`);
console.log(`통과 ${results.filter((r) => r[1]).length} / ${results.length}`);
await browser.close();
process.exit(0);
