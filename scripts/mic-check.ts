// 🎤 마이크·아래 탭 점검 (10/22, 로드맵 7.7): 가짜 마이크(1.2초 소리 → 조용함)로 말하는 동안 글자·조용하면 저절로 끝·[보내기]로 끝·말 기록·탭.
// 받아쓰기는 화면에서 가로채 가짜 글을 돌려준다 (OpenAI 요금 없음). 해석(/api/interpret)은 실제 서버.
// 실행: npx tsx scripts/mic-check.ts https://subway.metasolveai.com
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tab, waitMenus } from './ui-helpers.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:4174';
mkdirSync('var', { recursive: true });
// 16kHz 모노 WAV: 1.2초 440Hz 소리 + 5초 조용함 (크롬 가짜 마이크가 이 파일을 되풀이)
function wav(path: string, toneSec: number, silenceSec: number) {
  const rate = 16000;
  const n = Math.round(rate * (toneSec + silenceSec));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(i < rate * toneSec ? Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000) : 0, 44 + i * 2);
  writeFileSync(path, buf);
}
wav('var/mic-tone-then-quiet.wav', 1.2, 5);

const PHONE_INIT: Record<'none' | 'fake' | 'broken', string> = {
  none: 'delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;',
  // 300ms "만 원" → 900ms "만 원 이하 단백질 많이"(확정) → 그 뒤 조용함. stop()을 부르면 onend
  fake: `window.__phoneStarts = 0; class FakeSR { constructor() { this.onresult = null; this.onerror = null; this.onend = null; this.t = []; }
    start() { window.__phoneStarts++; const ev = (txt, fin) => ({ results: Object.assign([Object.assign([{ transcript: txt }], { isFinal: fin })], {}) });
      this.t.push(setTimeout(() => this.onresult && this.onresult(ev('만 원', false)), 300));
      this.t.push(setTimeout(() => this.onresult && this.onresult(ev(window.__phoneFinal || '만 원 이하 단백질 많이', true)), 900)); }
    stop() { this.t.forEach(clearTimeout); setTimeout(() => this.onend && this.onend(), 50); } }
    window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR;`,
  // 시작하자마자 연결 오류 → OpenAI로 넘어가야 함
  broken: `window.__phoneStarts = 0; class BrokenSR { constructor() { this.onresult = null; this.onerror = null; this.onend = null; }
    start() { window.__phoneStarts++; setTimeout(() => { this.onerror && this.onerror({ error: 'network' }); this.onend && this.onend(); }, 100); }
    stop() {} } window.SpeechRecognition = BrokenSR; window.webkitSpeechRecognition = BrokenSR;`,
};
let pass = 0;
let total = 0;
const ok = (name: string, v: boolean, detail = '') => {
  total++;
  if (v) pass++;
  console.log(`${v ? '✅' : '❌'} ${name}${detail ? `  — ${detail}` : ''}`);
};
const idle = (p: Page) => p.waitForFunction(() => document.querySelector('#busy')?.hasAttribute('hidden'), null, { timeout: 30000 });

// 10/26: 휴대폰 받아쓰기(브라우저 음성 인식)가 먼저 — OpenAI 길을 보려면 phone: 'none', 가짜 휴대폰 받아쓰기는 phone: 'fake' | 'broken'
async function session(fakeAudio: string | null, phone: 'none' | 'fake' | 'broken' = 'none') {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(fakeAudio ? [`--use-file-for-fake-audio-capture=${fakeAudio}`] : [])] });
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', permissions: ['microphone', 'geolocation'], geolocation: { latitude: 37.4979, longitude: 127.0276 } });
  const p = await ctx.newPage();
  await p.addInitScript(PHONE_INIT[phone]);
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const calls = { live: 0, final: 0, interpret: [] as string[] };
  await p.route('**/api/transcribe', async (route) => {
    const live = route.request().headers()['x-subway-live'] === '1';
    if (live) calls.live++;
    else calls.final++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(live ? { text: '만 원 이하' } : { text: '만 원 이하 단백질 많이', provider: 'external' }) });
  });
  p.on('request', (r) => {
    if (r.url().endsWith('/api/interpret') && r.method() === 'POST') calls.interpret.push(JSON.parse(r.postData() ?? '{}').text);
  });
  await p.goto(base);
  await p.waitForTimeout(500);
  await p.click('#onboard-done');
  await waitMenus(p);
  await idle(p);
  return { browser, p, calls, errors };
}
async function startMic(p: Page) {
  await p.click('#mic');
  const agree = p.locator('#talk-result button', { hasText: '동의하고 켜기' });
  if (await agree.count()) await agree.click();
  await p.waitForFunction(() => document.getElementById('mic')?.classList.contains('rec'), null, { timeout: 8000 });
}

