// サービスワーカー：アプリの画面（HTML・CSS・JS・アイコン）を端末に保存して、オフラインでも開けるようにする
// - 自分のサイトのファイル：まずネットから取り、取れなければ保存したものを使う（設定の変更がすぐ反映されるように）
// - CDN のライブラリ・フォント：保存したものを先に使う（版を固定しているので中身は変わらない）
// - Supabase（データ・ログイン・写真）：保存しない（そのまま通す）
// アプリを更新したら、下の VERSION を上げる（古い保存を消して、新しいファイルを保存し直す）
const VERSION = 'v1.1.0';
const APP_CACHE = `kaimono-app-${VERSION}`;
const CDN_CACHE = 'kaimono-cdn-v1';
const NETWORK_TIMEOUT_MS = 4000;
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

const APP_FILES = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/style.css',
  './js/boot-guard.js',
  './js/app.js',
  './js/util.js',
  './js/db.js',
  './js/categories.js',
  './js/image.js',
  './js/seed.js',
  './js/store.js',
  './js/backend-local.js',
  './js/backend-supabase.js',
  './js/ui/main.js',
  './js/ui/dom.js',
  './js/ui/constants.js',
  './js/ui/icons.js',
  './js/ui/theme.js',
  './js/ui/gestures.js',
  './js/ui/actions.js',
  './js/ui/home.js',
  './js/ui/list.js',
  './js/ui/item-sheet.js',
  './js/ui/sheets.js',
  './js/ui/auth.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then((cache) => cache.addAll(APP_FILES.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kaimono-app-') && k !== APP_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) event.respondWith(networkFirst(req));
  else if (CDN_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(req));
  // それ以外（Supabase など）は何もしない＝ブラウザがそのまま通信する
});

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

async function networkFirst(req) {
  const cache = await caches.open(APP_CACHE);
  try {
    const res = await Promise.race([fetch(req), timeout(NETWORK_TIMEOUT_MS)]);
    if (res.ok && new URL(req.url).search === '') cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}
