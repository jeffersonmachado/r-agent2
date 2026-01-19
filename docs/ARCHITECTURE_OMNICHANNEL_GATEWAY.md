# Arquitetura — Channel Gateway (Omnichannel)

Esta documentação descreve a **Fase 1** do r-agent2 para padronização omnichannel (padrão Blip/Take), mantendo compatibilidade com a arquitetura atual (Node HTTP server sem Express + services em `api/services` + Sequelize/PostgreSQL + multi-tenant).

## Objetivo

Criar um **modelo único** para canais (WhatsApp, Instagram e futuro Webchat), com:

- **Normalização de inbound/outbound**
- **Persistência unificada** de conversas e mensagens
- **Idempotência** para evitar duplicidade por `externalMessageId`
- **Retry com backoff** para envios outbound (fila simples em Postgres)

## Modelos (PostgreSQL / Sequelize)

Migrations (Umzug): `api/db/migrations/2026011900000*-*`

### `channel_accounts`

Conexões de canal por tenant:

- `tenant_key` (tenantId)
- `type` (`whatsapp|instagram|webchat`)
- `status` (`active|paused|disabled`)
- `external_id` (roteamento de webhook: ex. `phone_number_id` no WhatsApp)
- `config_encrypted` (JSON criptografado com AES-256-GCM; util `api/utils/crypto.js`)

### `channel_conversations`

Conversa unificada por canal:

- `tenant_key`
- `channel_type`
- `external_id` (ex.: telefone WhatsApp, userId IG)
- `status` (`open|paused|human|bot|closed`)
- `current_ticket_id` (integração com tickets existentes)
- `last_message_at`

Índice único: `(tenant_key, channel_type, external_id)`

### `channel_messages`

Mensagens normalizadas:

- `tenant_key`
- `conversation_id`
- `direction` (`in|out`)
- `type` (`text|image|audio|document|template|interactive`)
- `body` (JSONB)
- `external_message_id` (idempotência)
- `status` (`received|sent|delivered|read|failed`)

Índice único (idempotência): `(tenant_key, external_message_id)`

### `outbound_queue`

Fila de envios outbound com retry/backoff:

- `tenant_key`
- `channel_type`
- `message` (JSONB normalizado)
- `status` (`pending|sending|sent|failed`)
- `attempts`, `next_attempt_at`, `last_error`

## Services

### `api/services/channelGatewayService.js`

Funções:

- `normalizeIncoming(channelType, payload)`
- `ingestIncoming(channelType, payload, { tenantId? })`  
  - resolve tenant para webhooks via `channel_accounts.external_id` (fallback: `tenant-demo`)
  - persiste `channel_conversations` e `channel_messages`
- `updateStatus(channelType, statusPayload)` (WhatsApp: `value.statuses[]`)
- `sendMessage(channelType, account, messageNormalized)` (enfileira em `outbound_queue`)

### `api/services/outboundQueueService.js`

- `enqueueOutbound(...)`
- `processDue()` + `startWorker()` com backoff e jitter
- Ao enviar com sucesso, persiste mensagem outbound em `channel_messages` (best-effort).

## Rotas (compatibilidade + novas capacidades)

### Webhooks (mantidos)

- `POST /webhooks/whatsapp`  
  - **agora**: persiste via Channel Gateway (best-effort) e mantém processamento atual do bot.
  - **agora**: processa delivery/read status quando `value.statuses[]` existe.
- `POST /webhooks/instagram`  
  - **agora**: persiste via Channel Gateway (best-effort) e mantém processamento atual do bot.

### Conversas (novo modo, sem quebrar legado)

Já existia um endpoint legado de conversas baseado em `sessionEvents` (memória/replay). Para não quebrar:

- `GET /conversations` (LEGADO, default): continua retornando conversas de replay (requer permissão `audit:read`).

Novo modo (Channel Gateway):

- `GET /conversations?source=channels&status=&channel=&queue=&limit=&offset=`  
  - retorna conversas persistidas em `channel_conversations` (multi-tenant via `req.tenantId`)
  - requer permissão `tickets:read`

Mensagens persistidas:

- `GET /conversations/:id/messages?limit=&offset=`  
  - retorna mensagens de `channel_messages` (multi-tenant via `req.tenantId`)
  - requer permissão `tickets:read`

## Multi-tenant (como o tenant é resolvido)

- Rotas autenticadas: `req.tenantId` via `api/middleware/auth.js`.
- Webhooks (sem token): resolução por `channel_accounts.external_id`:
  - WhatsApp: `value.metadata.phone_number_id`
  - Instagram: `entry.id` (page id)
  - fallback: `tenant-demo` (compatibilidade)

## Idempotência

Mensagens são deduplicadas por `(tenant_key, external_message_id)` para evitar duplicatas caso:

- o webhook seja reenviado
- o processamento seja repetido
- haja retry/duplicidade no provedor

## Retry / Backoff (Outbound)

O worker do outbound usa:

- backoff exponencial com jitter
- cap de ~5 minutos
- status `pending|sending|sent|failed`

Habilitação:

- por padrão ligado
- desabilitar via `ENABLE_OUTBOUND_WORKER=false`

