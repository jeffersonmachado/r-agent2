# Push Notifications Setup (FCM + APNs)

Este guia configura push notifications no `r-agent2` para Android (FCM) e iOS (APNs).

## App mobile no repositório

Foi adicionado um módulo isolado em `apps/mobile` (Expo + EAS) para testar e usar:
- registro em `POST /push/register`
- remoção em `POST /push/unregister`
- leitura de `ticketId` ao clicar notificação

## 1) Variáveis de ambiente

No backend (`api/server.js`), configure:

```bash
PUSH_ENABLED=true

# Android / FCM
FCM_PROJECT_ID=seu-projeto
FCM_SERVICE_ACCOUNT_JSON=... # JSON inline ou base64
# ou
FCM_SERVICE_ACCOUNT_PATH=/opt/keys/firebase-service-account.json

# iOS / APNs
APNS_TEAM_ID=SEU_TEAM_ID
APNS_KEY_ID=SEU_KEY_ID
APNS_BUNDLE_ID=com.suaempresa.seuapp
APNS_P8=... # conteúdo .p8 inline ou base64
# ou
APNS_P8_PATH=/opt/keys/AuthKey_XXXXXX.p8
APNS_ENV=sandbox # ou production
```

Com `PUSH_ENABLED=true`, o backend valida essas variáveis no startup.

## 2) Android (FCM)

1. Crie/abra um projeto no Firebase Console.
2. Adicione app Android e baixe `google-services.json` para o app mobile.
3. Em `Project settings > Service accounts`, gere uma chave JSON.
4. Salve no servidor e referencie por `FCM_SERVICE_ACCOUNT_PATH` (recomendado) ou `FCM_SERVICE_ACCOUNT_JSON`.

## 3) iOS (APNs)

1. No Apple Developer, crie uma APNs Auth Key (`.p8`).
2. Guarde `Team ID`, `Key ID` e o `Bundle ID` do app.
3. Configure `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID` e `APNS_P8_PATH` (ou `APNS_P8`).
4. Use `APNS_ENV=sandbox` em desenvolvimento/TestFlight inicial; `production` em release.

## 4) Registro de token no backend

Após login no app mobile, registrar token:

`POST /push/register`

```json
{
  "platform": "android",
  "token": "<push-token>",
  "device_name": "Pixel 8",
  "device_id": "device-123",
  "app_version": "1.0.0"
}
```

Logout/desinstalação:

`POST /push/unregister`

```json
{
  "platform": "android",
  "token": "<push-token>"
}
```

## 5) Exemplo React Native (Firebase Messaging)

```ts
import messaging from '@react-native-firebase/messaging';

async function setupPush(apiClient: any) {
  await messaging().requestPermission();
  const token = await messaging().getToken();

  await apiClient.post('/push/register', {
    platform: 'android',
    token,
    device_name: 'RN device',
    app_version: '1.0.0',
  });

  messaging().onNotificationOpenedApp((remoteMessage) => {
    const ticketId = remoteMessage?.data?.ticketId;
    if (ticketId) {
      // Abra rota do ticket
      // navigation.navigate('SupportTicket', { ticketId });
      // ou webview: /support/ticket/:ticketId
    }
  });
}
```

## 6) Expo (recomendado: EAS Build + token nativo)

Importante:
- `Expo Go` não serve para este backend (ele usa `ExpoPushToken`).
- Use `EAS Build` (dev/prod build) e registre token nativo com `getDevicePushTokenAsync()`.

```ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

async function setupExpoNativePush(apiClient: any, router: any) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const devicePush = await Notifications.getDevicePushTokenAsync();
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  await apiClient.post('/push/register', {
    platform,
    token: String(devicePush.data),
    device_name: 'expo-device',
    app_version: '1.0.0',
  });

  Notifications.addNotificationResponseReceivedListener((response) => {
    const ticketId = response.notification.request.content.data?.ticketId;
    if (ticketId) router.push(`/support/ticket/${ticketId}`);
  });
}
```

## 7) Exemplo Capacitor

```ts
import { PushNotifications } from '@capacitor/push-notifications';

async function setupPush(apiClient: any, router: any) {
  await PushNotifications.requestPermissions();
  await PushNotifications.register();

  PushNotifications.addListener('registration', async (token) => {
    await apiClient.post('/push/register', {
      platform: 'ios',
      token: token.value,
      device_name: 'Capacitor device',
      app_version: '1.0.0',
    });
  });

  PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
    const ticketId = event.notification?.data?.ticketId;
    if (ticketId) router.push(`/support/ticket/${ticketId}`);
  });
}
```

## 8) Payload enviado pelo backend

```json
{
  "notification": {
    "title": "Nova mensagem no WhatsApp",
    "body": "5511999999999: Olá, preciso de ajuda"
  },
  "data": {
    "tenantId": "tenant-1",
    "ticketId": "ticket-123",
    "channel": "whatsapp",
    "conversationId": "conv-123",
    "kind": "ticket_message"
  }
}
```

Ao tocar na notificação, abra: `/support/ticket/:ticketId`.
