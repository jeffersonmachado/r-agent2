# 📱 Guia: Testando Push Notifications no App Mobile

## 📋 Overview

O app mobile (React Native + Expo) suporta push notifications via:
- **Android**: Firebase Cloud Messaging (FCM)
- **iOS**: Apple Push Notification service (APNs)

## 🎯 Fluxo de Push

```
Usuario abre app mobile
         ↓
App solicita permissões de notificação
         ↓
App recebe token de push (FCM/APNs)
         ↓
App registra token na API (POST /push/register)
         ↓
API armazena token no DB
         ↓
Backend envia notificação (sendToUser/sendToTokens)
         ↓
FCM/APNs entrega notificação ao device
         ↓
App recebe e exibe notificação
```

## ✅ Pré-requisitos

### 1. App Instalado no Smartphone

```bash
# Se não tiver instalado ainda
adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk

# Verificar instalação
adb shell pm list packages | grep com.results.ragent2
```

### 2. App Conectado com Conta

- Abra o app no smartphone
- Faça login com uma conta válida
- Permita notificações quando solicitado

### 3. Token de Autenticação

Você precisa de um JWT token válido para chamar a API:

```bash
# Opção 1: Via endpoint de login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"seu-email@exemplo.com","password":"senha"}'

# Opção 2: Se tiver variável de ambiente
export AUTH_TOKEN="seu-jwt-token"
```

## 🚀 Testando Push Notifications

### Opção 1: Script Automático (Recomendado)

```bash
# Simples - sem enviar de fato
./scripts/test-push-mobile.sh --user-id user-123

# Com envio real (requer AUTH_TOKEN)
export AUTH_TOKEN="seu-jwt-token"
./scripts/test-push-mobile.sh \
  --user-id user-123 \
  --title "Olá!" \
  --body "Seu ticket foi atualizado"
```

### Opção 2: Manual via cURL

#### 1. Verificar Tokens Registrados

```bash
curl -X GET \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  http://localhost:3000/api/push/tokens | jq '.'
```

Resposta esperada:
```json
{
  "userId": "user-123",
  "tokens": [
    {
      "platform": "android",
      "token": "eVl6...",
      "deviceName": "Pixel 6",
      "registeredAt": "2026-02-24T10:30:00Z"
    }
  ]
}
```

#### 2. Enviar Notificação

```bash
curl -X POST \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "notification": {
      "title": "Novo Ticket",
      "body": "Você tem um novo ticket atribuído"
    },
    "data": {
      "ticketId": "ticket-456",
      "action": "view_ticket"
    }
  }' \
  http://localhost:3000/api/push/send | jq '.'
```

Resposta esperada:
```json
{
  "ok": true,
  "sent": 1,
  "failed": 0,
  "invalidRemoved": 0
}
```

## 🔍 Monitorando Notificações

### Ver Logs em Tempo Real

```bash
# Todos os logs do app
adb logcat | grep com.results.ragent2

# Apenas logs de push
adb logcat | grep -i "push\|notif\|expo-notif"

# Com timestamps
adb logcat -v time | grep -i push
```

### Capturar Logs para Análise

```bash
# Iniciar captura
adb logcat > /tmp/push-test.log &
LOG_PID=$!

# Disparar push (em outro terminal)
./scripts/test-push-mobile.sh --user-id user-123

# Aguardar um pouco
sleep 5

# Parar captura
kill $LOG_PID

# Analisar
cat /tmp/push-test.log | grep -i push
```

## 🛠️ Troubleshooting

### ❌ "App não está rodando"

```bash
# Iniciar app
adb shell am start -n com.results.ragent2/.MainActivity

# Aguardar carregar
sleep 5

# Tentar novamente
./scripts/test-push-mobile.sh --user-id user-123
```

### ❌ "Firebase não inicializado"

Este erro significa que `google-services.json` não foi encontrado. Solução:

