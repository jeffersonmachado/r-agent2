# BLIP_GAPS_MAP — Mapa do Sistema (FASE 0)

Este documento consolida o **mapa operacional** do `r-agent2` para orientar o fechamento de lacunas rumo ao nível Blip/Take **sem reimplementar o que já existe**.

## Escopo e convenções

- **Backend**: `api/server.js` (HTTP puro) + services em `api/services/*`
- **Persistência**: Sequelize + PostgreSQL (multi-tenant por `tenant_key`)
- **Frontend**: React em `frontend/`
- **Multi-tenant (hardening)**:
  - `requireAuth()` injeta `req.agent` e `req.tenantId` (super-admin precisa selecionar tenant via header `X-Tenant-Id`; caso contrário `req.tenantId=null`).
  - Várias rotas exigem tenant via helper interno `requireTenant(req,res)` (best-effort/hardening).

---

## Modelos críticos (campos/índices confirmados)

### `Ticket` (`api/db/models/Ticket.js`)

- **Handover/SLA**: `mode`, `pause_reason`, `takeover_at`, `return_to_bot_at`, `first_response_at`, `resolved_at`, `waiting_time_seconds`, `handling_time_seconds`
- **Omnichannel link**: `conversation_id`, `channel_type`
- **Multi-tenant**: `tenant_key` obrigatório

### `Queue` (`api/db/models/Queue.js`)

- **Roteamento**: `routing_strategy` (default `manual`)
- **Prioridade**: `priority`
- **Organização**: `department_id`
- **Multi-tenant**: `tenant_key` + UNIQUE `(tenant_key,name)`

### `Department` (`api/db/models/Department.js`)

- **Agentes/Filas**: `agent_ids` (JSONB), `queue_names` (JSONB)
- **Multi-tenant**: `tenant_key`

### `ChannelConversation` (`api/db/models/ChannelConversation.js`)

- **Chave natural omnichannel**: `tenant_key`, `channel_type`, `external_id`
- **Link para ticket ativo**: `current_ticket_id`
- **UNIQUE INDEX**: `(tenant_key, channel_type, external_id)` (`channel_conversations_unique_external`)

### `ChannelMessage` (`api/db/models/ChannelMessage.js`)

- **Persistência normalizada**: `tenant_key`, `conversation_id`, `channel_type`, `direction`, `type`, `body`
- **Idempotência inbound/outbound**: `external_message_id` (índice unique lógico; a indexação parcial é aplicada por migration)
- **Delivery status**: `status` (ex.: `received`, `sent`, `delivered`, `read`, `failed`)

### `OutboundQueueItem` (`api/db/models/OutboundQueueItem.js`)

- **Fila resiliente**: `tenant_key`, `channel_type`, `message`, `status`, `attempts`, `next_attempt_at`, `last_error`
- **Idempotência outbound**: `external_message_id`
- **Cluster-safety**: `processing_at`, `processing_by`

---

## Regras críticas já presentes (relevantes para “Blip-ready”)

- **Gate do engine para handover**: nos webhooks WhatsApp/Instagram, quando `ticket.mode === 'human'` **ou** `ticket.mode === 'paused'`, o servidor **não executa** `processWhatsAppMessage` (engine) e apenas registra/notifica UI (best-effort).
- **Outbound resiliente (DB-first)**: `api/services/outboundQueueService.js` enfileira envios e processa com retry/backoff; também persiste `ChannelMessage` outbound (best-effort) e emite eventos WebSocket.

---

## Rotas do backend (`api/server.js`) e amarração por domínio

> Nota: a lista abaixo é a **lista completa de rotas** identificadas no `api/server.js` (rotas com comentários `// METHOD /path...`) **mais** rotas “sem comentário” detectadas por guardas `pathname === ...` (ex.: health/version).

### Health / versão / status do sistema

- **Rotas**:
  - `GET /health`
  - `GET /health/live`
  - `GET /health/ready`
  - `GET /health/db`
  - `GET /version`
  - `GET /system/status`
  - `GET /system/websocket`
  - `GET /system/channel-health`
  - `POST /system/check-rate-limit`
  - `POST /admin/rate-limit/clear-cache`
  - `POST /admin/rate-limit/clear`
  - `GET /server/process-manager`
  - `POST /server/restart`
- **Service/model principal**: `api/server.js` (infra/health), `infra/rate-limit`, WebSocket (emit/metrics), DB (`api/db/index`)
- **Auth/RBAC**:
  - Health/version tipicamente **públicos** (sem `requireAuth`)
  - Admin rate-limit e restart: **autenticado** + permissões (ver `requirePermission` no bloco)

