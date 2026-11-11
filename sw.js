// EVOLVE Service Worker：オフラインでも開けるようにアプリ本体を保存します
// アプリを更新したら VERSION の数字を上げてください（古いキャッシュは自動で削除されます）
const VERSION = 'evolve-v1.4.0';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/store.js',
  './js/util.js',
  './js/calc.js',
  './js/game.js',
  './js/icons.js',
  './js/ui.js',
  './js/charts.js',
  './js/records.js',
  './js/backup.js',
  './js/demo.js',
  './js/quick.js',
  './js/photos.js',
  './js/camera.js',
  './js/health.js',
  './js/plan.js',
  './js/views/home.js',
  './js/views/training.js',
  './js/views/nutrition.js',
  './js/views/growth.js',
  './js/views/profile.js',
  './js/views/onboarding.js',
  './icons/icon.svg',
  './icons/logo-mark.svg',
  './icons/favicon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('evolve-') && k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ページを開くとき：ネットにつながればそのまま、つながらなければ保存済みの画面
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const cache = await caches.open(VERSION);
          cache.put('./index.html', res.clone());
        }
        return res;
      } catch {
        const cache = await caches.open(VERSION);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // それ以外（JS・CSS・画像）：保存済みを優先して素早く表示
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
