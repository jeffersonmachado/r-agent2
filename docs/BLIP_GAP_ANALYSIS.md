# BLIP Gap Analysis — r-agent2 (Node.js + PostgreSQL + React)

Data: 2026-01-19  
Escopo: **FASE 1 — Auditoria / Mapa do Sistema** (antes de codar)

## Objetivo

Transformar o `r-agent2` em um produto **BLIP-like completo**, **sem reescrever a arquitetura** e aproveitando o que já existe: tickets/filas, editor de fluxos, replay, WhatsApp Cloud, RBAC, analytics, etc.

Este documento consolida:
- **O que já existe** (backend/frontend/modelos/serviços)
- **O que falta** para atingir o “nível Blip”
- **Plano de implementação** faseado (compatível com o estado real do repo)
- **Riscos e mitigação**

> Observação importante: neste workspace já existem várias entregas equivalentes às “Fases 3/4/5/7” descritas no pedido (handover, SLA, outbound queue e endpoint de channel-health). O gap aqui é **endurecer, unificar 1:1 conversa↔ticket e garantir idempotência/isolamento multi-tenant**.

---

## O que já existe

### Backend (API)

- **Servidor HTTP minimalista** em `api/server.js` (sem Express/Fastify).
- **Auth + RBAC**: `api/services/authService.js`, `api/services/rbacService.js`, middleware `api/middleware/auth`.
- **Multi-tenant (parcialmente hardenizado)**:
  - No banco, a maioria dos modelos usa `tenant_key`.
  - Em rotas autenticadas, `req.tenantId` é aplicado em várias operações.
  - Rate limit por tenant em `api/middleware/tenantRateLimit`.
  - Observação: alguns fluxos de webhook têm **fallback `tenant-demo`** quando não há mapeamento de conta de canal (ver “o que falta”).

### Omnichannel / Channel Gateway (já existe)

Existe um “gateway” omnichannel que normaliza e persiste mensagens, com idempotência:

- **Persistência**:
  - `channel_accounts` (`ChannelAccount`)
  - `channel_conversations` (`ChannelConversation`)
  - `channel_messages` (`ChannelMessage`)
- **Serviço principal**: `api/services/channelGatewayService.js`
  - Normaliza inbound (WhatsApp/Instagram).
  - **Idempotência por `external_message_id`**: índice unique `channel_messages_tenant_external_msg_id_uq`.
  - Resolve `tenantId` de webhook via `channel_accounts.external_id` (fallback para `tenant-demo`).
  - Suporta `updateStatus('whatsapp')` (sent/delivered/read/failed) atualizando `channel_messages.status`.

### Tickets / Filas / Atendimento humano (já existe)

Há um sistema de tickets com UI e endpoints, persistido em Postgres (com cache em memória no runtime):

- **Service**: `api/services/queueService.js`
  - Tickets em memória (`Map`) com **persistência best-effort** em `tickets` (Sequelize).
  - CRUD operacional: criar, listar, atribuir, fechar, mensagens, marcar como lidas.
  - Campos já presentes no ticket (modelo e payload): `conversationId`, `channelType`, `mode`, `pauseReason`, `firstResponseAt`, `resolvedAt`, `waitingTimeSeconds`, `handlingTimeSeconds`, `tags`, `category`, `context`.

### Handover bot ↔ humano (já existe)

- **Service**: `api/services/handoverService.js`
  - `takeOver` / `returnToBot` idempotentes.
  - Atualiza `ticket.mode` via `queueService.setTicketMode`.
  - Best-effort sincroniza `channel_conversations` (status `bot`/`human` + `current_ticket_id`).
  - Emite eventos WebSocket `ticket.updated` para a UI.

No processamento do WhatsApp (engine), já existe a regra:
- Se existe ticket ativo da sessão e `ticket.mode === 'human'`, **o bot não responde automaticamente**; apenas registra mensagem e emite evento para a UI.
  - Implementado em `api/services/messageProcessor.js`.

### Outbound queue + retry/backoff (já existe)

