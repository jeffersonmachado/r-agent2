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

Defina URL da API (sem barra final):

```bash
export EXPO_PUBLIC_API_BASE_URL=http://SEU_HOST:3000
```

No backend, mantenha:

```bash
PUSH_ENABLED=true
FCM_PROJECT_ID=...
FCM_SERVICE_ACCOUNT_PATH=... # ou FCM_SERVICE_ACCOUNT_JSON
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
