const CACHE = 'timedplaylist-v1';
const SHELL = [
  '/playball/',
  '/playball/index.html',
  '/playball/config.js',
  '/playball/manifest.json',
  '/playball/icon.svg',
  '/playball/css/styles.css',
  '/playball/js/auth.js',
  '/playball/js/github.js',
  '/playball/js/app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Never intercept Spotify / GitHub API calls
  if (['api.spotify.com', 'accounts.spotify.com', 'api.github.com', 'sdk.scdn.co',
       'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