- **Service**: `api/services/outboundQueueService.js`
  - Tabela `outbound_queue` com estados `pending/sending/sent/failed`.
  - Retry com backoff exponencial + jitter.
  - Worker `startWorker()` (iniciado no boot do `server.js` por padrão).
  - Ao enviar, persiste outbound como `channel_messages` (direção `out`) com `external_message_id`.

> Gap atual: nem todo envio outbound do sistema usa essa fila (ver “o que falta”).

### SLA e métricas operacionais (parcialmente implementado)

Já existem:
- **Campos de SLA em ticket** (`first_response_at`, `resolved_at`, `waiting_time_seconds`, `handling_time_seconds`) no modelo `Ticket`.
- Regras best-effort em `queueService`:
  - primeira msg do agente preenche `firstResponseAt` e `waitingTimeSeconds`
  - fechamento calcula `resolvedAt`, `waitingTimeSeconds`, `handlingTimeSeconds`
- **Analytics** em `api/services/analyticsService.js`:
  - gerais / agentes / departamentos / filas / tendências
  - inclui SLA (TME/TMA em segundos) e uma **contenção bot** best-effort baseada em `channel_conversations.current_ticket_id`.

### Observabilidade (Channel Health) — endpoint já existe

Rota `GET /system/channel-health` existe em `api/server.js` e chama `api/services/channelHealthService` (best-effort).  
> Gap atual: falta (ou não foi confirmado nesta auditoria) a UI dedicada e padronização do payload “enterprise-like”.

### Frontend (Console do atendente e demais telas)

Confirmado:
- `frontend/src/pages/SupportPage.jsx` já tem:
  - listagem/seleção de tickets, histórico de mensagens, envio de mensagem do agente
  - **botão de handover** “Assumir atendimento” / “Devolver ao bot”
  - exibição do modo (BOT/HUMANO), `pauseReason`
  - tags (adicionar/remover) e modal de encerramento com motivo
  - painel “Resumo IA” (cache + gerar)
  - eventos via WebSocket (`ticket.created`, `ticket.assigned`, `ticket.updated`, `ticket.closed`, `ticket.message.*`)

---

## Inventário de rotas atuais (`api/server.js`)

A API é roteada por `if (method === 'X' && pathname ...)` e documentada no próprio arquivo com comentários `// METHOD /path - descrição`.

> A lista abaixo foi extraída diretamente desses comentários (rota → descrição).  
> Observação: há rotas com parâmetros e regex (ex.: `:id`, `:tenantKey`), preservadas conforme o comentário do código.

### System / Health / Admin

- GET `/health` — Healthcheck básico
- GET `/health/live` — Liveness probe
- GET `/health/db` — Healthcheck do banco (detalhado)
- GET `/health/ready` — Readiness probe (DB ok + sem migrations pendentes)
- GET `/version` — Versão/ambiente
- GET `/system/status` — Dashboard de status de serviços
- GET `/system/websocket` — Informações de conexões WebSocket
- GET `/system/channel-health` — Saúde de canais (por tenant)
- POST `/admin/rate-limit/clear-cache` — Limpa cache de rate limiters em memória
- POST `/admin/rate-limit/clear` — Limpa chaves de rate limiting no Redis (dev)
- POST `/system/suggest-description` — Sugere descrição via IA
- POST `/system/check-rate-limit` — Verifica rate limit sem consumir
- POST `/system/generate-and-validate` — Geração e validação (fluxos)

### Auth / Agents / Convites / Reset

- POST `/auth/login` — Login de agente
- POST `/auth/rpa/login` — Login RPA por token
- GET `/auth/rpa/token` — Obtém/gera token RPA
- POST `/auth/logout` — Logout
- POST `/auth/logout-all` — Logout de todas as sessões
- GET `/auth/me` — Dados do agente autenticado
- GET `/auth/agents` — Lista agentes
- POST `/auth/agents` — Cria agente
- GET `/auth/agents/:id` — Obtém agente
- PUT `/auth/agents/:id` — Atualiza agente
- DELETE `/auth/agents/:id` — Remove agente
- POST `/auth/invite` — Convida usuário
- POST `/auth/accept-invitation` — Aceita convite
- POST `/auth/request-password-reset` — Solicita reset
- POST `/auth/reset-password` — Reseta senha

