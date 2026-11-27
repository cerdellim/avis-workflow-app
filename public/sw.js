// Service worker della PWA. Non mette in cache le API.
// Il click usa la stessa regola di src/shared/notification-click.ts.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Nessuna risposta personalizzata: il browser usa la rete, anche per /api.
});

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'Avis Berceto';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const path = notificationPath(payload);
  event.waitUntil(self.registration.showNotification(title, { body, data: { path } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = notificationPath(event.notification.data);
  event.waitUntil(openNotificationPath(path));
});

function readPayload(event) {
  try {
    return event.data ? event.data.json() : {};
  } catch {
    return {};
  }
}

function notificationPath(data) {
  const path = data && typeof data.path === 'string' ? data.path : '';
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.includes('://')
  ) {
    return '/notifiche';
  }
  return path;
}

async function openNotificationPath(path) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).pathname === path) {
      await client.focus();
      return;
    }
  }
  const current = windows[0];
  if (current && typeof current.navigate === 'function') {
    await current.navigate(path);
    await current.focus();
    return;
  }
  await self.clients.openWindow(path);
}
