import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { postJson, type ApiRequestError } from './api';
import { isExpoGoRuntime } from './runtime';

export type PushPlatform = 'android' | 'ios';

export type RegisteredPush = {
  platform: PushPlatform;
  token: string;
};

let isNotificationHandlerConfigured = false;

function logFrontendPush(event: string, details: Record<string, unknown> = {}): void {
  if (!__DEV__) return;
  // eslint-disable-next-line no-console
  console.log('[frontend/push]', event, details);
}

function getNotificationsModule(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
}

function buildFirebaseSetupErrorMessage(originalMessage: string): string {
  return [
    'Firebase não inicializado no app Android.',
    'Adicione google-services.json no caminho nativo Android e gere novo build.',
    'Passos: 1) baixar google-services.json no Firebase Console, 2) salvar em apps/mobile/android/app/google-services.json, 3) executar npx expo run:android novamente.',
    `Detalhe: ${originalMessage}`,
  ].join(' ');
}

function resolvePlatform(): PushPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

function ensureNotificationHandlerConfigured(): void {
  if (isNotificationHandlerConfigured) {
    return;
  }

  const Notifications = getNotificationsModule();
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  isNotificationHandlerConfigured = true;
}

function shouldRetryWithApiPrefix(err: unknown): boolean {
  const apiErr = err as ApiRequestError;
  if (apiErr?.status === 404 || apiErr?.status === 405) return true;
  const message = String(apiErr?.message || '').toLowerCase();
  return message.includes('http 404') || message.includes('http 405') || message.includes('not_found');
}

async function postPushWithRouteFallback<T = unknown>(args: {
  baseUrl: string;
  path: '/push/register' | '/push/unregister';
  token: string;
  tenantId?: string;
  requestId?: string;
  body: Record<string, unknown>;
}): Promise<T> {
  try {
    return await postJson<T>(args);
  } catch (err) {
    if (!shouldRetryWithApiPrefix(err)) {
      throw err;
    }
    const fallbackPath = `/api${args.path}` as '/api/push/register' | '/api/push/unregister';
    logFrontendPush('route_fallback_retry', {
      requestId: args.requestId || null,
      fromPath: args.path,
      toPath: fallbackPath,
      status: (err as ApiRequestError)?.status || null,
      message: (err as Error)?.message || String(err),
    });
    return postJson<T>({
      ...args,
      path: fallbackPath,
    });
  }
}

export async function registerNativePush(args: {
  apiBaseUrl: string;
  authToken: string;
  tenantId?: string;
  appVersion: string;
  requestId?: string;
}): Promise<RegisteredPush> {
  logFrontendPush('register_start', {
    requestId: args.requestId || null,
    apiBaseUrl: args.apiBaseUrl,
    hasAuthToken: Boolean(args.authToken),
    tenantId: args.tenantId || null,
    appVersion: args.appVersion,
  });

  if (isExpoGoRuntime()) {
    throw new Error('Push remoto não é suportado no Expo Go. Use um development build.');
  }

  ensureNotificationHandlerConfigured();
  const Notifications = getNotificationsModule();

  if (!Device.isDevice) {
    throw new Error('Push requer dispositivo físico para teste real');
  }

  const permission = await Notifications.requestPermissionsAsync();
  logFrontendPush('permissions_result', {
    status: permission.status,
    canAskAgain: permission.canAskAgain,
  });
  if (permission.status !== 'granted') {
    throw new Error('Permissão de notificação negada');
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0EA5E9',
    });
  }

  let devicePushToken: { data: string };
  try {
    devicePushToken = await Notifications.getDevicePushTokenAsync();
    logFrontendPush('device_token_ok', {
      platform: Platform.OS,
      tokenPreview: `${String(devicePushToken?.data || '').slice(0, 10)}...`,
    });
  } catch (err) {
    const raw = (err as Error)?.message || String(err || '');
    const normalized = raw.toLowerCase();
    const isFirebaseInitError =
      normalized.includes('default firebaseapp is not initialized') ||
      normalized.includes('make sure to complete the guide') ||
      normalized.includes('firebaseapp') ||
      normalized.includes('google-services');

    if (isFirebaseInitError && Platform.OS === 'android') {
      throw new Error(buildFirebaseSetupErrorMessage(raw));
    }
    throw err;
  }
  const platform = resolvePlatform();
  const token = String(devicePushToken.data);

  await postPushWithRouteFallback({
    baseUrl: args.apiBaseUrl,
    path: '/push/register',
    token: args.authToken,
    tenantId: args.tenantId,
    requestId: args.requestId,
    body: {
      platform,
      token,
      device_name: Device.deviceName || `${Platform.OS}-device`,
      device_id: Device.osBuildId || null,
      app_version: args.appVersion,
    },
  });

  logFrontendPush('register_api_ok', {
    platform,
    tenantId: args.tenantId || null,
  });

  return { platform, token };
}

export async function unregisterNativePush(args: {
  apiBaseUrl: string;
  authToken: string;
  tenantId?: string;
  platform: PushPlatform;
  token: string;
  requestId?: string;
}): Promise<void> {
  logFrontendPush('unregister_start', {
    requestId: args.requestId || null,
    apiBaseUrl: args.apiBaseUrl,
    tenantId: args.tenantId || null,
    platform: args.platform,
    tokenPreview: `${String(args.token || '').slice(0, 10)}...`,
  });
  await postPushWithRouteFallback({
    baseUrl: args.apiBaseUrl,
    path: '/push/unregister',
    token: args.authToken,
    tenantId: args.tenantId,
    requestId: args.requestId,
    body: {
      platform: args.platform,
      token: args.token,
    },
  });
  logFrontendPush('unregister_api_ok', { platform: args.platform });
}