### Tenants / Super Admin / Onboarding

- POST `/tenants` — Cria tenant
- POST `/tenants/generate-by-ai` — Gera tenant por IA
- GET `/tenants` — Lista tenants
- GET `/tenants/:id/context` — Obtém contexto do tenant
- PUT `/tenants/:id/context` — Atualiza contexto do tenant
- GET `/tenants/:id/usage` — Uso do tenant
- GET `/tenants/:id/ai-provider-status` — Status de provider IA
- GET `/tenants/:id/ai-config` — Configuração IA do tenant
- GET `/tenants/:id` — Obtém tenant
- PUT `/tenants/:id` — Atualiza tenant
- DELETE `/tenants/:id` — Remove tenant
- POST `/tenants/:id/suspend` — Suspende tenant
- POST `/tenants/:id/reactivate` — Reativa tenant
- POST `/tenants/:id/change-plan` — Muda plano do tenant
- GET `/tenants/current/ai-config` — Config IA do tenant atual (sem segredos)
- PUT `/tenants/current/ai-config` — Salva config IA do tenant atual
- PUT `/tenants/current/ai-credentials` — Salva credenciais IA do tenant atual
- GET `/tenants/current/plan-usage` — Plano + limites + uso (tenant atual)
- GET `/tenants/:tenantKey/ai-config` — Config IA por tenantKey
- PUT `/tenants/:tenantKey/ai-config` — Salva config IA por tenantKey
- PUT `/tenants/:tenantKey/ai-credentials` — Salva credenciais IA por tenantKey

- GET `/super-admin/tenants` — Lista tenants (super-admin)
- GET `/super-admin/tenants/:id/metrics` — Métricas do tenant
- POST `/super-admin/impersonate` — Impersona usuário
- POST `/super-admin/tenants/:id/block` — Bloqueia tenant
- POST `/super-admin/tenants/:id/unblock` — Desbloqueia tenant
- POST `/super-admin/tenants/:id/adjust-plan` — Ajusta plano

- GET `/onboarding/status` — Status onboarding
- POST `/onboarding/start` — Inicia onboarding
- POST `/onboarding/complete-step` — Completa step
- POST `/onboarding/complete` — Finaliza onboarding
- POST `/onboarding/create-templates` — Cria templates iniciais

### Audit

- GET `/audit/logs` — Consulta logs
- GET `/audit/stats` — Estatísticas de auditoria

### Flows / Templates / Marketplace

- GET `/flows` — Lista flows
- GET `/flows/:id` — Obtém flow
- POST `/flows` — Cria flow
- PUT `/flows/:id` — Atualiza flow
- DELETE `/flows/:id` — Remove flow
- POST `/flows/validate` — Valida flow
- POST `/flows/simulate` — Simula flow
- POST `/flows/generate` — Gera flow por IA
- POST `/flows/generate/dry-run` — Geração dry-run
- POST `/flows/:flowId/generate-rpa-test` — Gera teste RPA
- POST `/flows/:id/resolve-dependencies` — Resolve deps (RPA)
- POST `/flows/:id/preview-rpa` — Preview pipeline RPA
- POST `/flows/:id/generate-rpa` — Gera pipeline RPA

- GET `/flow-templates` — Lista templates (globais + do tenant)
- GET `/flow-templates/:id` — Obtém template completo
- POST `/flow-templates` — Cria template do tenant
- POST `/flow-templates/:id/install` — Instala template (cria flow)
- DELETE `/flow-templates/:id` — Remove template do tenant

- GET `/templates` — Lista templates
- GET `/templates/:id` — Obtém template
- POST `/templates` — Salva template
- DELETE `/templates/:id` — Remove template

### Replay / Conversations

- GET `/replay/:sessionId` — Replay de sessão
- GET `/conversations` — Lista conversas (legado) / ou `?source=channels` (Channel Gateway)
- GET `/conversations/:id/messages` — Lista mensagens persistidas do Channel Gateway
- GET `/conversations/:sessionId` — Detalhe de conversa (legado via replay)

