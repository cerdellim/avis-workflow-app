import { api } from './api';

const STORAGE_KEY = 'volontari.pushSubscriptionId';

export function devicePushEnabled(): boolean {
  return sessionStorage.getItem(STORAGE_KEY) !== null;
}

export async function enableDevicePush(): Promise<string> {
  if (
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return 'Questo browser non riceve le notifiche push. L’elenco interno resta disponibile.';
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return 'Permesso negato. L’app continua a funzionare e le notifiche restano nell’elenco.';
  }
  let subscription: PushSubscription;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const key = await api<{ publicKey: string }>('/api/push/vapid-public-key');
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(key.publicKey),
    });
  } catch {
    return "Non riesco ad attivare le notifiche su questo dispositivo. L'elenco interno resta disponibile.";
  }
  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return 'Non riesco ad attivare le notifiche su questo dispositivo.';
  }
  const saved = await api<{ id: string }>('/api/push/subscriptions', {
    method: 'POST',
    body: { endpoint, keys: { p256dh, auth } },
  });
  sessionStorage.setItem(STORAGE_KEY, saved.id);
  return 'Notifiche attivate su questo dispositivo.';
}

export async function disableDevicePush(): Promise<void> {
  const id = sessionStorage.getItem(STORAGE_KEY);
  const registration = await navigator.serviceWorker.getRegistration();
  const current = await registration?.pushManager.getSubscription();
  await current?.unsubscribe();
  if (id) {
    await api(`/api/push/subscriptions/${id}`, { method: 'DELETE' });
  }
  sessionStorage.removeItem(STORAGE_KEY);
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
