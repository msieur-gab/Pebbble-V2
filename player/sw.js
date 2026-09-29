// App-shell cache so the player opens offline on an owned device.
// It only ever caches the app's own files (same origin). Pebbble content from R2
// is cross-origin and is never touched here: on a not-owned device nothing about
// a pebbble may be stored, and on an owned device IndexedDB holds it instead.

const CACHE = 'pebbble-shell-v12';
const SHELL = [
    './', './player.js', './player.css', './library.js', './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png',
    '../shared/format.js', '../shared/cover.js', '../shared/r2.js', '../shared/config.js', '../shared/i18n.js', '../shared/ui.js', '../shared/ui.css',
    '../shared/i18n/en.json', '../shared/i18n/fr.json', '../shared/i18n/es.json', '../shared/i18n/zh.json',
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Network first, cache as fallback when offline. 'no-cache' makes the browser
// revalidate with the server every time instead of reusing its own HTTP cache
// (GitHub Pages marks files fresh for 10 minutes), so a new push shows up on the next load.
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    // Never pebbble content: R2 is another origin; /bucket/ is the local dev stand-in.
    if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/bucket/')) return;
    e.respondWith(
        fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
            .then(res => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, copy));
                }
                return res;
            })
            .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))),
    );
});