### Tickets / Queues / Channel Accounts

- POST `/tickets` — Cria ticket manualmente
- GET `/tickets` — Lista tickets (filtros/paginação)
- GET `/tickets/session/:sessionId` — Ticket ativo por sessão
- GET `/tickets/:id/messages` — Mensagens do ticket
- GET `/tickets/:id` — Obtém ticket
- POST `/tickets/:id/assign` — Atribui ticket
- POST `/tickets/:id/takeover` — Handover bot→humano
- POST `/tickets/:id/return-to-bot` — Handover humano→bot
- POST `/tickets/:id/close` — Fecha ticket
- POST `/tickets/:id/mark-read` — Marca como lido
- POST `/tickets/:id/message` — Envia mensagem do agente
- GET `/tickets/:id/ai-summary` — Resumo IA (cache)
- POST `/tickets/:id/ai-summary` — Gera/atualiza resumo IA

- GET `/queues` — Lista filas
- POST `/queues` — Cria fila
- GET `/queues/:name` — Info da fila
- DELETE `/queues/:name` — Exclui fila
- GET `/queues/:queue/tickets` — Lista tickets da fila
- POST `/queues/reload` — Recarrega tickets/filas (compat)
- GET `/metrics/queues` — Métricas do sistema de filas

- GET `/channel-accounts` — Lista contas de canal
- POST `/channel-accounts` — Cria conta de canal
- POST `/channel-accounts/:id/test` — Testa credenciais
- PUT `/channel-accounts/:id` — Atualiza conta
- DELETE `/channel-accounts/:id` — Remove conta

### Quick Replies / Departments / Bulk Campaigns

- GET `/quick-replies` — Lista respostas rápidas
- GET `/quick-replies/categories` — Lista categorias
- GET `/quick-replies/tags` — Lista tags
- POST `/quick-replies/search` — Busca por contexto
- GET `/quick-replies/:id` — Obtém resposta rápida
- POST `/quick-replies` — Cria resposta rápida
- PUT `/quick-replies/:id` — Atualiza resposta rápida
- DELETE `/quick-replies/:id` — Remove resposta rápida
- POST `/quick-replies/:id/use` — Incrementa uso

- GET `/departments` — Lista departamentos
- GET `/departments/:id` — Obtém departamento
- POST `/departments` — Cria departamento
- PUT `/departments/:id` — Atualiza departamento
- DELETE `/departments/:id` — Remove departamento
- POST `/departments/:id/agents` — Adiciona agente
- DELETE `/departments/:id/agents/:agentId` — Remove agente

- GET `/bulk-campaigns` — Lista campanhas
- GET `/bulk-campaigns/:id` — Obtém campanha
- POST `/bulk-campaigns` — Cria campanha
- PUT `/bulk-campaigns/:id` — Atualiza campanha
- DELETE `/bulk-campaigns/:id` — Remove campanha
- POST `/bulk-campaigns/:id/start` — Inicia campanha
- POST `/bulk-campaigns/:id/pause` — Pausa campanha
- POST `/bulk-campaigns/:id/resume` — Retoma campanha

### Analytics / Export

- GET `/analytics/metrics` — Todas as métricas
- GET `/analytics/general` — Métricas gerais
- GET `/analytics/agents` — Métricas por agente
- GET `/analytics/departments` — Métricas por departamento
- GET `/analytics/queues` — Métricas por fila
- GET `/analytics/trends` — Tendências

- GET `/export/tickets.csv` — Export tickets CSV
- GET `/export/metrics.csv` — Export métricas CSV
- GET `/export/conversations.json` — Export conversas JSON
- GET `/export/full-report.json` — Export relatório completo JSON

### IA / Áudio

- POST `/ai/chatbot/generate` — Gera fluxo chatbot
- POST `/ai/rpa/generate` — Gera teste/pipeline RPA
- POST `/api/ai/generate` — Gera resposta IA
- POST `/ai/suggest-response` — Sugere resposta
- POST `/ai/rewrite-message` — Reescreve mensagem
- POST `/ai/rewrite-multiple` — Reescreve múltiplas mensagens
- POST `/audio/transcribe` — Transcrição

