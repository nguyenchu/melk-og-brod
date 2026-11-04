const URL = '/api/push/web';

export async function prepareWebPush() {
  if (
    typeof window === 'undefined' ||
    !window.isSecureContext ||
    !('PushManager' in window) ||
    !('Notification' in window) ||
    !('serviceWorker' in navigator)
  )
    return null;

  const response = await fetch(URL, { cache: 'no-store' });
  if (!response.ok) return null;
  const { publicKey } = await response.json();
  if (typeof publicKey !== 'string') return null;
  const registration = await navigator.serviceWorker.register('/matkupp-push.js');
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return {
    enabled: Boolean(subscription) && Notification.permission === 'granted',
    async setEnabled(enabled: boolean) {
      if (enabled && (await Notification.requestPermission()) !== 'granted') {
        throw new Error('Tillat varsler for Matkupp i nettleserens nettstedsinnstillinger.');
      }
      const current = await registration.pushManager.getSubscription();
      const active = enabled
        ? (current ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: publicKey,
          })))
        : current;
      if (!active) return;
      try {
        const result = await fetch(URL, {
          method: enabled ? 'PUT' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(active),
        });
        if (!result.ok) throw new Error('Fikk ikke kontakt med varseltjenesten. Prøv igjen.');
      } catch (error) {
        if (enabled && !current) await active.unsubscribe();
        throw error;
      }
      if (!enabled) await active.unsubscribe();
    },
  };
}
