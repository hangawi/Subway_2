// 휴대폰 크기 점검 (10/22 예형님 "모바일 전용이니 전부 크기 맞추기"): 360·390·412px에서
//  ① 누르는 것(버튼·링크 버튼·칩·펼치기·입력)이 모두 높이 48px 이상 ② 글자 15px 이상 (설명 작은 글자 예외 없음)
//  ③ 옆으로 넘침 없음 ④ 긴 말을 넣어도 입력 칸에 전체가 보임 ⑤ 화면마다 캡처
// 실행: npx tsx scripts/mobile-size-check.ts https://subway.metasolveai.com [--list]
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { tab, waitMenus, orderGo, closeCart } from './ui-helpers.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
const listAll = process.argv.includes('--list');
mkdirSync('var/mobile', { recursive: true });
let pass = 0;
let total = 0;
const ok = (name: string, v: boolean, detail = '') => {
  total++;
  if (v) pass++;
  console.log(`${v ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const idle = (p: Page) => p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });

/** 보이는 것 중 작은 것 찾기 */
// 브라우저 안에서 돌릴 코드는 글로 넘김 (tsx가 함수에 __name 도우미를 끼워 넣어 브라우저에서 깨지는 것 피하기)
const MEASURE = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' "' + (e.textContent || e.placeholder || '').trim().slice(0, 18) + '"';
  const taps = [...document.querySelectorAll('button, a.btn, a.btn-text, .actions > a, summary, input:not([type=checkbox]), select, textarea, .consent')].filter(vis);
  const smallTap = taps.filter((e) => e.getBoundingClientRect().height < 47.5).map((e) => name(e) + ' h=' + Math.round(e.getBoundingClientRect().height));
  const texts = [...document.querySelectorAll('body *')].filter((e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const smallText = texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 14.9 && !e.closest('#tabbar')).map((e) => name(e) + ' ' + getComputedStyle(e).fontSize);
  return { smallTap: [...new Set(smallTap)], smallText: [...new Set(smallText)], wide: document.documentElement.scrollWidth };
})()`;
/** 보이는 것 중 작은 것 찾기 */
async function measure(p: Page): Promise<{ smallTap: string[]; smallText: string[]; wide: number }> {
  return p.evaluate(MEASURE);
}

for (const width of [360, 390, 412]) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.waitForTimeout(500);
  const onboard = await measure(p);
  await p.screenshot({ path: `var/mobile/${width}-0-start.png` });
  await p.click('#onboard-done');
  await waitMenus(p);
  await idle(p);
  // 긴 말 → 입력 칸에 전체가 보이는지
  const long = '나 지금 배고프고 돼지고기로 먹고 싶어 맵게 해주고 제로콜라에다가 수프 하나 추가해주고 나 고등어 알레르기 있어';
  await p.fill('#talk-input', long);
  const fits: { tag: string; scroll: number; client: number; sw: number; cw: number } = await p.evaluate("(() => { const t = document.getElementById('talk-input'); return { tag: t.tagName, scroll: t.scrollHeight, client: t.clientHeight, sw: t.scrollWidth, cw: t.clientWidth }; })()");
  ok(`${width}px 긴 말이 입력 칸에 전체 보임 (줄 바뀜, 잘림 없음)`, fits.tag === 'TEXTAREA' && fits.scroll <= fits.client + 2 && fits.sw <= fits.cw + 2, JSON.stringify(fits));
  await p.locator('#conditions').screenshot({ path: `var/mobile/${width}-2-talk-long.png` });
  // 자판의 보내기(엔터) = 보내기 (여러 줄 칸이라도 줄바꿈 안 함)
  await p.press('#talk-input', 'Enter');
  await idle(p);
  await p.waitForTimeout(800);
  ok(`${width}px 엔터로 보냄 → 칸 비고 한 줄로 돌아옴`, (await p.inputValue('#talk-input')) === '' && ((await p.evaluate("document.getElementById('talk-input').clientHeight")) as number) < 70 && ((await p.textContent('#talk-result')) ?? '').includes('고등어'));
  await p.locator('#menu-list .menu .actions .btn-primary').first().click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await idle(p);
  await p.locator('#options details.extras > summary').click().catch(() => undefined);
  const main = await measure(p);
  await p.screenshot({ path: `var/mobile/${width}-1-order.png`, fullPage: true });
  await orderGo(p);
  await p.click('#order-confirm');
  await p.waitForSelector('#order-recorded');
  await closeCart(p); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
  const handoff = await measure(p);
  await tab(p, 'taste');
  await p.waitForTimeout(300);
  const taste = await measure(p);
  await p.screenshot({ path: `var/mobile/${width}-3-taste.png`, fullPage: true });
  const smallTap = [...new Set([...onboard.smallTap, ...main.smallTap, ...handoff.smallTap, ...taste.smallTap])];
  const smallText = [...new Set([...onboard.smallText, ...main.smallText, ...handoff.smallText, ...taste.smallText])];
  ok(`${width}px 누르는 것 모두 높이 48px 이상`, smallTap.length === 0, `${smallTap.length}개 ${smallTap.slice(0, listAll ? 200 : 6).join(' | ')}`);
  ok(`${width}px 글자 15px 이상`, smallText.length === 0, `${smallText.length}개 ${smallText.slice(0, listAll ? 200 : 6).join(' | ')}`);
  ok(`${width}px 옆으로 넘침 없음`, Math.max(onboard.wide, main.wide, handoff.wide, taste.wide) <= width, String(Math.max(onboard.wide, main.wide, handoff.wide, taste.wide)));
  ok(`${width}px 오류 없음`, !errors.length, errors.join(' | '));
  await browser.close();
}
console.log(`휴대폰 크기 ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