### Segmentation

- GET `/segmentation/tags` — Lista tags
- GET `/segmentation/categories` — Lista categorias
- GET `/segmentation/tickets` — Filtra tickets
- GET `/segmentation/stats` — Estatísticas
- POST `/tickets/:id/tags` — Adiciona tag
- DELETE `/tickets/:id/tags/:tag` — Remove tag
- PUT `/tickets/:id/category` — Define categoria

### WhatsApp / Instagram / Messenger (Webhooks e envio)

- GET `/webhooks/whatsapp` — Verificação do webhook
- POST `/webhooks/whatsapp` — Mensagens recebidas

- GET `/webhooks/messenger` — Verificação
- POST `/webhooks/messenger` — Mensagens recebidas
- POST `/messenger/send` — Envia mensagem

- GET `/webhooks/instagram` — Verificação
- POST `/webhooks/instagram` — Mensagens recebidas
- POST `/instagram/send` — Envia mensagem

- GET `/whatsapp/templates` — Lista templates aprovados
- GET `/whatsapp/templates/:id` — Obtém template
- POST `/whatsapp/templates` — Cria template
- POST `/whatsapp/send-template` — Envia template

### RAG / Web scraping / Webhooks (callbacks)

- GET `/rag/documents` — Lista documentos
- GET `/rag/deduplication/stats` — Deduplicação
- GET `/rag/documents/stats` — Stats docs
- GET `/rag/documents/:id` — Obtém doc
- POST `/rag/documents` — Cria doc
- PUT `/rag/documents/:id` — Atualiza doc
- DELETE `/rag/documents/:id` — Remove doc
- POST `/rag/documents/:id/reindex` — Reindexa doc
- POST `/rag/documents/reindex-all` — Reindexa tudo
- POST `/rag/query` — Query RAG
- GET `/rag/learning/metrics/:tenantId` — Métricas aprendizado
- POST `/rag/learning/update-synonyms` — Atualiza sinônimos
- POST `/rag/learning/trigger-learning/:tenantId` — Dispara aprendizado
- GET `/rag/learning/full-data/:tenantId` — Dados completos
- PUT `/rag/learning/synonyms` — Atualiza sinônimo
- DELETE `/rag/learning/synonyms/:tenantId/:term` — Remove sinônimo
- GET `/rag/learning/validation-rules` — Regras validação
- POST `/rag/learning/validation-rules/adapt/:tenantId` — Adapta regras
- POST `/rag/learning/clean-invalid-queries/:tenantId` — Limpa inválidas
- GET `/rag/domains` — Config domínios RAG

- POST `/web-scraping/scrape` — Raspa URL
- POST `/web-scraping/scrape-batch` — Raspa batch

- GET `/webhooks/events` — Eventos disponíveis
- GET `/webhooks` — Lista webhooks do tenant
- GET `/webhooks/:id` — Obtém webhook
- POST `/webhooks` — Cria webhook
- PUT `/webhooks/:id` — Atualiza webhook
- DELETE `/webhooks/:id` — Remove webhook

### RPA / QA

- GET `/rpa/recordings` — Lista gravações
- DELETE `/rpa/recordings/:id` — Remove gravação
- POST `/rpa/execute/:recordingId` — Executa gravação
- GET `/rpa/execution/:executionId` — Status execução
- POST `/rpa/execution/:executionId/cancel` — Cancela
- POST `/rpa/execution/:executionId/continue` — Continua
- POST `/rpa/execution/:executionId/next` — Próximo step
- GET `/rpa/execution/:executionId/report` — Relatório
- POST `/rpa/record/start` — Inicia gravação manual
- POST `/rpa/record/stop/:recordingId` — Para gravação manual
- GET `/rpa/record/status/:recordingId` — Status gravação manual

- GET `/qa/latest` — Último QA
- GET `/qa/history` — Histórico QA
- GET `/qa/stats` — Estatísticas QA
- GET `/qa/:id` — QA por ID

---

## Models Sequelize existentes (`api/db/models`) e tabelas

