import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { postJson } from './api';
import { isExpoGoRuntime } from './runtime';

export type PushPlatform = 'android' | 'ios';

export type RegisteredPush = {
  platform: PushPlatform;
  token: string;
};

let isNotificationHandlerConfigured = false;

function getNotificationsModule(): typeof import('expo-notifications') {
  return require('expo-notifications') as typeof import('expo-notifications');
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

export async function registerNativePush(args: {
  apiBaseUrl: string;
  authToken: string;
  appVersion: string;
}): Promise<RegisteredPush> {
  if (isExpoGoRuntime()) {
    throw new Error('Push remoto não é suportado no Expo Go. Use um development build.');
  }

  ensureNotificationHandlerConfigured();
  const Notifications = getNotificationsModule();

  if (!Device.isDevice) {
    throw new Error('Push requer dispositivo físico para teste real');
  }

  const permission = await Notifications.requestPermissionsAsync();
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

  const devicePushToken = await Notifications.getDevicePushTokenAsync();
  const platform = resolvePlatform();
  const token = String(devicePushToken.data);

  await postJson({
    baseUrl: args.apiBaseUrl,
    path: '/push/register',
    token: args.authToken,
    body: {
      platform,
      token,
      device_name: Device.deviceName || `${Platform.OS}-device`,
      device_id: Device.osBuildId || null,
      app_version: args.appVersion,
    },
  });

  return { platform, token };
}

export async function unregisterNativePush(args: {
  apiBaseUrl: string;
  authToken: string;
  platform: PushPlatform;
  token: string;
}): Promise<void> {
  await postJson({
    baseUrl: args.apiBaseUrl,
    path: '/push/unregister',
    token: args.authToken,
    body: {
      platform: args.platform,
      token: args.token,
    },
  });
}
