// 앱 아이콘 PNG 만들기 (10/16): src/web/icon.svg → src/web/icons/*.png
// 안드로이드 설치에는 192·512 PNG, 아이폰 홈 화면에는 180 PNG(apple-touch-icon)가 필요하다.
// maskable(안드로이드가 동그라미·물방울 모양으로 잘라 쓰는 것)은 모서리 둥글림을 없애고 그림을 가운데 80%로 줄인다.
// 실행: npx tsx scripts/make-icons.ts  (아이콘 그림을 바꾸면 다시 실행해서 PNG도 커밋)
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const svg = readFileSync('src/web/icon.svg', 'utf8');
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#00703c"/><g transform="translate(51.2 51.2) scale(0.8)">${inner.replace('rx="112" ', '')}</g></svg>`;

mkdirSync('src/web/icons', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
const shoot = async (markup: string, size: number, out: string) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator('svg').screenshot({ path: out, omitBackground: true });
};
await shoot(svg, 192, 'src/web/icons/icon-192.png');
await shoot(svg, 512, 'src/web/icons/icon-512.png');
await shoot(maskable, 512, 'src/web/icons/icon-maskable-512.png');
// 아이폰은 투명한 곳을 검게 칠하고 스스로 둥글게 자르므로 꽉 찬 사각형으로
await shoot(maskable.replace('scale(0.8)', 'scale(0.9)').replace('translate(51.2 51.2)', 'translate(25.6 25.6)'), 180, 'src/web/icons/apple-touch-icon.png');
await browser.close();
console.log('icons → src/web/icons');
