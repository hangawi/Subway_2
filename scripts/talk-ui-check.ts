// 말로 주문하기 — 화면 버튼까지 (10/19, 로드맵 7.6-2): 문장을 입력칸에 넣고, 화면의 조건 버튼·옵션·주문서가 말한 대로인지 본다.
// 실행: npx tsx scripts/talk-ui-check.ts [주소]
import { chromium, type Page } from '@playwright/test';
import { waitMenus } from './ui-helpers.ts';

const base = process.argv[2] ?? 'https://subway.metasolveai.com';
type Check = (p: Page) => Promise<[string, boolean, string?]>;
const pressed = (sel: string) => async (p: Page) => (await p.locator(sel).first().getAttribute('aria-pressed')) === 'true';
const vegOff = (name: string): Check => async (p) => [`${name} 빼기 눌림`, (await p.locator('#options fieldset').filter({ hasText: '야채 (누르면 빼기)' }).locator('button', { hasText: name }).first().getAttribute('aria-pressed')) === 'false'];
const vegMore = (name: string): Check => async (p) => [`${name} 더 눌림`, (await p.locator('#options fieldset').filter({ hasText: '야채 더 넣기' }).locator('button', { hasText: `${name} 더` }).first().getAttribute('aria-pressed')) === 'true'];
const sauce = (name: string): Check => async (p) => [`소스 ${name} 눌림`, (await p.locator('#options fieldset').filter({ hasText: '소스' }).locator('button', { hasText: name }).first().getAttribute('aria-pressed')) === 'true'];
const picked = (name: string): Check => async (p) => { const t = (await p.textContent('#picked')) ?? ''; return [`메뉴 ${name}`, t.startsWith(name), t.slice(0, 30)]; };
const sheetHas = (txt: string): Check => async (p) => { const t = (await p.textContent('#sheet')) ?? ''; return [`주문서에 "${txt}"`, t.includes(txt)]; };
const chip = (label: string, sel: string): Check => async (p) => [label, await pressed(sel)(p)];
const said = (txt: string): Check => async (p) => { const t = (await p.textContent('#talk-result')) ?? ''; return [`"${txt}" 보임`, t.includes(txt), t.slice(0, 80)]; };
const notSaid = (txt: string): Check => async (p) => { const t = (await p.textContent('#talk-result')) ?? ''; return [`"${txt}" 안 보임`, !t.includes(txt)]; };

