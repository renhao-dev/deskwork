// Deskwork service worker. It never caches the app itself (the server is the source of truth);
// it only shows a friendly page when the Deskwork server isn't running.
const OFFLINE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('deskwork-offline-v1').then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  // 'reload' skips the browser's cache, so a new version is picked up as soon as it exists.
  event.respondWith(fetch(event.request, { cache: 'reload' }).catch(() => caches.match(OFFLINE)))
})

// Clicking a notification brings the Deskwork window forward (or opens one).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin)
      return open ? open.focus() : self.clients.openWindow('/')
    }),
  )
})
