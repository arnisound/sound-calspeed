// Offline cache (cache-first for app files, updated in the background).
const CACHE = 'calspeed-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/store.js', 'js/measure.js',
  'js/audio/engine.js', 'js/audio/recorder-worklet.js',
  'js/dsp/fft.js', 'js/dsp/signals.js', 'js/dsp/analysis.js', 'js/dsp/align.js', 'js/dsp/eq.js', 'js/dsp/room.js',
  'js/ui/dom.js', 'js/ui/plot.js',
  'js/data/targets.js', 'js/data/brands.js', 'js/data/cabling.js',
  'js/views/guide.js', 'js/views/audio.js', 'js/views/rta.js', 'js/views/measure.js', 'js/views/align.js',
  'js/views/cardio.js', 'js/views/eq.js', 'js/views/room.js', 'js/views/memo.js', 'js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then((res) => {
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
