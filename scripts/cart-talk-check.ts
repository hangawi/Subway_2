// 장바구니 말 100문장 (10/26 예형님): 여러 개 말투 80 + 한 사람 말 20 — 문장마다 빈 장바구니에서 말하고 줄 수를 본다
// 실행: npx tsx scripts/cart-talk-check.ts https://subway.metasolveai.com [--list]
import { chromium, type Page } from '@playwright/test';
import { waitMenus } from './ui-helpers.ts';
import { CART_CASES as cases } from './cart-talk-cases.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
const showAll = process.argv.includes('--list');

const browser = await browser0();
async function browser0() {
  return chromium.launch();
}
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
const idle = (q: Page) => q.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 60000 });
await p.goto(base);
await p.waitForTimeout(400);
await p.click('#onboard-done');
await waitMenus(p);
let pass = 0;
const bad: string[] = [];
for (const c of cases) {
  await p.evaluate(() => localStorage.removeItem('subway.cart'));
  await p.reload();
  await p.waitForTimeout(600);
  await waitMenus(p);
  await idle(p);
  await p.fill('#talk-input', c.text);
  await p.click('#talk-send');
  await idle(p);
  await p.waitForTimeout(700);
  await idle(p);
  const lines = await p.locator('#cart-body .cart-line').count();
  const badge = (await p.locator('#cart-count').isVisible()) ? Number(await p.textContent('#cart-count')) : 0;
  const good = c.single ? lines <= 1 : (lines === c.lines || lines === c.alt) && (c.qty === undefined || badge === c.qty);
  if (good) pass++;
  else bad.push(`${c.text} → ${lines}줄 (🛒${badge}) / 기대 ${c.lines}줄${c.qty ? ` 🛒${c.qty}` : ''}`);
  if (showAll) console.log(`${good ? '✅' : '❌'} ${c.text} → ${lines}줄 🛒${badge}`);
}
await browser.close();
for (const b of bad) console.log(`❌ ${b}`);
console.log(`오류 ${errors.length ? errors.join(' | ') : '없음'}`);
console.log(`장바구니 말 ${pass} / ${cases.length}`);
process.exit(pass === cases.length && !errors.length ? 0 : 1);
