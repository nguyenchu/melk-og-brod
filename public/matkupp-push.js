/* global self, clients */
self.addEventListener('push', (event) => {
  const body = event.data?.json().body;
  if (typeof body !== 'string') return;
  event.waitUntil(
    self.registration.showNotification('Kjempetilbud i Matkupp', {
      body,
      tag: 'matkupp-super-deals',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/deals?superDeals=1'));
});
