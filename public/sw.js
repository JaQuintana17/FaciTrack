// Bump this whenever sw.js changes so the activate handler clears stale caches.
const CACHE_NAME = 'facitrack-v4';

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
    '/css/style.css',
    '/css/header.css',
    '/css/footer.css',

    '/css/student/dashboard.css',
    '/css/student/profile.css',
    '/css/instructor/dashboard.css',

    '/js/main.js',
    '/js/instructor-dashboard.js',

    '/images/FaciTrack-logo.png',
    '/manifest.json'
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch: network-first for navigation/API, cache-first for static assets
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Only handle same-origin requests
    if (url.origin !== location.origin) return;

    // JS files — network first so scripts always reflect latest version
    if (request.destination === 'script') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Static assets (CSS, images, fonts) — cache first
    if (
        request.destination === 'style' ||
        request.destination === 'image' ||
        request.destination === 'font'
    ) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) return cached;
                return fetch(request).then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Navigation requests (HTML pages) — network first, fallback to cache
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }
});

// ── Web Push: show a device notification ──
// Fires even when FaciTrack is closed — the browser wakes the service worker.
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (_) {
        data = { title: 'FaciTrack', body: event.data ? event.data.text() : '' };
    }

    event.waitUntil(
        self.registration.showNotification(data.title || 'FaciTrack', {
            body: data.body || '',
            icon: '/images/FaciTrack-logo.png',
            badge: '/images/FaciTrack-logo.png',
            // Same tag replaces an older notification for the same appointment
            // rather than stacking duplicates.
            tag: data.tag || 'facitrack',
            renotify: true,
            data: { url: data.url || '/' }
        })
    );
});

// ── Tapping the notification opens (or focuses) the right page ──
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Reuse an already-open FaciTrack tab instead of opening another one
            for (const client of windowClients) {
                if (client.url.includes(self.location.origin) && 'focus' in client) {
                    client.navigate(target);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(target);
        })
    );
});