### Autenticação, sessões e usuários (RBAC)

- **Rotas**:
  - `POST /auth/login`
  - `POST /auth/logout`
  - `POST /auth/logout-all`
  - `GET /auth/me`
  - `POST /auth/rpa/login`
  - `GET /auth/rpa/token`
  - `GET /auth/agents`
  - `POST /auth/agents`
  - `GET /auth/agents/:id`
  - `PUT /auth/agents/:id`
  - `DELETE /auth/agents/:id`
  - `POST /auth/invite`
  - `POST /auth/accept-invitation`
  - `POST /auth/request-password-reset`
  - `POST /auth/reset-password`
- **Service/model principal**:
  - `api/services/authService.js` (login, sessões, CRUD de usuários/agentes)
  - `api/services/rbacService.js` (permissions/roles)
  - `api/middleware/auth.js` (`requireAuth`, `requirePermission`)
  - Model `User` (Sequelize)
- **Auth/RBAC**:
  - Login/reset/invite: parcialmente **públicas** (dependendo do endpoint)
  - CRUD de agentes: **autenticado** + `requirePermission(req,'agents',...)` (varia por ação)

### Tenants e IA do tenant

- **Rotas**:
  - `POST /tenants`
  - `GET /tenants`
  - `GET /tenants/:id`
  - `PUT /tenants/:id`
  - `DELETE /tenants/:id`
  - `GET /tenants/:id/context`
  - `PUT /tenants/:id/context`
  - `GET /tenants/:id/usage`
  - `GET /tenants/:id/ai-provider-status`
  - `GET /tenants/:id/ai-config`
  - `POST /tenants/:id/suspend`
  - `POST /tenants/:id/reactivate`
  - `POST /tenants/:id/change-plan`
  - `POST /tenants/generate-by-ai`
  - `POST /system/suggest-description`
  - `GET /tenants/current/ai-config`
  - `PUT /tenants/current/ai-config`
  - `PUT /tenants/current/ai-credentials`
  - `GET /tenants/current/plan-usage`
  - `GET /tenants/:tenantKey/ai-config`
  - `PUT /tenants/:tenantKey/ai-config`
  - `PUT /tenants/:tenantKey/ai-credentials`
- **Service/model principal**:
  - `api/services/tenantService.js`
  - `api/services/tenantAIService.js`
  - `api/services/aiProviderService.js` (init/validação de provider)
  - Models `Tenant`, `User` (multi-tenant hardening)

### Super Admin

- **Rotas**:
  - `GET /super-admin/tenants`
  - `GET /super-admin/tenants/:id/metrics`
  - `POST /super-admin/impersonate`
  - `POST /super-admin/tenants/:id/block`
  - `POST /super-admin/tenants/:id/unblock`
  - `POST /super-admin/tenants/:id/adjust-plan`
- **Service/model principal**: `api/services/superAdminService.js` (+ modelos `Tenant`/`User`)
- **Auth/RBAC**: requer super-admin; `req.tenantId` pode ser `null` sem header `X-Tenant-Id` (hardening)

### Onboarding

- **Rotas**:
  - `GET /onboarding/status`
  - `POST /onboarding/start`
  - `POST /onboarding/complete-step`
  - `POST /onboarding/complete`
  - `POST /onboarding/create-templates`
- **Service/model principal**: `api/services/onboardingService.js`

### Auditoria

- **Rotas**:
  - `GET /audit/logs`
  - `GET /audit/stats`
- **Service/model principal**: `api/services/auditService.js`
- **Frontend**: `AuditPage.jsx` (via `frontend/src/api/audit.js`)

### Flows, validação, geração, simulação e replay

- **Rotas**:
  - `GET /flows`
  - `GET /flows/:id`
  - `POST /flows`
  - `PUT /flows/:id`
  - `DELETE /flows/:id`
  - `POST /flows/validate`
  - `POST /flows/generate`
  - `POST /flows/generate/dry-run`
  - `POST /flows/simulate`
  - `POST /flows/:id/resolve-dependencies`
  - `POST /flows/:id/preview-rpa`
  - `POST /flows/:id/generate-rpa`
  - `POST /flows/:flowId/generate-rpa-test`
  - `POST /rpa-tests`
  - `GET /replay/:sessionId`
- **Service/model principal**:
  - Engine: `engine/validator`, `engine/flowSimulation`, `engine/replay`
  - Geração: `api/services/flowGeneratorService.js`, `api/services/generationOrchestrator.js`, `api/services/generate-and-validate.js`
  - RPA: `api/services/rpaFlowPipelineService.js`
  - Auditoria de geração: `api/services/auditService.js` (`registerGeneration`)

