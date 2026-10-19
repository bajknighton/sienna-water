// Service worker: shows reminders and opens the app when tapped.
const CACHE = 'sienna-v1';
const SHELL = ['/', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first (so updates show up), cache as a fallback when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/')))
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Water time!', body: e.data?.text() || '' }; }
  const isDone = (data.title || '').startsWith('✅');
  e.waitUntil(Promise.all([
    self.registration.showNotification(data.title || 'Water time!', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      renotify: !!data.tag,
      requireInteraction: !isDone,
      data: { url: data.url || '/' },
    }),
    // Red badge on the Home Screen icon while a reminder is waiting.
    isDone ? (self.navigator.clearAppBadge?.() || Promise.resolve()).catch(() => {})
           : (self.navigator.setAppBadge?.(1) || Promise.resolve()).catch(() => {}),
    self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage('refresh'))),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