### Mapeamento Model → Tabela

| Model (arquivo) | Tabela | Multi-tenant |
|---|---:|---|
| `Tenant.js` | `tenants` | N/A (raiz) |
| `User.js` | `users` | N/A (raiz) |
| `TenantUser.js` | `tenant_users` | `tenant_id` (join) |
| `TenantSetting.js` | `tenant_settings` | `tenant_key` |
| `TenantAISetting.js` | `tenant_ai_settings` | `tenant_key` |
| `TenantAICredential.js` | `tenant_ai_credentials` | `tenant_key` |
| `TenantContext.js` | `tenant_contexts` | `tenant_key` |
| `Session.js` | `sessions` | `tenant_key` |
| `Flow.js` | `flows` | `tenant_key` |
| `FlowTemplate.js` | `flow_templates` | `tenant_key` |
| `Department.js` | `departments` | `tenant_key` |
| `Queue.js` | `queues` | `tenant_key` |
| `QuickReply.js` | `quick_replies` | `tenant_key` |
| `Ticket.js` | `tickets` | `tenant_key` |
| `CloseReason.js` | `close_reasons` | `tenant_key` |
| `TicketTag.js` | `ticket_tags` | `tenant_key` |
| `AuditLog.js` | `audit_logs` | `tenant_key` (nullable) |
| `AuditEvent.js` | `audit_events` | (via actor, sem FK explícita) |
| `AuditReport.js` | `audit_reports` | (payload JSONB) |
| `Execution.js` | `executions` | (payload JSONB) |
| `GenerationAudit.js` | `generation_audits` | (payload JSONB) |
| `Webhook.js` | `webhooks` | `tenant_key` |
| `RagDocument.js` | `rag_documents` | `tenant_key` |
| `ChannelAccount.js` | `channel_accounts` | `tenant_key` |
| `ChannelConversation.js` | `channel_conversations` | `tenant_key` |
| `ChannelMessage.js` | `channel_messages` | `tenant_key` |
| `OutboundQueueItem.js` | `outbound_queue` | `tenant_key` |

### Observações de modelagem relevantes para o “Blip-like”

- `Ticket` já possui:
  - `conversation_id` (link com `channel_conversations`)
  - `channel_type`
  - `mode` (`bot|human`, mas hoje default no model é `human`)
  - campos de SLA e segmentação
  - histórico de mensagens em JSONB (`tickets.messages`) — **não é idempotente por `external_message_id`**
- `ChannelConversation` tem `current_ticket_id` e unique `(tenant_key, channel_type, external_id)`.
- `ChannelMessage` tem unique `(tenant_key, external_message_id)` — base sólida para idempotência.

---

## Fluxos mapeados

### 1) Webhook WhatsApp → persistência → ticket → resposta (bot/humano)

**Entrada**: `POST /webhooks/whatsapp` (`api/server.js`)

1. Recebe payload Meta (`object=whatsapp_business_account`).
2. Para cada `change.field === 'messages'`:
   - Se vierem `value.statuses`: chama `channelGatewayService.updateStatus('whatsapp', { value })` (best-effort) para atualizar `channel_messages.status`.
   - Para cada `value.messages[]`:
     - chama `channelGatewayService.ingestIncoming('whatsapp', { message: msg, value, raw })` para:
       - resolver `tenantId` (via `channel_accounts.external_id` ou fallback `tenant-demo`)
       - criar/atualizar `channel_conversations`
       - inserir `channel_messages` (idempotente por `external_message_id`)
     - chama `processWhatsAppMessage(msg, value, deps)` (`api/services/messageProcessor.js`) para engine e handoff.

**Regra de handover já aplicada** (no `messageProcessor`):
- Se existir ticket ativo da sessão `whatsapp_<from>` e `ticket.mode === 'human'`:
  - **não executa a engine**
  - adiciona mensagem ao histórico do ticket (`queueService.updateLastMessage`)
  - emite evento WebSocket `ticket.message.received`
