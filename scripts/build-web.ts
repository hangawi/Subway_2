// 화면 묶기: src/web → dist/web (app.js·sw.js 묶음, html·css·설치 정보·아이콘, Pretendard 글꼴은 필요한 글자만 받는 묶음)
// 외부 CDN 없음 (SOPHIA 디자인 규칙: 글꼴은 앱에 포함).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = 'dist/web';
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'fonts'), { recursive: true });
await build({ entryPoints: { app: 'src/web/app.ts', sw: 'src/web/sw.ts' }, bundle: true, format: 'esm', target: ['es2020', 'safari15', 'chrome90'], minify: true, outdir: out, logLevel: 'warning' });
for (const f of ['index.html', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'privacy.html', 'privacy.css']) copyFileSync(join('src/web', f), join(out, f));
// 앱 아이콘 PNG (scripts/make-icons.ts로 만듦)
mkdirSync(join(out, 'icons'), { recursive: true });
for (const n of readdirSync('src/web/icons')) copyFileSync(join('src/web/icons', n), join(out, 'icons', n));
// 메뉴 사진 (scripts/fetch-menu-images.ts로 받음, 한 장 ~11KB)
mkdirSync(join(out, 'menu-img'), { recursive: true });
for (const n of readdirSync('src/web/menu-img')) copyFileSync(join('src/web/menu-img', n), join(out, 'menu-img', n));
const fontDir = 'node_modules/pretendard/dist/web/variable';
// 폴더 통째 복사(cpSync recursive)는 Windows에서 멈춰서 파일을 하나씩
mkdirSync(join(out, 'fonts/woff2-dynamic-subset'), { recursive: true });
for (const n of readdirSync(join(fontDir, 'woff2-dynamic-subset'))) copyFileSync(join(fontDir, 'woff2-dynamic-subset', n), join(out, 'fonts/woff2-dynamic-subset', n));
// 글꼴 CSS의 경로를 /fonts/ 아래로
const css = readFileSync(join(fontDir, 'pretendardvariable-dynamic-subset.css'), 'utf8').replaceAll('./woff2-dynamic-subset/', '/fonts/woff2-dynamic-subset/');
writeFileSync(join(out, 'fonts/pretendard.css'), css);
console.log('web built →', out);
