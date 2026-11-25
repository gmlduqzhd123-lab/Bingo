// 빙고 땅따먹기 퀴즈 오프라인 지원 — 같은 주소(github.io)의 다른 엽쌤 앱과 캐시 저장소를 함께 쓰므로 내 접두어 캐시만 지운다
const CACHE = 'bingo-v11';
const CACHE_PREFIX = 'bingo-v';
const CORE = [
  './',
  './index.html',
  './styles/main.css',
  './manifest.webmanifest',
  './ys-install.js',
  './ys-qr.js',
  './qr.svg',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './src/main.js',
  './src/data/sets.js',
  './src/core/questions.js',
  './src/core/engine.js',
  './src/utils/storage.js',
  './src/utils/audio.js',
  './src/utils/qr.js',
  './src/utils/cloud.js',
  './src/utils/image.js',
  './src/utils/imageStore.js',
  './src/utils/exportCard.js',
  './src/utils/realtime.js',
  './src/ui/shared.js',
  './src/ui/setup.js',
  './src/ui/editor.js',
  './src/ui/live.js',
  './src/ui/modals.js',
  './src/ui/board.js',
  './src/ui/question.js',
  './src/ui/rewards.js',
  './src/ui/result.js',
  './src/ui/game.js',
  './src/ui/print.js'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })
    .catch(() => caches.match(req).then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
