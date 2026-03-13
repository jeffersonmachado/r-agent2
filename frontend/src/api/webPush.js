import { fetchJson } from './client';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export async function fetchWebPushPublicKey() {
  const response = await fetchJson('/api/push/public-key', {
    expectedStatuses: [503],
    suppressErrorLog: true,
  });
  return response?.publicKey || null;
}

export async function subscribeCurrentUserWebPush({ deviceName = null } = {}) {
  if (!isWebPushSupported()) {
    throw new Error('Web Push não suportado neste navegador.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Permissão de notificação não concedida.');
  }

  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (current) {
    await fetchJson('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription: current.toJSON(),
        ...(deviceName ? { deviceName } : {}),
      }),
    });
    return current.toJSON();
  }

  const publicKey = await fetchWebPushPublicKey();
  if (!publicKey) {
    throw new Error('Chave pública VAPID indisponível no servidor.');
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetchJson('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      ...(deviceName ? { deviceName } : {}),
    }),
  });

  return subscription.toJSON();
}

export async function unsubscribeCurrentUserWebPush() {
  if (!isWebPushSupported()) {
    return false;
  }

  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  if (!current) {
    return true;
  }

  const endpoint = current.endpoint;
  try {
    await fetchJson('/api/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
      suppressErrorLog: true,
      expectedStatuses: [404],
    });
  } finally {
    await current.unsubscribe();
  }

  return true;
}

export async function getCurrentWebPushSubscription() {
  if (!isWebPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  return current ? current.toJSON() : null;
}
