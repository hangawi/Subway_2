// 휴대폰 폭 화면 확인 (Playwright): 위치 → 매장 → 말로 조건 → 메뉴 Top3 → 이걸로 → 말로 옵션 수정 → 주문서.
// 실행: 서버를 띄운 뒤 (npm run dev)  npx tsx scripts/screens.ts [주소] [저장 폴더]
// 360px에서 가로로 넘치는지, 흐름이 끝까지 가는지 확인하고 단계마다 스크린샷을 남긴다.
import { chromium } from '@playwright/test';
import { waitMenus } from './ui-helpers.ts';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
const out = process.argv[3] ?? 'var/screens';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
const page = await ctx.newPage();
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const overflow = async (step: string) => {
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  if (w > 360) errors.push(`${step}: 가로 넘침 ${w}px`);
};
const shot = async (n: string) => {
  await overflow(n);
  await page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
};

await page.goto(base);
await shot('1-start');
await page.click('#use-gps');
await page.waitForSelector('#store-list .store', { timeout: 30000 });
await waitMenus(page);
await shot('2-store-menu');
await page.fill('#talk-input', '만 원 이하, 단백질 많이');
await page.click('#talk-send');
await page.waitForSelector('#talk-result .tag');
await page.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'));
await shot('3-talk-menus');
await page.click('#menu-list .menu .actions .btn-primary');
await page.waitForSelector('#sheet .sheet');
await page.fill('#talk-input', '빵은 위트로, 소스 빼 줘, 양파 빼고');
await page.click('#talk-send');
await page.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'));
await page.waitForTimeout(800);
await shot('4-order-sheet');
const sheet = await page.textContent('#sheet');
// 일이 끝나면 '찾고 있어요'가 실제로 안 보여야 한다 (hidden 이어도 보이던 10/14 문제)
await page.waitForTimeout(500);
if (await page.locator('#busy').isVisible()) errors.push('찾고 있어요 표시가 안 사라짐');
const summary = {
  stores: await page.locator('#store-list .store').count(),
  menus: await page.locator('#menu-list .menu').count(),
  understood: await page.locator('#talk-result .tag').allTextContents(),
  sheetHasWheat: sheet?.includes('위트') ?? false,
  sheetNoSauce: /소스\s*없음/.test(sheet ?? ''),
  sheetOnionOut: sheet?.includes('양파 빼기') ?? false,
  errors,
};
console.log(JSON.stringify(summary, null, 1));
await browser.close();
process.exit(errors.length ? 1 : 0);