```bash
# 1. Verificar se arquivo existe
ls -la apps/mobile/android/app/google-services.json

# 2. Se não existir, fazer rebuild
npx expo run:android

# 3. Ou se tiver credenciais, configurar manualmente
# (Consultar Firebase Console para download do arquivo)
```

### ❌ Permissões de Notificação Negadas

```bash
# Verificar permissão
adb shell pm dump com.results.ragent2 | grep notification

# Resetar e pedir novamente in-app
# (Ir em Configurações > App > Results > Permissões > Notificações)
```

### ❌ Token Não Registrado

Verificar se o app realmente fez o registro:

```bash
# Ver logs de registro
adb logcat | grep -i "register.*push"

# Forçar re-registro (reiniciar app)
adb shell am force-stop com.results.ragent2
adb shell am start -n com.results.ragent2/.MainActivity
sleep 3

# Ver novo token
adb logcat | grep -i "device_token"
```

### ❌ Notificação Não Aparece

1. **Verificar se app está em background ou foreground**
   - Em foreground: verificar `shouldShowBanner: true` em `apps/mobile/src/push.ts`
   - Em background: notificação deve aparecer na bandeja

2. **Verificar payload**
   ```bash
   # A notificação precisa ter título e corpo
   {
     "notification": {
       "title": "obrigatório",
       "body": "obrigatório"
     }
   }
   ```

3. **Verificar se token ainda é válido**
   - Tokens podem expirar
   - App deve renovar tokens periodicamente
   - FCM remove tokens inválidos automaticamente

## 📊 Estrutura de Dados

### Modelo de Push Token (DB)

```sql
id                 UUID PRIMARY KEY
tenant_id          UUID NOT NULL
user_id            UUID NOT NULL
platform           VARCHAR (android|ios)
token              TEXT NOT NULL (unique)
device_name        VARCHAR
device_id          VARCHAR
app_version        VARCHAR
registered_at      TIMESTAMP
last_used_at       TIMESTAMP
is_valid           BOOLEAN DEFAULT true
```

### Payload de Envio

```javascript
{
  // Destinatário
  userId: "user-uuid",  // ou
  tokens: ["token1", "token2"],

  // Conteúdo
  notification: {
    title: "Título (texto curto)",
    body: "Corpo da mensagem (até ~240 caracteres)"
  },

  // Dados adicionais (visão aos deep links/ações)
  data: {
    action: "view_ticket",
    ticketId: "ticket-123",
    customField: "custom-value"
  }
}
```

## 🔐 Segurança

- ✅ Autenticação obrigatória (JWT token necessário)
- ✅ Permissões validadas (usuário só pode enviar para si mesmo)
- ✅ Rate limiting aplicado se configurado
- ✅ Tokens revogados após múltiplas falhas
- ⚠️ Dados sensíveis não devem ir em `data` (apenas em `notification`)

## 📚 Referências

- [Expo Notifications Docs](https://docs.expo.io/guides/push-notifications/)
- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Apple Push Notifications](https://developer.apple.com/documentation/usernotifications)

## 💡 Dicas Práticas

1. **Testar com Expo Go primeiro** (sem rebuild):
   ```bash
   npx expo start --dev-client
   ```

2. **Simular notificações locais** (para debug):
   ```bash
   # Em apps/mobile/src/push.ts
   // Desabilitar envio real, apenas log
   ```

3. **Usar Firebase Console** para enviar testes:
   - https://console.firebase.google.com
   - Ir em "Cloud Messaging" → "Send Message"

4. **Monitorar fila de push** em produção:
   ```bash
   npm run system:validate  # Incluirá health de push
   ```

5. **Rodar testes unitários**:
   ```bash
   npm run test -- apps/mobile/tests/push.test.ts
   ```

---

**Precisa de ajuda?** Verifique os logs com `adb logcat | grep -i push` e compartilhe o erro completo. 🎯