### Conversas omnichannel (Channel Gateway)

- **Rotas**:
  - `GET /conversations`
  - `GET /conversations/:id/messages`
  - `GET /conversations/:sessionId`
- **Service/model principal**:
  - `api/services/channelConversationService.js`
  - Models: `ChannelConversation`, `ChannelMessage`, `Ticket`
- **Frontend**:
  - `SupportPage.jsx` usa `frontend/src/api/conversations.js` → `GET /conversations/:id/messages`

### Filas e tickets (core atendimento)

- **Rotas (filas)**:
  - `GET /queues`
  - `POST /queues`
  - `GET /queues/:name`
  - `DELETE /queues/:name`
  - `GET /queues/:queue/tickets`
  - `POST /queues/reload`
  - `GET /metrics/queues`
- **Rotas (tickets)**:
  - `POST /tickets`
  - `GET /tickets`
  - `GET /tickets/session/:sessionId`
  - `GET /tickets/:id/messages`
  - `GET /tickets/:id`
  - `POST /tickets/:id/assign`
  - `POST /tickets/:id/takeover`
  - `POST /tickets/:id/return-to-bot`
  - `POST /tickets/:id/pause`
  - `POST /tickets/:id/close`
  - `POST /tickets/:id/mark-read`
  - `POST /tickets/:id/message`
  - `GET /tickets/:id/ai-summary`
  - `POST /tickets/:id/ai-summary`
- **Service/model principal**:
  - `api/services/queueService.js` (tickets/queues runtime + persistência DB)
  - `api/services/queueDefinitionService.js` (metadados de filas/roteamento)
  - `api/services/handoverService.js` (takeover/return/pause e auto-return)
  - `api/services/outboundQueueService.js` (envio resiliente)
  - `api/services/closeReasonsService.js` (close reasons default + upsert)
  - `api/services/ticketInsightService.js` (resumo IA)
  - Models: `Ticket`, `Queue`
- **Observação importante**:
  - “Pausado” existe via `/tickets/:id/pause`; retomar para humano via `POST /tickets/:id/resume`; retorno ao bot via `/tickets/:id/return-to-bot`.

### Close reasons

- **Rotas**:
  - `GET /close-reasons`
- **Service/model principal**: `api/services/closeReasonsService.js`
- **Frontend**: `SupportPage.jsx` usa `frontend/src/api/closeReasons.js`

### Segmentação (tags/categorias)

- **Rotas**:
  - `GET /segmentation/tags`
  - `GET /segmentation/categories`
  - `GET /segmentation/tickets`
  - `GET /segmentation/stats`
  - `POST /tickets/:id/tags`
  - `DELETE /tickets/:id/tags/:tag`
  - `PUT /tickets/:id/category`
- **Service/model principal**: `api/services/segmentationService.js` + `Ticket`
- **Frontend**: `SupportPage.jsx` usa `frontend/src/api/segmentation.js`

### Channel Accounts (cadastro de credenciais por tenant)

- **Rotas**:
  - `GET /channel-accounts`
  - `POST /channel-accounts`
  - `POST /channel-accounts/:id/test`
  - `PUT /channel-accounts/:id`
  - `DELETE /channel-accounts/:id`
- **Service/model principal**:
  - `api/services/channelAccountsService.js`
  - Model `ChannelAccount` (config criptografado)
- **Auth/RBAC**: `requirePermission(req,'config',...)`

### WhatsApp Templates

- **Rotas**:
  - `GET /whatsapp/templates`
  - `GET /whatsapp/templates/:id`
  - `POST /whatsapp/templates`
  - `POST /whatsapp/send-template`
- **Service/model principal**: `api/services/whatsappTemplateService.js` + `outboundQueueService`

### Webhooks (WhatsApp / Messenger / Instagram)

- **Rotas**:
  - `GET /webhooks/whatsapp`
  - `POST /webhooks/whatsapp`
  - `GET /webhooks/messenger`
  - `POST /webhooks/messenger`
  - `POST /messenger/send`
  - `GET /webhooks/instagram`
  - `POST /webhooks/instagram`
  - `POST /instagram/send`
- **Service/model principal**:
  - WhatsApp: `api/services/whatsappService.js` (verify/send), `api/services/messageProcessor.js` (engine ingest), `api/services/channelGatewayService.js` (persistência), `api/services/conversationTicketLinkService.js` (ticket link)
  - Instagram: `api/services/instagramService.js` + pipeline compartilhado com `processWhatsAppMessage`
  - Messenger: `api/services/messengerService.js`
  - Models: `ChannelConversation`, `ChannelMessage`, `Ticket`

