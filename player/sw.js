// App-shell cache so the player opens offline on an owned device.
// It only ever caches the app's own files (same origin). Pebbble content from R2
// is cross-origin and is never touched here: on a not-owned device nothing about
// a pebbble may be stored, and on an owned device IndexedDB holds it instead.

const CACHE = 'pebbble-shell-v1';
const SHELL = [
    './', './player.js', './library.js', './manifest.json', './icons/icon-192.png',
    '../shared/format.js', '../shared/r2.js', '../shared/config.js', '../shared/i18n.js', '../shared/base.css',
    '../shared/i18n/en.json', '../shared/i18n/fr.json', '../shared/i18n/es.json', '../shared/i18n/zh.json',
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Network first (updates arrive right away), cache as fallback when offline.
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    // Never pebbble content: R2 is another origin; /bucket/ is the local dev stand-in.
    if (e.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/bucket/')) return;
    e.respondWith(
        fetch(e.request)
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
