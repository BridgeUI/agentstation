/*
 * Service Worker（PWA 用）。
 * 方針：
 * - /api/* は一切キャッシュしない（状態はいつも最新。Access の 401/302 もそのまま返す）
 * - 画面・CSS・JS・アイコンは「ネットワーク優先、落ちていたらキャッシュ」。更新を取りこぼさない
 * - 画面が開けないときだけ offline.html を返す
 * - Cloudflare Access のログインへのリダイレクト（別オリジン）には触らない
 */
const CACHE = 'agentstation-v1';
// Workers の静的アセットは /host.html を /host に 307 で寄せる（html_handling の既定）ので両方入れる
const PRECACHE = [
  '/',
  '/host',
  '/vm1',
  '/vm2',
  '/guide',
  '/offline',
  '/offline.html',
  '/style.css',
  '/app.js',
  '/logo.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Access のログイン画面など
  if (url.pathname.startsWith('/api/')) return; // 状態と操作はキャッシュしない

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req);
        // Access のセッション切れは別オリジンへの 302 になる。その結果（redirected）は保存しない
        if (res.ok && !res.redirected && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch {
        const hit =
          (await cache.match(req, { ignoreSearch: true })) ??
          (await cache.match(url.pathname.replace(/\.html$/, '') || '/'));
        if (hit) return hit;
        if (req.mode === 'navigate') {
          const off = (await cache.match('/offline')) ?? (await cache.match('/offline.html'));
          if (off) return off;
        }
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })(),
  );
});