### Respostas rápidas (Quick Replies)

- **Rotas**:
  - `GET /quick-replies`
  - `GET /quick-replies/categories`
  - `GET /quick-replies/tags`
  - `POST /quick-replies/search`
  - `GET /quick-replies/:id`
  - `POST /quick-replies`
  - `PUT /quick-replies/:id`
  - `DELETE /quick-replies/:id`
  - `POST /quick-replies/:id/use`
- **Service/model principal**: `api/services/quickRepliesService.js`
- **Frontend**: `QuickRepliesPage.jsx` e `SupportPage.jsx` usam `frontend/src/api/quickReplies.js`

### Departamentos

- **Rotas**:
  - `GET /departments`
  - `GET /departments/:id`
  - `POST /departments`
  - `PUT /departments/:id`
  - `DELETE /departments/:id`
  - `POST /departments/:id/agents`
  - `DELETE /departments/:id/agents/:agentId`
- **Service/model principal**: `api/services/departmentsService.js` + Model `Department`

### Bulk messaging (campanhas)

- **Rotas**:
  - `GET /bulk-campaigns`
  - `GET /bulk-campaigns/:id`
  - `POST /bulk-campaigns`
  - `PUT /bulk-campaigns/:id`
  - `DELETE /bulk-campaigns/:id`
  - `POST /bulk-campaigns/:id/start`
  - `POST /bulk-campaigns/:id/pause`
  - `POST /bulk-campaigns/:id/resume`
- **Service/model principal**: `api/services/bulkMessagingService.js`

### Analytics e exportação

- **Rotas (analytics)**:
  - `GET /analytics/metrics`
  - `GET /analytics/general`
  - `GET /analytics/agents`
  - `GET /analytics/departments`
  - `GET /analytics/queues`
  - `GET /analytics/trends`
- **Rotas (export)**:
  - `GET /export/tickets.csv`
  - `GET /export/metrics.csv`
  - `GET /export/conversations.json`
  - `GET /export/full-report.json`
- **Service/model principal**: `api/services/analyticsService.js`, `api/services/exportService.js`
- **Frontend**: `DashboardPage.jsx` usa `frontend/src/api/analytics.js`

### IA (sugestão/reescrita) e áudio

- **Rotas**:
  - `POST /ai/suggest-response`
  - `POST /ai/rewrite-message`
  - `POST /ai/rewrite-multiple`
  - `POST /api/ai/generate`
  - `POST /ai/chatbot/generate`
  - `POST /ai/rpa/generate`
  - `POST /audio/transcribe`
- **Service/model principal**:
  - `api/services/aiSuggestionService.js`
  - `api/services/aiProviderService.js`
  - `api/services/audioTranscriptionService.js`

### RAG (documentos, query e aprendizado)

- **Rotas (documentos)**:
  - `GET /rag/documents`
  - `GET /rag/documents/stats`
  - `GET /rag/documents/:id`
  - `POST /rag/documents`
  - `PUT /rag/documents/:id`
  - `DELETE /rag/documents/:id`
  - `POST /rag/documents/:id/reindex`
  - `POST /rag/documents/reindex-all`
  - `GET /rag/deduplication/stats`
- **Rotas (query/learning)**:
  - `POST /rag/query`
  - `GET /rag/learning/metrics/:tenantId`
  - `GET /rag/learning/full-data/:tenantId`
  - `POST /rag/learning/update-synonyms`
  - `POST /rag/learning/trigger-learning/:tenantId`
  - `PUT /rag/learning/synonyms`
  - `DELETE /rag/learning/synonyms/:tenantId/:term`
  - `GET /rag/learning/validation-rules`
  - `POST /rag/learning/validation-rules/adapt/:tenantId`
  - `POST /rag/learning/clean-invalid-queries/:tenantId`
  - `GET /rag/domains`
- **Service/model principal**: `api/services/ragDocumentsService.js`, `api/services/ragService.js`

### Web scraping

- **Rotas**:
  - `POST /web-scraping/scrape`
  - `POST /web-scraping/scrape-batch`
- **Service/model principal**: `api/services/webScrapingService.js`

### Webhooks customizados (eventos do sistema)

- **Rotas**:
  - `GET /webhooks/events`
  - `GET /webhooks`
  - `GET /webhooks/:id`
  - `POST /webhooks`
  - `PUT /webhooks/:id`
  - `DELETE /webhooks/:id`
- **Service/model principal**: `api/services/webhookService.js` + Model `Webhook`

### RPA (recordings, execução e relatórios)