- Caso contrário:
  - executa 1 passo da engine
  - se output for `handoff`/fallback-to-ticket:
    - cria ticket via `queueService.createTicket(...)`
    - envia mensagem ao usuário via `whatsappService.sendTextMessage(...)`
  - senão, envia mensagem do bot via `whatsappService.sendTextMessage(...)`

### 2) Atendimento humano (SupportPage) → envio de mensagem → persistência

**Frontend**: `frontend/src/pages/SupportPage.jsx`

- Lista tickets: `GET /tickets?status=...`
- Seleciona ticket e carrega histórico: `GET /tickets/:id/messages`
- Envia mensagem do atendente: `POST /tickets/:id/message`
- Handover:
  - `POST /tickets/:id/takeover`
  - `POST /tickets/:id/return-to-bot`
- Close:
  - `POST /tickets/:id/close` (com `closeReasonId`/`closeReasonName` opcional)
- Tags:
  - `POST /tickets/:id/tags`
  - `DELETE /tickets/:id/tags/:tag`
- IA:
  - `GET /tickets/:id/ai-summary`
  - `POST /tickets/:id/ai-summary`

**Backend no envio do agente** (`POST /tickets/:id/message`):
1. valida tenant e RBAC
2. adiciona mensagem no histórico do ticket (`queueService.addAgentMessage`) e atualiza SLA (`firstResponseAt`/`waitingTimeSeconds`)
3. tenta enviar via `whatsappService.sendTextMessage(phoneNumber, message)` (com warnings se credenciais inválidas)
4. emite evento WebSocket `ticket.message.sent`

---

## O que falta (gaps para ficar “BLIP-like” completo)

### 1) Unificação conversa↔ticket (1:1 consistente)

Hoje existem **dois mundos**:
- `channel_conversations/channel_messages` (omnichannel persistido e idempotente)
- `tickets` + `tickets.messages` (atendimento humano, com histórico JSONB)

Gaps:
- Não existe uma camada “linker” 1:1 robusta do tipo “**toda conversa de canal vira ticket**”:
  - ticket é criado por handoff (ou manual), não necessariamente no primeiro inbound.
  - `channelGatewayService` faz “derivação” de ticket atual por `sessionId` (`getTicketBySession`) — heurística, não uma regra de negócio consistente.
- O `Ticket` usa `session_id` (formato `whatsapp_<phone>`) como chave principal para “conversa”, o que não generaliza bem para IG/Messenger.

### 2) Idempotência de mensagens no ticket (crítico)

`channel_messages` é idempotente por `external_message_id`, mas o histórico do ticket (`tickets.messages`) não guarda `externalMessageId`.

Resultado:
- retries de webhook podem duplicar mensagens em tickets (e até afetar contadores/última mensagem).

### 3) Multi-tenant “hard block” em todo o pipeline

Gaps:
- Webhooks podem cair no **fallback `tenant-demo`** se `channel_accounts` não estiver configurado (risco de cross-tenant / dados misturados).
- `queueService.getTicketBySession(sessionId)` varre todos os tickets em memória sem receber `tenantId` (risco operacional em cenários de múltiplos tenants).

### 4) Robustez WhatsApp “no dia a dia” (fila outbound usada em TODO outbound)

Gaps:
- Bot e agente ainda chamam `whatsappService.sendTextMessage` diretamente em alguns fluxos (ex.: `messageProcessor` e endpoint `/tickets/:id/message`).
- Falta consolidar **todo outbound WhatsApp** na fila `outbound_queue` (com retry/backoff e tracking).

### 5) Status de entrega integrado ao ticket

Hoje:
- `updateStatus('whatsapp')` atualiza `channel_messages.status`.

Gap:
- UI do atendente/ticket não mostra status por mensagem (sent/delivered/read/failed) e o ticket não tem um “ledger” de outbound com idempotência.

### 6) Console do atendente (acabamento enterprise)

Já existe muita coisa (handover, tags, close reason, IA summary), mas ainda falta consolidar:
- “conversa = ticket” como visão principal (não só ticket do handoff)
- painel omnichannel unificado (todas mensagens em ordem, com anexos/botões/payload)
- UX de atalhos e variáveis (já tem base, mas não completude Blip)