// 1. 말하는 동안 글자 + 조용하면 저절로 끝 + 한 번만 보냄 + 말 기록
{
  const { browser, p, calls, errors } = await session('var/mic-tone-then-quiet.wav');
  ok('🎤는 ② 입력 칸·[보내기] 사이', (await p.locator('#talk-form #mic + #talk-send').count()) === 1 && (await p.locator('#mic').isVisible()));
  const t0 = Date.now();
  await startMic(p);
  ok('녹음 중 안내: "말을 멈추면 2초 뒤 저절로 보내요"', ((await p.textContent('#mic-listening').catch(() => '')) ?? '').includes('2초 뒤 저절로'));
  await p.waitForFunction(() => (document.getElementById('talk-input') as HTMLInputElement).value === '만 원 이하', null, { timeout: 6000 }).catch(() => null);
  ok('말하는 동안 입력 칸에 글자 (1.5초마다 받아쓰기)', calls.live >= 1 && (await p.inputValue('#talk-input')) === '만 원 이하', `live ${calls.live}회, 칸 "${await p.inputValue('#talk-input')}"`);
  await p.waitForFunction(() => !document.getElementById('mic')?.classList.contains('rec'), null, { timeout: 12000 }).catch(() => null);
  const stoppedAfter = (Date.now() - t0) / 1000;
  ok('소리 뒤 2초 조용하면 저절로 끝 (30초 안 기다림)', !(await p.locator('#mic.rec').count()) && stoppedAfter < 9, `${stoppedAfter.toFixed(1)}초`);
  await idle(p);
  await p.waitForTimeout(800);
  for (let w = 0; w < 30 && !calls.interpret.length; w++) await p.waitForTimeout(500); // 10/27: 젬마 먼저 → 해석이 늦게 옴
  ok('끝나면 받아쓰기 1번 → 해석 1번 (말한 글 그대로)', calls.final === 1 && calls.interpret.length === 1 && calls.interpret[0] === '만 원 이하 단백질 많이', `final ${calls.final}, interpret ${JSON.stringify(calls.interpret)}`);
  ok('알아들은 것: 예산·단백질', ((await p.textContent('#talk-result')) ?? '').includes('10,000원'), ((await p.textContent('#talk-result')) ?? '').slice(0, 80));
  // 말 기록
  await tab(p, 'taste');
  const log = (await p.textContent('#talk-log')) ?? '';
  ok('[취향 그래프] 탭 → 말 기록에 🎤 말·알아들은 것·처리한 곳', log.includes('🎤 말') && log.includes('만 원 이하 단백질 많이') && log.includes('알아들은 것') && /규칙|GPU|OpenAI/.test(log), log.slice(0, 120));
  ok('오류 없음 (마이크 1)', !errors.length, errors.join(' | '));
  await browser.close();
}
// 2. 말하는 중 [보내기] → 그 자리에서 끝 + 한 번만 보냄 (가짜 마이크 기본 = 계속 소리)
{
  const { browser, p, calls, errors } = await session(null);
  await startMic(p);
  await p.waitForTimeout(2200);
  await p.click('#talk-send');
  await p.waitForFunction(() => !document.getElementById('mic')?.classList.contains('rec'), null, { timeout: 4000 }).catch(() => null);
  ok('말하는 중 [보내기] → 바로 녹음 끝', !(await p.locator('#mic.rec').count()));
  await idle(p);
  await p.waitForTimeout(800);
  for (let w = 0; w < 30 && !calls.interpret.length; w++) await p.waitForTimeout(500); // 10/27: 젬마 먼저 → 해석이 늦게 옴
  ok('[보내기]로 끝내도 받아쓰기 1번 → 해석 1번', calls.final === 1 && calls.interpret.length === 1, `final ${calls.final}, interpret ${calls.interpret.length}`);
  ok('보낸 뒤 입력 칸 비움', (await p.inputValue('#talk-input')) === '');
  ok('오류 없음 (마이크 2)', !errors.length, errors.join(' | '));
  await browser.close();
}
// 3. 끝난 뒤 받아쓰기가 실패해도 말하는 동안 받은 글로 보냄
{
  const { browser, p, calls, errors } = await session(null);
  await p.unroute('**/api/transcribe');
  await p.route('**/api/transcribe', (route) => (route.request().headers()['x-subway-live'] === '1' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"text":"매운 거 넣어서"}' }) : route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"TRANSCRIBE_FAILED"}' })));
  await startMic(p);
  await p.waitForTimeout(2600);
  await p.click('#mic');
  await idle(p);
  await p.waitForTimeout(800);
  for (let w = 0; w < 30 && !calls.interpret.length; w++) await p.waitForTimeout(500); // 10/27: 젬마 먼저 → 해석이 늦게 옴
  ok('끝난 뒤 받아쓰기 실패 → 말하는 동안 받은 글로 해석', calls.interpret.includes('매운 거 넣어서'), JSON.stringify(calls.interpret));
  ok('오류 없음 (마이크 3)', !errors.length, errors.join(' | '));
  await browser.close();
}
// 5. 휴대폰 받아쓰기 (10/26): 말하는 동안 글자, 조용하면 저절로 끝, OpenAI 안 부름, 말 기록에 "휴대폰 받아쓰기"
{
  const { browser, p, calls, errors } = await session(null, 'fake');
  await startMic(p);
  await p.waitForFunction(() => (document.getElementById('talk-input') as HTMLTextAreaElement).value.length > 0, null, { timeout: 3000 }).catch(() => null);
  const live = await p.inputValue('#talk-input');
  ok('휴대폰 받아쓰기: 말하는 동안 입력 칸에 글자', live === '만 원' || live === '만 원 이하 단백질 많이', live);
  const t0 = Date.now();
  await p.waitForFunction(() => !document.getElementById('mic')?.classList.contains('rec'), null, { timeout: 8000 }).catch(() => null);
  ok('휴대폰 받아쓰기: 말이 끝나고 2초 조용하면 저절로 끝', !(await p.locator('#mic.rec').count()) && Date.now() - t0 < 6000, `${((Date.now() - t0) / 1000).toFixed(1)}초`);
  await idle(p);
  await p.waitForTimeout(800);
  for (let w = 0; w < 30 && !calls.interpret.length; w++) await p.waitForTimeout(500); // 10/27: 젬마 먼저 → 해석이 늦게 옴
  ok('휴대폰 받아쓰기: 해석 1번 (말한 글 그대로), OpenAI 받아쓰기 0번', calls.interpret.length === 1 && calls.interpret[0] === '만 원 이하 단백질 많이' && calls.final === 0 && calls.live === 0, `interpret ${JSON.stringify(calls.interpret)} / openai ${calls.final + calls.live}`);
  await tab(p, 'taste');
  ok('말 기록에 "🎤 말 (휴대폰 받아쓰기)"', (await p.textContent('#talk-log'))?.includes('휴대폰 받아쓰기') ?? false);
  ok('오류 없음 (휴대폰 1)', !errors.length, errors.join(' | '));
  await browser.close();
}
// 6. 휴대폰 받아쓰기 중 [보내기] → 바로 끝 + 한 번만
{
  const { browser, p, calls, errors } = await session(null, 'fake');
  await startMic(p);
  await p.waitForTimeout(1200);
  await p.click('#talk-send');
  await idle(p);
  await p.waitForTimeout(800);
  for (let w = 0; w < 30 && !calls.interpret.length; w++) await p.waitForTimeout(500); // 10/27: 젬마 먼저 → 해석이 늦게 옴
  ok('휴대폰 받아쓰기 중 [보내기] → 바로 끝, 해석 1번', !(await p.locator('#mic.rec').count()) && calls.interpret.length === 1, JSON.stringify(calls.interpret));
  ok('오류 없음 (휴대폰 2)', !errors.length, errors.join(' | '));
  await browser.close();
}
// 7. 휴대폰 받아쓰기가 안 되는 브라우저 → OpenAI로 (그다음부턴 바로 OpenAI)
{
  const { browser, p, calls, errors } = await session(null, 'broken');
  await p.click('#mic');
  const agree = p.locator('#talk-result button', { hasText: '동의하고 켜기' });
  if (await agree.count()) await agree.click();
  await p.waitForFunction(() => document.getElementById('mic')?.classList.contains('rec'), null, { timeout: 8000 }).catch(() => null);
  await p.waitForSelector('#stt-fallback', { timeout: 3000 }).catch(() => null);
  ok('휴대폰 받아쓰기 실패 → "OpenAI로 받아써요" + 녹음 시작', (await p.locator('#stt-fallback').count()) === 1 && (await p.locator('#mic.rec').count()) === 1);
  await p.waitForTimeout(2200);
  await p.click('#talk-send');
  await idle(p);
  await p.waitForTimeout(800);
  for (let w = 0; w < 30 && !calls.interpret.length; w++) await p.waitForTimeout(500); // 10/27: 젬마 먼저 → 해석이 늦게 옴
  ok('OpenAI 받아쓰기 1번 → 해석 1번', calls.final === 1 && calls.interpret.length === 1, `final ${calls.final} interpret ${calls.interpret.length}`);
  await p.click('#mic');
  await p.waitForTimeout(800);
  ok('그다음 🎤는 바로 OpenAI (휴대폰 받아쓰기 다시 안 부름)', (await p.evaluate(() => (window as unknown as { __phoneStarts: number }).__phoneStarts)) === 1);
  ok('오류 없음 (휴대폰 실패)', !errors.length, errors.join(' | '));
  await browser.close();
}
// 4. 아래 탭: 주문 중이던 것 그대로, 취향 그래프 묶음
{
  const { browser, p, errors } = await session(null);
  await p.locator('#menu-list .menu .actions .btn-primary').first().click();
  await p.waitForSelector('#sheet .sheet', { state: 'attached' });
  const sheetBefore = (await p.textContent('#sheet .sheet h3')) ?? '';
  const bar = await p.locator('#tabbar').boundingBox();
  ok('아래 탭이 화면 맨 아래에 고정 (360px)', !!bar && Math.round(bar.y + bar.height) === 780 && bar.height >= 64, JSON.stringify(bar));
  await tab(p, 'taste');
  ok('[취향 그래프] → 주문 화면 숨김·그래프 6묶음·내 취향·말 기록·내 정보', !(await p.locator('#step-sheet').isVisible()) && (await p.locator('#taste-graph .graph-group').count()) === 6 && (await p.locator('#my-tastes').isVisible()) && (await p.locator('#talk-log').isVisible()) && (await p.locator('#settings-body [data-consent]').count()) === 4);
  ok('탭 버튼 표시 (aria-current)', (await p.getAttribute('#tabbtn-taste', 'aria-current')) === 'page' && !(await p.getAttribute('#tabbtn-order', 'aria-current')));
  const wide = await p.evaluate(() => document.documentElement.scrollWidth);
  ok('취향 그래프 넓이 넘침 없음', wide <= 360, String(wide));
  await p.screenshot({ path: 'var/mic-check-taste.png', fullPage: true });
  await tab(p, 'order');
  ok('[주문하기]로 돌아오면 고르던 것 그대로 (④ 보임)', (await p.locator('#step-order').isVisible()) && ((await p.textContent('#sheet .sheet h3')) ?? '') === sheetBefore, sheetBefore);
  ok('주문 화면에 내 취향·내 정보 칸이 안 남음', !(await p.locator('#my-tastes').isVisible()) && !(await p.locator('#settings').isVisible()));
  ok('오류 없음 (탭)', !errors.length, errors.join(' | '));
  await browser.close();
}
console.log(`마이크·탭 ${pass} / ${total}`);
process.exit(pass === total ? 0 : 1);
