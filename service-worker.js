/* オフライン対応：
 *  - アプリ本体(HTML/JS/CSS等)はネット優先（更新を即反映、オフライン時のみキャッシュ）
 *  - 大きなデータ(.gz)はキャッシュ優先（毎回DLしない） */
const CACHE = 'jawiki-v5';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'engine.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/index.json.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // 大きなデータ(.gz)はキャッシュ優先（無ければ取得して保存）
  if (url.pathname.endsWith('.gz')) {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        })
      )
    );
    return;
  }

  // アプリ本体はネット優先（最新を取得しキャッシュ更新。オフライン時はキャッシュ）
  e.respondWith(
    fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return resp;
    }).catch(() =>
      caches.match(e.request).then((cached) => cached || caches.match('index.html'))
    )
  );
});
