// 메뉴 사진 (10/17, 2-7): 써브웨이 코리아 공식 홈페이지 메뉴 목록의 사진을 받아 휴대폰용으로 줄여 우리 서버에 둔다.
// 화면은 외부 사진을 못 부른다 (CSP img-src 'self') → src/web/menu-img/<공식 번호>.webp 로 저장, 빌드가 dist/web으로 복사.
// 줄이기: 이미 있는 Playwright 크롬의 canvas로 webp (새 패키지 없음). 가로 360px, 한 장 50KB 넘으면 품질을 낮춤.
// 실행: npx tsx scripts/fetch-menu-images.ts
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadSubwayCatalog } from '../src/catalog/subway-catalog.ts';

const BASE = 'https://www.subway.co.kr';
const OUT = 'src/web/menu-img';
const PAGES = ['sandwich', 'salad', 'grain_salad', 'morning', 'unit', 'sidedrink'] as const;
const WIDTH = 360;
const MAX_BYTES = 50 * 1024;

const stripComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '');
const unescape = (s: string) => s.replace(/&amp;/g, '&');

async function get(path: string) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res;
}

// 공식 번호(menuItemIdx) → 사진 주소
const srcOf = new Map<string, string>();
for (const page of PAGES) {
  const html = stripComments(await (await get(`/menuList/${page}`)).text());
  for (const m of html.matchAll(/<li[^>]*class="ITEM_[A-Z_.]+"[^>]*>([\s\S]*?)<\/li>/g)) {
    const body = m[1] ?? '';
    const idx = body.match(/data-menuitemidx="(\d+)"/)?.[1];
    const src = body.match(/<img[^>]*src="(\/upload\/menu\/[^"]+)"/)?.[1];
    if (idx && src && !srcOf.has(idx)) srcOf.set(idx, unescape(src));
  }
}

const catalog = loadSubwayCatalog();
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const done: Array<{ idx: string; name: string; bytes: number; from: string }> = [];
const missing: string[] = [];
for (const menu of catalog.menus) {
  const idx = menu.officialIdx;
  const src = idx ? srcOf.get(idx) : undefined;
  if (!idx || !src) {
    missing.push(menu.name);
    continue;
  }
  const res = await get(encodeURI(src).replace(/#/g, '%23')).catch(() => null);
  if (!res) {
    missing.push(menu.name);
    continue;
  }
  const type = res.headers.get('content-type') ?? 'image/png';
  const dataUrl = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  // page.evaluate에 함수 대신 글을 넘김 (tsx가 붙이는 __name 문제를 피함)
  const webp: string | null = await page.evaluate(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(dataUrl)};
    try { await img.decode(); } catch { return null; }
    // 공식 사진은 둘레가 투명한 빈 곳이라 음식이 작게 보임 → 투명하지 않은 부분만 잘라 냄 (10/19 화면 다듬기)
    const full = document.createElement('canvas');
    full.width = img.naturalWidth; full.height = img.naturalHeight;
    const fx = full.getContext('2d');
    fx.drawImage(img, 0, 0);
    const px = fx.getImageData(0, 0, full.width, full.height).data;
    let x0 = full.width, y0 = full.height, x1 = -1, y1 = -1;
    for (let y = 0; y < full.height; y++) for (let x = 0; x < full.width; x++) {
      const i = (y * full.width + x) * 4;
      const blank = px[i + 3] < 16 || (px[i] > 248 && px[i + 1] > 248 && px[i + 2] > 248);
      if (!blank) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = full.width - 1; y1 = full.height - 1; }
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.03);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(full.width - 1, x1 + pad); y1 = Math.min(full.height - 1, y1 + pad);
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    const w = Math.min(${WIDTH}, cw);
    const h = Math.round(ch * w / cw);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(full, x0, y0, cw, ch, 0, 0, w, h);
    for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
      const out = c.toDataURL('image/webp', q);
      if (out.length * 0.75 <= ${MAX_BYTES} || q === 0.4) return out;
    }
    return null;
  })()`);
  if (!webp?.startsWith('data:image/webp')) {
    missing.push(menu.name);
    continue;
  }
  const buf = Buffer.from(webp.split(',')[1]!, 'base64');
  writeFileSync(`${OUT}/${idx}.webp`, buf);
  done.push({ idx, name: menu.name, bytes: buf.length, from: BASE + src });
}
await browser.close();
// 어디서 받았는지 기록 (출처·받은 때)
writeFileSync('data/official/menu-images.json', JSON.stringify({ source: { site: BASE, retrievedAt: new Date().toISOString() }, images: done }, null, 2) + '\n');
const total = done.reduce((s, x) => s + x.bytes, 0);
console.log(`사진 ${done.length}장 (평균 ${Math.round(total / Math.max(1, done.length) / 1024)}KB, 가장 큰 것 ${Math.round(Math.max(0, ...done.map((x) => x.bytes)) / 1024)}KB), 사진 없음 ${missing.length}: ${missing.join(', ')}`);
