// 예상 밖 장바구니 말 100문장을 지금 화면(규칙 먼저 + AI 보조)으로 (10/26 AI 비교의 "지금 방식" 칸)
// 문장마다 장바구니를 정해 둔 채(subway.cart) 열고 → 말하고 → 저장된 장바구니 줄을 정답과 비교
// 실행: npx tsx scripts/odd-cart-check.ts https://subway.metasolveai.com [--list] → var/cmd-eval/out-rules-odd.json
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';
import { waitMenus } from './ui-helpers.ts';
import { judgeLines, makeOdd, type GotLine } from './odd-cart-cases.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
const showAll = process.argv.includes('--list');
const catalog = loadSubwayCatalog();
const cases = makeOdd(catalog);
const menuId = (n: string) => catalog.menus.find((m) => m.name === n)!.id;
const nameOf = (id: string) => catalog.menus.find((m) => m.id === id)?.name ?? id;
const ing = (id: string) => catalog.ingredients.find((x) => x.id === id)?.name ?? id;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
const p = await ctx.newPage();
const errors: string[] = [];
p.on('pageerror', (e) => errors.push(e.message));
const idle = (q: Page) => q.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 60000 });
await p.goto(base);
await p.waitForTimeout(400);
await p.click('#onboard-done');
await waitMenus(p);
const out: Record<string, { lines: GotLine[]; ms: number }> = {};
let pass = 0;
let allergyMistakes = 0;
for (const c of cases) {
  const seed = c.cart.length ? JSON.stringify({ at: Date.now(), who: null, active: c.cart.length - 1, lines: c.cart.map((l) => ({ menuId: menuId(l.menu), choices: {}, qty: l.qty ?? 1, owner: l.owner === 'GUEST' ? 'guest' : 'me', name: l.name ?? null, allergies: [] })) }) : null;
  await p.evaluate((s) => (s ? localStorage.setItem('subway.cart', s) : localStorage.removeItem('subway.cart')), seed);
  await p.reload();
  await p.waitForTimeout(600);
  await waitMenus(p);
  await idle(p);
  const t0 = Date.now();
  await p.fill('#talk-input', c.text);
  await p.click('#talk-send');
  await idle(p);
  await p.waitForTimeout(700);
  await idle(p);
  const ms = Date.now() - t0;
  const got = await p.evaluate(() => {
    const mine = [...document.querySelectorAll<HTMLElement>('#allergy-chips .chip[aria-pressed="true"]')].map((b) => b.dataset.a!);
    let saved: { lines?: Array<{ menuId: string; choices: Record<string, unknown>; qty: number; owner: string; name: string | null; allergies: string[] }> } | null = null;
    try {
      saved = JSON.parse(localStorage.getItem('subway.cart') ?? 'null');
    } catch {
      saved = null;
    }
    return { mine, lines: saved?.lines ?? [], picked: document.getElementById('picked')?.textContent?.trim() ?? '' };
  });
  let lines: GotLine[] = got.lines.map((l) => {
    const ch = l.choices as { removeVegetables?: string[]; bread?: string; size?: string; cheese?: string | null; sauces?: string[] };
    return {
      menu: nameOf(l.menuId),
      qty: l.qty,
      owner: l.owner === 'guest' ? 'GUEST' : 'ME',
      ...(l.name ? { name: l.name } : {}),
      allergies: l.owner === 'guest' ? l.allergies : got.mine,
      remove: (ch.removeVegetables ?? []).map(ing),
      ...(ch.bread ? { bread: ing(ch.bread) } : {}),
      ...(ch.size ? { size: ch.size } : {}),
      ...(ch.cheese !== undefined ? { cheese: ch.cheese === null ? null : ing(ch.cheese) } : {}),
      ...(ch.sauces ? { sauces: ch.sauces.map(ing) } : {}),
    };
  });
  // 장바구니에 안 담고 한 메뉴만 연 경우 (한 사람 주문으로 알아들음): 연 메뉴 한 줄로 셈 (옵션은 모름)
  if (!lines.length && got.picked) lines = [{ menu: got.picked, qty: 1, owner: 'ME', allergies: got.mine, remove: [] }];
  out[c.id] = { lines, ms };
  const j = judgeLines(c.lines, lines);
  if (!j.bad.length) pass++;
  if (j.allergyMistake) allergyMistakes++;
  if (showAll || j.bad.length) console.log(`${j.bad.length ? '❌' : '✅'} ${c.id} ${c.text}${j.bad.length ? ` → ${j.bad.join(' / ')}` : ''}`);
}
await browser.close();
mkdirSync('var/cmd-eval', { recursive: true });
writeFileSync('var/cmd-eval/out-rules-odd.json', JSON.stringify(out, null, 1));
console.log(`오류 ${errors.length ? errors.join(' | ') : '없음'}`);
console.log(`예상 밖 100: 통과 ${pass}/${cases.length} · 알레르기 실수 ${allergyMistakes}`);
