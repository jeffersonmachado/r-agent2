# apps/mobile (Expo)

App mobile isolado para integração push do r-agent2 sem impactar o frontend web.

## Objetivo

- Registrar token nativo (FCM/APNs) no backend:
  - `POST /push/register`
  - `POST /push/unregister`
- Ao clicar na notificação, abrir rota lógica:
  - `/support/ticket/:ticketId`

## Pré-requisitos

- Node 20+
- Expo CLI via `npx expo`
- EAS CLI para builds nativos (`npx eas`)
- Dispositivo físico para validar push real

## Configuração

Por padrão, o app detecta automaticamente o host da máquina que está rodando o Metro:

- Dispositivo físico: usa IP LAN detectado pelo Metro (ex.: `192.168.x.x`)
- Emulador Android: fallback para `10.0.2.2`
- Simulador iOS: fallback para `127.0.0.1`

Se quiser sobrescrever manualmente, defina URL da API (sem barra final):

```bash
export EXPO_PUBLIC_API_BASE_URL=http://SEU_HOST:3001

# opcional: trocar apenas a porta mantendo auto-detecção de host
export EXPO_PUBLIC_API_PORT=3001
```

### Firebase Android (obrigatório para `getDevicePushTokenAsync`)

Se aparecer erro como `Default FirebaseApp is not initialized`:

1. No Firebase Console, adicione o app Android `com.results.ragent2`.
2. Baixe o arquivo `google-services.json`.
3. Salve em `apps/mobile/android/app/google-services.json`.
4. Recrie o app nativo Android:

```bash
cd apps/mobile
npx expo run:android
```

Observação: hot reload não aplica essa configuração nativa; precisa de rebuild/reinstalação do app.

No backend, mantenha:

```bash
# recomendado: arquivo JSON montado no container
FCM_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json
# opcional se quiser sobrescrever:
FCM_PROJECT_ID=...
# alternativa sem arquivo:
# FCM_SERVICE_ACCOUNT_JSON=...
APNS_TEAM_ID=...
APNS_KEY_ID=...
APNS_BUNDLE_ID=...
APNS_P8_PATH=... # ou APNS_P8
APNS_ENV=sandbox
```

## Rodar

```bash
cd apps/mobile
npm install
npx expo start
```

## Testes

```bash
cd apps/mobile
npm test
```

Cobertura com gate mínimo:

```bash
cd apps/mobile
npm run test:coverage
```

## Build EAS (recomendado para push)

```bash
cd apps/mobile
npx eas login
npx eas build --platform android --profile development
npx eas build --platform ios --profile development
```

## Observações

- `Expo Go` não valida esse fluxo de push nativo direto com backend.
- Use build EAS (development/preview/production).
