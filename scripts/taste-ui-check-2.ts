// 실제 화면 점검 2차 (10/20 저녁, 예형님 요청): 주문한 뒤 취향이 적용되는지(강제로 여러 번 주문), "뭐 먹지?" 시간대별 한마디,
// 예형님 문장, 웨지 11시 안내, 휴대폰 360px 가로 넘침 없음. 시간은 테스트 브라우저 시계를 바꿔서 본다
//   npx tsx scripts/taste-ui-check-2.ts [주소]
import { chromium, type Page } from '@playwright/test';
import { tab, waitMenus, orderGo, closeCart } from './ui-helpers.ts';

const base = process.argv[2] ?? 'https://subway.metasolveai.com';
const browser = await chromium.launch();
let pass = 0;
let total = 0;
const ok = (name: string, cond: boolean, info = '') => {
  total++;
  if (cond) pass++;
  console.log(`${cond ? '✅' : '❌'} ${name}${cond ? '' : ` — ${info}`}`);
};
const idle = async (p: Page) => {
  await p.waitForTimeout(400);
  await p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });
  await p.waitForTimeout(700);
};
async function open(o: { orders?: boolean; taste?: boolean; at?: string; width?: number } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', geolocation: { latitude: 37.4979, longitude: 127.0276 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  if (o.at) await p.clock.install({ time: new Date(o.at) });
  await p.goto(base);
  if (o.orders) await p.check('#ob-orders');
  if (o.taste) await p.check('#ob-taste');
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
const pressed = async (p: Page, group: string, label: string) => (await p.locator('#options fieldset').filter({ hasText: group }).locator('button', { hasText: label }).first().getAttribute('aria-pressed')) === 'true';
const orderOnce = async (p: Page) => {
  await orderGo(p);
  await p.click('#order-confirm');
  await p.waitForSelector('#order-recorded');
  await closeCart(p); // 10/27: 주문 뒤 장바구니 화면을 닫고 주문 화면으로
  await p.waitForTimeout(300);
};
const noOverflow = async (p: Page) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1~4: 메뉴 n번째를 양파 빼고 2번 주문 → 다시 열기 → 자주 고른 메뉴·늘 양파 빼기·Top3·[평소처럼]
// 샌드위치를 말로 고름 (추천 1위가 샐러드면 야채 버튼이 없어서)
const SW = ['에그마요', '로스트 치킨', '이탈리안 비엠티', '참치'];
for (const n of [0, 1, 2, 3]) {
  const { ctx, p, errors } = await open({ orders: true, taste: true });
  const name = SW[n]!;
  await say(p, `${name} 양파 빼줘`);
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await orderOnce(p);
  await closeCart(p);
  await p.locator('#order-list button', { hasText: '다시 주문' }).first().click();
  await p.waitForSelector('#line-notes [data-reorder-note]');
  await orderOnce(p);
  await p.reload();
  await waitMenus(p);
  await idle(p);
  const t = await tastes(p);
  const tops = await top3(p);
  ok(`${name} 양파 빼고 2번 주문 → 다시 열기: 자주 고른 메뉴·늘 양파 빼기·Top3`, t.includes(`자주 고른 메뉴: ${name}`) && t.includes('늘 양파 빼기') && tops.includes(name) && !errors.length, `${tops.join(', ')} / ${t.slice(0, 80)} ${errors.join(' ')}`);
  // 평소처럼 (10/21부터 자동): 다른 샌드위치를 골라도 양파 빼기가 평소대로 들어감
  const other = SW[(n + 1) % SW.length]!;
  await say(p, other);
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await p.waitForTimeout(600);
  ok(`${name}: 평소대로 → ${other}도 양파 빠짐 + "평소대로 넣었어요"`, !(await pressed(p, '야채 (누르면 빼기)', '양파')) && ((await p.textContent('#options')) ?? '').includes('평소대로 넣었어요'));
  await ctx.close();
}
// 5~6: 주문 기록 끔 → 2번 주문해도 안 배움
for (const n of [0, 2]) {
  const { ctx, p } = await open({ orders: false, taste: true });
  await p.locator('#menu-list .menu .actions .btn-primary').nth(n).click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await orderOnce(p);
  await p.locator('#menu-list .menu .actions .btn-primary').nth(n).click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await orderOnce(p);
  await p.reload();
  await waitMenus(p);
  await idle(p);
  ok(`주문 기록 끔: 2번 주문해도 "자주 고른 메뉴" 없음 (${n + 1}번째)`, !(await tastes(p)).includes('자주 고른 메뉴'), (await tastes(p)).slice(0, 60));
  await ctx.close();
}
// 7~8: 주문 뒤 "지난번처럼" → 그 메뉴
for (const [n, t] of [[1, '지난번처럼'], [2, '저번이랑 똑같이']] as const) {
  const { ctx, p } = await open({ orders: true, taste: true });
  await p.locator('#menu-list .menu .actions .btn-primary').nth(n).click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  const first = ((await p.textContent('#picked')) ?? '').slice(0, 6);
  await orderOnce(p);
  await p.reload();
  await waitMenus(p);
  await idle(p);
  await say(p, t);
  ok(`주문 뒤 "${t}" → 지난 메뉴`, ((await p.textContent('#picked')) ?? '').startsWith(first), `${first} / ${(await p.textContent('#picked'))?.slice(0, 20)}`);
  await ctx.close();
}
// 9~10: 자주 고른 메뉴 지우기 → 또 주문해도 다시 안 배움
for (const n of [0, 1]) {
  const { ctx, p } = await open({ orders: true, taste: true });
  for (let i = 0; i < 2; i++) {
    await p.locator('#menu-list .menu .actions .btn-primary').nth(n).click();
    await p.waitForSelector('#sheet .sheet', { state: 'attached' });
    await orderOnce(p);
  }
  await tastes(p);
  await tab(p, 'taste');
  await p.locator('#my-tastes li', { hasText: '자주 고른 메뉴' }).first().locator('button').click();
  await tab(p, 'order');
  await p.waitForTimeout(300);
  await p.locator('#menu-list .menu .actions .btn-primary').nth(n).click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await orderOnce(p);
  await p.reload();
  await waitMenus(p);
  await idle(p);
  ok(`자주 고른 메뉴 지우기 → 또 주문해도 안 배움 (${n + 1}번째)`, !(await tastes(p)).includes('자주 고른 메뉴'), (await tastes(p)).slice(0, 60));
  await ctx.close();
}
// 11~12: "오늘은 ○○ 당겨" → 다음 날 새벽 4시 지나면 없음 (브라우저 시계)
for (const [k, w] of [['새우', '새우'], ['쇠고기', '소고기']] as const) {
  const { ctx, p } = await open({ taste: true, at: '2026-10-21T22:30:00+09:00' });
  await say(p, `오늘은 ${w} 당겨`);
  const before = (await tastes(p)).includes(`오늘은 ${k} 좋아함`);
  await p.clock.setFixedTime(new Date('2026-10-22T04:05:00+09:00'));
  await p.reload();
  await waitMenus(p);
  await idle(p);
  ok(`"오늘은 ${w} 당겨" 밤 → 다음 날 4:05엔 없음`, before && !(await tastes(p)).includes(`오늘은 ${k}`), `${before} / ${(await tastes(p)).slice(0, 50)}`);
  await ctx.close();
}
// 13~15: "뭐 먹지?" 시간대별 한마디 + Top3
for (const [at, line, breakfast] of [['2026-10-21T08:30:00+09:00', '아침 메뉴로', true], ['2026-10-21T12:30:00+09:00', '점심이니까 든든한', false], ['2026-10-21T19:30:00+09:00', '저녁이라 가볍게', false]] as const) {
  const { ctx, p, errors } = await open({ at });
  await say(p, '아 나 뭐 먹을까?');
  const note = (await p.textContent('#talk-result')) ?? '';
  const tops = await top3(p);
  const picked = (await p.textContent('#picked')) ?? '';
  // 10/21: 1위를 알아서 고르지 않고 ③에서 멈춤
  ok(`"아 나 뭐 먹을까?" ${at.slice(11, 16)} → "${line}…" + ③에서 멈춤`, note.includes(line) && !note.includes('잘 못 알아들었어요') && tops.length > 0 && !picked.trim() && !errors.length, `${note.slice(0, 80)} / ${tops.join(', ')} / ${picked.slice(0, 20)}`);
  // 추천 순위는 서버 시계로 정해져 브라우저 시계만 바꿔서는 못 봄 → 아침 Top3는 규칙 시험(talk-3000-run2 I2시간, at 08:20·09:40)에서 확인
  void breakfast;
  await ctx.close();
}
// 16: 취향 + "뭐 먹지?" → 취향 한마디
{
  const { ctx, p } = await open({ taste: true });
  await say(p, '평소에 새우 좋아해');
  await say(p, '오늘 뭐먹을지 추턴해줘');
  const note = (await p.textContent('#talk-result')) ?? '';
  ok('평소 새우 좋아함 + "오늘 뭐먹을지 추턴해줘" → "평소 좋아하시는 새우 메뉴로"', note.includes('평소 좋아하시는 새우 메뉴로') && (await top3(p)).some((x) => /쉬림프|새우/.test(x)), note.slice(0, 80));
  await ctx.close();
}
// 17~18: 예형님 문장 (360px)
{
  const { ctx, p, errors } = await open({ width: 360, at: '2026-10-21T12:30:00+09:00' });
  await say(p, '나 지금 배고프고 돼직고기로 먹고시퍼 맵게 해주고 제로콜라에다가 스프 야무진거 하나 추가해주고 나 고등어알레르기 있어');
  // 10/21: ③에서 멈춤 → 1위를 고르면 말한 옵션이 들어감
  await p.locator('#menu-list .menu .actions .btn-primary').first().click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await idle(p);
  const picked = (await p.textContent('#picked')) ?? '';
  const sheet = (await p.textContent('#sheet')) ?? '';
  const checks = {
    돼지고기메뉴: /햄|베이컨|잠봉|풀드포크|비엠티|페퍼로니|이탈리안|피자썹|비엘티|살라미/.test(picked),
    할라피뇨더: await pressed(p, '야채 더 넣기', '할라피뇨 더'),
    핫칠리: await pressed(p, '소스', '핫 칠리'),
    수프세트: await pressed(p, '세트', '수프 음료 세트'),
    오늘의수프안내: ((await p.textContent('#options')) ?? '').includes('오늘의 수프'), // 10/21: 수프 세트는 공식대로 그날 수프
    제로콜라: await pressed(p, '세트 음료', '제로콜라'),
    고등어: (await p.locator('#allergy-chips [data-a="고등어"]').getAttribute('aria-pressed')) === 'true',
    주문서수프: sheet.includes('오늘의 수프'),
  };
  const miss = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  ok('예형님 문장 → 돼지고기 메뉴·할라피뇨 더·핫 칠리·수프 세트+오늘의 수프·제로콜라·고등어', !miss.length && !errors.length, `빠짐: ${miss.join(',')} / ${picked.slice(0, 20)} ${errors.join(' ')}`);
  ok('360px: 가로로 넘치지 않음 (예형님 문장 뒤)', await noOverflow(p));
  await ctx.close();
}
// 19: 웨지 세트 아침 9:30 → "11시부터" 안내
{
  const { ctx, p } = await open({ at: '2026-10-21T09:30:00+09:00' });
  await p.locator('#menu-list .menu .actions .btn-primary').first().click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  await say(p, '웨지 세트로 콜라');
  ok('아침 9:30 웨지 세트 → "웨지 포테이토는 오전 11시부터"', ((await p.textContent('#options')) ?? '').includes('오전 11시부터'), ((await p.textContent('#options')) ?? '').slice(-120));
  await ctx.close();
}
// 20: 360px: 옵션 다 연 상태
{
  const { ctx, p } = await open({ width: 360 });
  await say(p, '에그마요 양파 빼고 피클 많이 랜치 소스 쿠키 세트 초코칩 콜라 30cm');
  ok('360px: 옵션·주문서 열어도 가로로 넘치지 않음', await noOverflow(p));
  await ctx.close();
}
// 21~22 (10/21 4차): ③에서 멈춘 뒤 "2번으로 할게" → 2위가 골라지고 앞에서 말한 옵션(양파 빼기)도 들어감
for (const [first, then, n] of [['소고기들어간걸로 가볍게 양파 빼고 추천해줘', '2번으로 할게', 1], ['아나 뭐 먹을까?', '세번째걸로', 2]] as const) {
  const { ctx, p, errors } = await open({ at: '2026-10-21T12:30:00+09:00' });
  await say(p, first);
  const want = (await p.locator('#menu-list .menu h3').nth(n).textContent())?.replace(/^\d/, '').trim() ?? '';
  await say(p, then);
  await p.waitForTimeout(800);
  const picked = (await p.textContent('#picked')) ?? '';
  const onion = first.includes('양파') ? !(await pressed(p, '야채 (누르면 빼기)', '양파')) : true;
  ok(`"${first}" → "${then}" → ${n + 1}위 메뉴${first.includes('양파') ? ' + 양파 빼기' : ''}`, picked.startsWith(want) && onion && !errors.length, `${picked.slice(0, 20)} / ${want} / 양파 ${onion}`);
  await ctx.close();
}
// 23~28 (10/21 예형님): 늘 고르는 소스 — 말 안 하면 평소대로, "랜치로"면 랜치만, "랜치도"면 더하기, 되돌리기, 내 취향에 보이고 지우면 안 씀
{
  const { ctx, p, errors } = await open({ orders: true, taste: true });
  for (const menu of ['에그마요', '로스트 치킨']) {
    await say(p, `${menu} 소스는 소금이랑 후추`);
    await p.waitForSelector('#sheet .sheet', { state: 'attached' });
    await orderOnce(p);
  }
  await p.reload();
  await waitMenus(p);
  await idle(p);
  const sauceOn = async () => (await p.locator('#options fieldset').filter({ hasText: '소스' }).locator('button[aria-pressed="true"]').allTextContents()).map((x) => x.trim()).sort().join(',');
  await say(p, '참치');
  ok('소스 말 안 함 → 평소대로 소금·후추 + "평소대로 넣었어요"', (await sauceOn()) === '소금,후추' && ((await p.textContent('#options')) ?? '').includes('평소대로 넣었어요'), await sauceOn());
  await p.click('#usual-undo');
  await p.waitForTimeout(600);
  ok('[되돌리기] → 소스 비움', (await sauceOn()) === '', await sauceOn());
  await say(p, '에그마요 소스는 랜치로');
  ok('"소스는 랜치로" → 랜치만', (await sauceOn()) === '랜치', await sauceOn());
  // 새 장바구니에서 (10/27: 랜치 넣은 에그마요가 이미 담겨 있으면 젬마는 그 줄에 더함 — 그것도 맞는 해석)
  await p.evaluate(() => localStorage.removeItem('subway.cart'));
  await p.reload();
  await waitMenus(p);
  await idle(p);
  await say(p, '에그마요 랜치도 추가해줘');
  ok('"랜치도 추가해줘" → 소금·후추·랜치', (await sauceOn()) === '랜치,소금,후추', await sauceOn());
  const t = await tastes(p);
  ok('내 취향에 "늘 고르는 소스: 소금·후추"', t.includes('늘 고르는 소스: 소금·후추'), t.slice(0, 120));
  await tab(p, 'taste');
  await p.locator('#my-tastes li', { hasText: '늘 고르는 소스' }).locator('button').click();
  await tab(p, 'order');
  await p.waitForTimeout(300);
  await say(p, '쉬림프');
  ok('지우면 → 다음 메뉴에 평소 소스 안 넣음', (await sauceOn()) === '' && !errors.length, `${await sauceOn()} ${errors.join(' ')}`);
  await ctx.close();
}
await browser.close();
console.log(`화면 2차 ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