- **Rotas**:
  - `GET /rpa/recordings`
  - `DELETE /rpa/recordings/:id`
  - `POST /rpa/execute/:recordingId`
  - `GET /rpa/execution/:executionId`
  - `POST /rpa/execution/:executionId/cancel`
  - `POST /rpa/execution/:executionId/continue`
  - `POST /rpa/execution/:executionId/next`
  - `GET /rpa/execution/:executionId/report`
  - `POST /rpa/record/start`
  - `POST /rpa/record/stop/:recordingId`
  - `GET /rpa/record/status/:recordingId`
  - `GET /tests/rpa/reports/:filename`
  - `GET /tests/rpa/replay`
  - `GET /tests/rpa/replay/:filename`
  - `DELETE /tests/rpa/replay/:filename`
- **Service/model principal**: `api/services/rpa*` + arquivos de teste/replay (infra)

### QA

- **Rotas**:
  - `GET /qa/latest`
  - `GET /qa/history`
  - `GET /qa/stats`
  - `GET /qa/:id`
  - `POST /qa/run`
- **Service/model principal**: `api/services/qaService.js` (e armazenamento associado)

### Dev tools (CRUD de arquivos)

- **Rotas**:
  - `GET /dev/files`
  - `GET /dev/files/:type/:path`
  - `PUT /dev/files/:type/:path`
- **Service/model principal**: handler em `api/server.js` (FS)

### Templates genéricos e marketplace de flows

- **Rotas (templates)**:
  - `GET /templates`
  - `GET /templates/:id`
  - `POST /templates`
  - `DELETE /templates/:id`
- **Rotas (flow-templates/marketplace)**:
  - `GET /flow-templates`
  - `GET /flow-templates/:id`
  - `POST /flow-templates`
  - `POST /flow-templates/:id/install`
  - `DELETE /flow-templates/:id`
- **Service/model principal**:
  - `api/services/flowTemplateMarketplaceService.js`
  - `api/services/templateService.js` (templates genéricos; quando aplicável)

### Config

- **Rotas**:
  - `GET /config`
  - `PUT /config`
  - `POST /config/validate-provider-token`
  - `POST /config/validate-redis`
  - `GET /contracts/rag/question-generation.rules.json`
  - `GET /api/data/rag_question_generation_rules.json`
- **Service/model principal**: `api/utils/config`, validações (provider/redis), serve arquivos de contrato

---

## Frontend: páginas solicitadas e quais APIs usam

### `frontend/src/pages/SupportPage.jsx`

- **Módulos**:
  - `frontend/src/api/tickets.js` → `/queues`, `/tickets`, `/tickets/:id/*` (assign, takeover, return-to-bot, pause, close, message, mark-read, ai-summary)
  - `frontend/src/api/conversations.js` → `/conversations/:id/messages`
  - `frontend/src/api/quickReplies.js` → `/quick-replies*`
  - `frontend/src/api/closeReasons.js` → `/close-reasons`
  - `frontend/src/api/segmentation.js` → `/segmentation/*` e `/tickets/:id/tags|category`
  - `frontend/src/api/audit.js` → `/audit/logs`

### `frontend/src/pages/DashboardPage.jsx`

- **Módulos**:
  - `frontend/src/api/analytics.js` → `/analytics/general` e `/analytics/queues`

### `frontend/src/pages/AuditPage.jsx`

- **Módulos**:
  - `frontend/src/api/auth.js` (conversas/sessões, dependendo da implementação atual)
  - `frontend/src/api/audit.js` → `/audit/logs` e `/audit/stats`

### `frontend/src/pages/QuickRepliesPage.jsx`

- **Módulos**:
  - `frontend/src/api/quickReplies.js` → `/quick-replies*` (CRUD + categorias/tags + search)

### `frontend/src/pages/TicketMaintenancePage.jsx`

- **Módulos**:
  - `frontend/src/api/tickets.js` → `/tickets` (listagem), `/queues` (CRUD) e `/metrics/queues` (KPIs de filas)

---

## Próximas lacunas confirmadas (para orientar as fases seguintes)

- **Handover**:
  - Existe `takeover/return-to-bot/pause/resume`. Próximo passo é padronizar semântica (ex.: “resume” sempre volta para `human`) e evoluir UX (ex.: motivo configurável e visibilidade de status).
- **SLA/roteamento**:
  - `Queue` já tem `routing_strategy/priority/department_id`; falta consolidar `routingService`/auto-assign e garantir atualização consistente de `first_response_at/resolved_at` em eventos operacionais.
- **WhatsApp reliability**:
  - Já há base de idempotência (`external_message_id` + índices) e outbound queue DB-first; falta expor e polir UX de status/falhas (ex.: endpoint de “delivery failures”, reenvio, etc.).