### 7) Channel Health UI

Backend já tem `GET /system/channel-health`. Gap: **página dedicada** e padrão de cards/erros recentes na UI.

---

## Plano de implementação (ajustado ao estado real do repo)

> Diretriz: **mudanças incrementais**, compatíveis com endpoints e UI atuais; migrations via Umzug; testes mínimos para handover + idempotência.

### Fase 2 — “Conversa de canal = ticket” (unificação)

- **Objetivo**: criar regra 1:1 consistente: toda conversa omnichannel tem um ticket atual (aberto) associado, com isolamento por tenant.
- **Estratégia de menor risco**:
  - Reusar `channel_conversations` como “chave de conversa” e garantir `Ticket.conversation_id` sempre preenchido.
  - Criar um service “linker” (novo) para:
    - resolver/criar ticket idempotente por `(tenant_key, channel_type, external_id)` ou por `conversation_id`.
    - registrar mensagens inbound/outbound de forma idempotente (preferencialmente alinhando com `external_message_id`).
  - Manter compatibilidade com endpoints atuais de tickets, mas permitir que `/tickets` vire a visão principal de “conversas”.

### Fase 3 — Handover bot↔humano (endurecer)

- Já existe `handoverService` + regra no `messageProcessor`.
- Ajustes para “perfeito”:
  - garantir que o modo default para tickets criados por inbound seja **`bot`**
  - registrar timestamps de handover/retorno e lastHuman/lastBot (campos adicionais se ainda não existirem)
  - assegurar que envio do agente em modo bot não “quebra” o bot (apenas registra)

### Fase 4 — SLA e métricas operacionais (consolidar)

- Já existe base em `Ticket` e `analyticsService`.
- Completar:
  - primeira resposta = primeira mensagem OUT do agente (já existe)
  - resolução = close (já existe)
  - métricas enterprise por fila/agente/departamento usando campos persistidos (evitar recomputar por histórico textual)

### Fase 5 — Robustez WhatsApp (padronizar outbound)

- Migrar envios diretos (`sendTextMessage`) para enfileiramento `outbound_queue`:
  - bot outbound (engine)
  - agente outbound (`/tickets/:id/message`)
  - templates
- Garantir que `external_message_id` do WhatsApp seja persistido e que o status atualize UI/analytics.

### Fase 6 — Console do atendente

- Consolidar visão “ticket = conversa” (omnichannel) e UX:
  - status por mensagem
  - anexos/interactive payload
  - quick replies com variáveis + busca/atalhos (base já existe)
  - painel lateral com dados de contato + histórico de handover + IA (já existe parte)

### Fase 7 — Observabilidade

- Backend já tem `GET /system/channel-health`; completar UI e padronizar retorno.

### Testes mínimos (obrigatórios)

- Unit: `handoverService` (`takeOver`, `returnToBot`)
- Unit: idempotência de ingestão de mensagens por `external_message_id`
- Integration: webhook WhatsApp cria/resolve ticket 1x e persiste mensagens corretamente

---

## Riscos e como mitigamos

- **Cross-tenant via webhook sem account**:
  - risco: fallback `tenant-demo` misturar dados
  - mitigação: exigir `channel_accounts` ativo para produção; logs/alertas; rejeitar webhook sem mapeamento (feature-flag)

- **Duplicação de mensagens em tickets**:
  - risco: retry de webhook gera duplicidade e métricas erradas
  - mitigação: idempotência no nível de ticket usando `external_message_id` (ou reuso direto de `channel_messages` como fonte de verdade para timeline)

- **Compatibilidade com UI atual**:
  - risco: quebrar `SupportPage` e endpoints `/tickets/*`
  - mitigação: mudanças aditivas (novos campos/rotas), mantendo contratos existentes; migrações sem breaking changes

- **Worker outbound e consistência de status**:
  - risco: mensagens “sumirem” se worker falhar
  - mitigação: estados explícitos (`pending/sending/sent/failed`), retries, endpoint de health + dashboards

- **Escala/performance** (DB e listagens):
  - mitigação: índices compostos por `tenant_key`, paginação consistente e limites.

