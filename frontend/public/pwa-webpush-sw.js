/* global self, clients */

function resolveTargetUrl(data) {
  const payload = data && typeof data === 'object' ? data : {};
  if (typeof payload.url === 'string' && payload.url.trim()) return payload.url.trim();
  if (typeof payload.path === 'string' && payload.path.trim()) return payload.path.trim();
  if (typeof payload.ticketId === 'string' && payload.ticketId.trim()) {
    return `support?ticketId=${encodeURIComponent(payload.ticketId.trim())}`;
  }
  return 'support';
}

function toScopedUrl(target) {
  const scopeUrl = new URL(self.registration.scope);
  const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
  const value = String(target || '').trim() || 'support';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith(scopePath)) return value;
  if (value.startsWith('/')) {
    const withoutSlash = value.replace(/^\/+/, '');
    return `${scopePath}${withoutSlash}`;
  }
  return `${scopePath}${value}`;
}

self.addEventListener('push', (event) => {
  const payload = (() => {
    if (!event.data) return {};
    try {
      return event.data.json();
    } catch {
      return { body: event.data.text() };
    }
  })();

  const title = String(payload.title || payload.notification?.title || 'RIA');
  const body = String(payload.body || payload.notification?.body || 'Você recebeu uma atualização.');
  const data = (payload.data && typeof payload.data === 'object') ? payload.data : payload;
  const targetUrl = toScopedUrl(resolveTargetUrl(data));

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192-maskable.png',
      data: {
        url: targetUrl,
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = toScopedUrl(event.notification?.data?.url || 'support');
  const targetUrl = new URL(target, self.location.origin);

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const url = new URL(client.url);
      const samePath = `${url.pathname}${url.search}` === `${targetUrl.pathname}${targetUrl.search}`;
      if (samePath && 'focus' in client) {
        await client.focus();
        return;
      }
    }

    if (clients.openWindow) {
      await clients.openWindow(target);
    }
  })());
});
