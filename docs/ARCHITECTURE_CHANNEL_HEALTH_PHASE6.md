## Fase 6 — Observabilidade: Saúde de Canais (Channel Health)

Objetivo: oferecer uma visão operacional e alertas para:
- status de contas de canal (WhatsApp/Instagram/Webchat)
- métricas de envio outbound (falhas por janela)
- backlog da fila de outbound (`outbound_queue`)

### Fonte de dados

- `channel_accounts`
  - contagem de contas por tipo e quantas estão `active`
- `channel_messages` + `channel_conversations`
  - contagem de mensagens outbound na janela (`direction='out'`)
  - falhas outbound na janela (`status='failed'`)
- `outbound_queue`
  - pendentes (status `pending|failed`)
  - vencidos (`next_attempt_at <= now`)
  - item mais antigo (idade)

### Endpoint

`GET /system/channel-health`
- Autenticação obrigatória
- Permissão: `config:read`
- Query params:
  - `windowMinutes` (default 10)

Resposta inclui:
- `overall.status` (`healthy|degraded|unhealthy|unknown`)
- `channels.<channelType>` com:
  - `accounts` (total/active)
  - `delivery` (outTotal/outFailed/failRate na janela)
  - `outboundQueue` (pending/dueNow/oldestPendingSeconds)
  - `status/reason`
- `alerts` (ex.: `high_failure_rate`)

### Alertas (monitor)

Service `api/services/channelHealthService.js`:
- `startChannelHealthMonitor()` roda periodicamente (default 60s)
- Se detectar taxa de falha \(>= limiar\) com amostra mínima, emite:
  - log `warn`
  - evento WebSocket `channel.health.alert` para o tenant
- Possui **cooldown** por tenant+canal+tipo de alerta para evitar spam.

Env vars (todas opcionais):
- `ENABLE_CHANNEL_HEALTH_MONITOR` (default true)
- `CHANNEL_HEALTH_MONITOR_INTERVAL_MS` (default 60000)
- `CHANNEL_HEALTH_WINDOW_MINUTES` (default 10)
- `CHANNEL_HEALTH_FAIL_RATE_THRESHOLD` (default 0.15)
- `CHANNEL_HEALTH_MIN_SAMPLES` (default 20)
- `CHANNEL_HEALTH_COOLDOWN_MINUTES` (default 10)

### Frontend

Página `ChannelHealthPage` (`/channel-health`):
- cards por canal com:
  - contas ativas/total
  - falhas/outbound na janela
  - backlog outbound
- lista de alertas da janela
- auto-refresh 30s + botão “Atualizar”.

