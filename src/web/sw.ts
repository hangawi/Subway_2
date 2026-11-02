// 서비스 워커: 홈 화면 설치용. 화면 파일만 잠깐 보관하고(끊겼을 때 빈 화면 방지), API는 늘 서버에서 새로 받는다.
/// <reference lib="webworker" />
const VERSION = 'subway-web-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icon.svg', '/fonts/pretendard.css'];
const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => sw.skipWaiting()));
});
sw.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => sw.clients.claim()));
});
sw.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // 화면 파일: 새로 받고, 끊기면 보관한 것
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copy = r.clone();
        if (r.ok) void caches.open(VERSION).then((c) => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then((m) => m ?? caches.match('/') as Promise<Response>)),
  );
});
