// 취향 기억하기 — 실제 화면 (10/20, 3,000문장 시험): 말로 취향을 말하고 → 앱을 다시 열어도 남는지 → 추천 Top3가 바뀌는지 → 지우면 빠지는지
// 실행: npx tsx scripts/taste-ui-check.ts [주소]   (말은 전부 규칙으로 알아듣는 문장 — AI 안 부름)
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { tab, waitMenus } from './ui-helpers.ts';

const base = process.argv[2] ?? 'https://subway.metasolveai.com';
const MAIN_NAME: Record<string, RegExp> = {
  쇠고기: /스테이크|비프|불고기|미트볼/,
  닭고기: /치킨|로티세리/,
  돼지고기: /햄|베이컨|잠봉|풀드포크|비엠티|페퍼로니|이탈리안|피자썹|비엘티|살라미/,
  새우: /쉬림프|새우/,
  참치: /참치/,
  달걀: /에그/,
  야채: /^베지|그린 (?:그레인 )?샐러드/,
};
const browser = await chromium.launch();
const idle = async (p: Page) => {
  await p.waitForTimeout(400);
  await p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });
  await p.waitForTimeout(600);
};
async function open(consent: boolean): Promise<{ ctx: BrowserContext; p: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base);
  if (consent) await p.check('#ob-taste');
  await p.click('#onboard-done');
  await waitMenus(p);
  await idle(p);
  return { ctx, p, errors };
}
const say = async (p: Page, t: string) => {
  await p.fill('#talk-input', t);
  await p.click('#talk-send');
  await idle(p);
};
const top3 = async (p: Page) => (await p.locator('#menu-list .menu h3').allTextContents()).slice(0, 3).map((x) => x.replace(/^\d/, '').trim());
const tastes = async (p: Page) => (await p.textContent('#my-tastes')) ?? '';
const reload = async (p: Page) => {
  await p.reload();
  await waitMenus(p);
  await idle(p);
};

let pass = 0;
let total = 0;
const ok = (name: string, cond: boolean, info = '') => {
  total++;
  if (cond) pass++;
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${info}`}`);
};
const WORD: Record<string, string> = { 쇠고기: '소고기', 닭고기: '치킨', 돼지고기: '돼지고기', 새우: '새우', 참치: '참치', 달걀: '계란', 야채: '채식' };
// 1~7: 평소 좋아함 → 다시 열어도 남고 Top3에 그 재료
for (const [k, w] of Object.entries(WORD)) {
  const { ctx, p, errors } = await open(true);
  await say(p, `평소에 ${w} 좋아해`);
  await reload(p);
  const t = await top3(p);
  ok(`평소 ${w} 좋아해 → 다시 열어도 "평소 ${k} 좋아함" + Top3에 ${k}`, (await tastes(p)).includes(`평소 ${k} 좋아함`) && t.some((n) => MAIN_NAME[k]!.test(n)) && !errors.length, `${t.join(', ')} / ${(await tastes(p)).slice(0, 60)} ${errors.join(' ')}`);
  await ctx.close();
}
// 8~14: 평소 싫어함 → Top3에 그 재료 없음
for (const [k, w] of Object.entries(WORD)) {
  const { ctx, p } = await open(true);
  await say(p, `나 원래 ${w} 별로야`);
  await reload(p);
  const t = await top3(p);
  ok(`원래 ${w} 별로 → Top3에 ${k} 없음`, (await tastes(p)).includes(`평소 ${k} 피함`) && !t.some((n) => MAIN_NAME[k]!.test(n)), t.join(', '));
  await ctx.close();
}
// 15~16: 취향 기억하기 끔 → 이번에만, 다시 열면 없음
for (const w of ['새우', '참치']) {
  const { ctx, p } = await open(false);
  await say(p, `평소에 ${w} 좋아해`);
  const now = await top3(p);
  const said = ((await p.textContent('#talk-result')) ?? '').includes('이번에만 반영해요');
  await reload(p);
  ok(`기억하기 끔: "${w} 좋아해" → 이번에만 (다시 열면 없음)`, said && now.some((n) => MAIN_NAME[w]!.test(n)) && !(await tastes(p)).includes('좋아함'), `${now.join(', ')} / ${(await tastes(p)).slice(0, 40)}`);
  await ctx.close();
}
// 17~18: 지우기 → 목록·추천에서 빠짐
for (const [k, w] of [['야채', '채식'], ['새우', '쉬림프']] as const) {
  const { ctx, p } = await open(true);
  await say(p, `평소에 ${w} 좋아해`);
  // 내 취향 목록은 접힌 설정 안
  await tab(p, 'taste');
  await p.locator('#my-tastes li', { hasText: `평소 ${k} 좋아함` }).locator('button').click();
  await idle(p);
  await reload(p);
  ok(`"${w} 좋아해" 지우기 → 다시 열어도 없음`, !(await tastes(p)).includes(`평소 ${k} 좋아함`), (await tastes(p)).slice(0, 40));
  await ctx.close();
}
// 19: 평소 좋아함 + 오늘은 피함 → 오늘이 이김
{
  const { ctx, p } = await open(true);
  await say(p, '평소에 새우 좋아해');
  await say(p, '오늘은 새우 피할래');
  await reload(p);
  const t = await top3(p);
  ok('평소 새우 좋아함 + 오늘은 피함 → Top3에 새우 없음', (await tastes(p)).includes('오늘은 새우 피함') && !t.some((n) => MAIN_NAME.새우!.test(n)), t.join(', '));
  await ctx.close();
}
// 20: 피곤해 → 든든하게 + 오늘 피곤함, 다시 열어도 남음
{
  const { ctx, p } = await open(true);
  await say(p, '오늘 기운이 없어');
  await reload(p);
  ok('"오늘 기운이 없어" → 다시 열어도 "오늘 피곤함"', (await tastes(p)).includes('오늘 피곤함'), (await tastes(p)).slice(0, 40));
  await ctx.close();
}
await browser.close();
console.log(`취향 화면 ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