let lastStopped = false;
let lastHint = ''; // ③에서 멈췄을 때 고르기 전 안내 (고르면 사라짐)
const CASES: Array<[string, Check[]]> = [
  // 10/21 예형님: 메뉴 이름 없이 말하면 ③에서 멈추고 Top3 중 직접 고름 — 2위를 누르면 2위가 골라짐, Top3에 AI 한마디
  ['소고기 들어간 걸로 가볍게 양파 빼고 추천해줘', [async () => ['③에서 멈춤', lastStopped], async () => ['고르기 전 "양파 빼기도 넣어 드려요"', lastHint.includes('양파 빼기도 넣어 드려요'), lastHint.slice(0, 80)], async (p) => { const t = (await p.textContent('#picked')) ?? ''; const second = (await p.locator('#menu-list .menu h3').nth(1).textContent())?.replace(/^\d/, '').trim() ?? ''; return ['2위를 누르면 2위 + 양파 빼기', t.startsWith(second), `${t.slice(0, 20)} / ${second}`]; }, vegOff('양파'), async (p) => [`AI 한마디 (Top3)`, (await p.locator('#menu-list .ai-line:not([hidden])').count()) >= 1, String(await p.locator('#menu-list .ai-line:not([hidden])').count())]]],
  ['나 지금 배고픔 매운거 넣고 콜라는 제로콜라로 먹고 싶어 그리고 쇠고기 종류로 먹고싶은데 추천해줘바', [chip('든든하게 눌림', '[data-goal="FILLING"]'), said('매운 것 넣기'), said('단품: 코카콜라 제로'), sheetHas('코카콜라 제로 (355ml)'), async () => ['메뉴 이름 없음 → ③에서 멈춤 (1위를 알아서 안 고름)', lastStopped], async (p) => { const t = (await p.textContent('#picked')) ?? ''; return ['1위를 누르면 쇠고기 메뉴 + 말한 옵션', /스테이크|비프/.test(t), t.slice(0, 30)]; }]],
  ['강남역에서 로스트 치킨 먹을 건데 양파 빼고 피클 추가, 우유 알레르기', [picked('로스트 치킨'), vegOff('양파'), vegMore('피클'), chip('우유 알레르기 눌림', '#allergy-chips [data-a="우유"]')]],
  ['참치 양파 오이 빼주세요 소스는 마요네즈랑 스위트어니언', [picked('참치'), vegOff('양파'), vegOff('오이'), sauce('마요네즈'), sauce('스위트 어니언'), sheetHas('위트')]],
  ['이탈리안비엠티 노양파 노피클', [picked('이탈리안 비엠티'), vegOff('양파'), vegOff('피클')]],
  ['쉬림프 쿠키세트로 음료는 사이다', [picked('쉬림프'), sheetHas('쿠키 음료 세트'), sheetHas('사이다')]],
  ['만 삼천원 이하 매운거 넣어서', [async (p) => ['예산 13,000원', (await p.inputValue('#budget')) === '13000'], said('매운 것 넣기')]],
  ['새우 못먹어 매운것도 못먹고', [chip('새우 알레르기 눌림', '#allergy-chips [data-a="새우"]'), chip('매운 것 빼기 눌림', '#spicy')]],
  ['돼지고기 빼고 다 괜찮아', [notSaid('알레르기'), said('돼지고기 메뉴 빼기'), async (p) => { const names = (await p.locator('#menu-list .menu h3').allTextContents()).join(','); return ['추천에 돼지고기 메뉴 없음', !/잠봉|비엠티|햄|베이컨|풀드포크|이탈리안|피자/.test(names), names.slice(0, 60)]; }]],
  ['아기맹새우 먹을래', [said('판매가 끝났어요')]],
  ['스테이크 앤 치즈 아보카도 랩', [picked('스테이크 & 치즈 아보카도 랩')]],
  // 10/19: 단품·없는 음식
  ['콜라만 줘', [picked('음료·사이드만'), sheetHas('코카콜라 (355ml)'), sheetHas('2,200원'), async (p) => { const t = (await p.textContent('#sheet')) ?? ''; return ['주문서에 샌드위치 없음', !/15cm|빵/.test(t), t.slice(0, 60)]; }]],
  ['로스트 치킨에 콜라랑 초코칩 쿠키', [picked('로스트 치킨'), sheetHas('쿠키 음료 세트'), sheetHas('초코칩')]],
  ['생선회에 맵게 해줘', [said('생선회는 써브웨이 메뉴에 없어요'), said('매운 것 넣기'), async (p) => { const t = (await p.textContent('#picked')) ?? ''; return ['해산물 메뉴 (쉬림프·참치)', /쉬림프|참치/.test(t), t.slice(0, 30)]; }]],
  ['제로콜라에다가 치킨을 넣어서 맵게해줘 토마토 알레르기', [notSaid('다른 메뉴를 골라'), said('핫 칠리 소스는 안 넣었어요'), sheetHas('코카콜라 제로')]],
];

const browser = await chromium.launch();
let pass = 0;
let total = 0;
for (const [text, checks] of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  await p.click('#onboard-done');
  await waitMenus(p);
  await p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'));
  await p.fill('#talk-input', text);
  await p.click('#talk-send');
  await p.waitForTimeout(500);
  await p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  // 장소가 여러 곳이면 ("강남역") 사람처럼 첫 번째를 누름 → 이어서 메뉴까지
  if (await p.locator('#loc-result .pick').count()) {
    await p.locator('#loc-result .pick').first().click();
    await p.waitForTimeout(500);
    await p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });
  }
  await p.waitForTimeout(1500);
  // ③에서 멈췄으면 (메뉴 이름 없이 말함) 사람처럼 고름 — 첫 시험 문장만 2위, 나머지는 1위
  lastStopped = (await p.locator('#step-order').isHidden()) && (await p.locator('#menu-list .menu').count()) > 0;
  lastHint = (await p.textContent('#talk-result')) ?? '';
  if (lastStopped) {
    await p.waitForTimeout(3500); // AI 한마디가 올 시간
    await p.locator('#menu-list .menu .actions .btn-primary').nth(text.startsWith('소고기 들어간 걸로 가볍게') ? 1 : 0).click();
    await p.waitForSelector('#sheet .sheet', { state: 'attached', timeout: 30000 }).catch(() => undefined);
    await p.waitForTimeout(1200);
  }
  const rows: string[] = [];
  for (const c of checks) {
    const [label, ok, detail] = await c(p).catch((e) => [String(e).slice(0, 40), false] as [string, boolean]);
    total++;
    if (ok) pass++;
    rows.push(`${ok ? '✅' : '❌'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
  }
  if (errors.length) rows.push(`❌ 화면 오류: ${errors.join(' | ')}`), total++;
  console.log(`"${text}"\n  ${rows.join('\n  ')}`);
  await ctx.close();
}
await browser.close();
console.log(`\n화면 확인 ${pass} / ${total}`);
