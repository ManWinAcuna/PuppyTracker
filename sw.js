// Minimal service worker — lets the app show system notifications
// and focuses the app when you tap one.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
// background pushes sent by the GitHub checker
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data.json(); } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || '🐾 Puppy Tracker', {
    body: d.body || '',
    icon: 'icon.svg',
    badge: 'icon.svg',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(cs => (cs.length ? cs[0].focus() : clients.openWindow('.')))
  );
});
