# Arquitetura — Handover Bot ↔ Humano (Tickets = Conversa)

Este documento descreve a **Fase 2** do r-agent2: alternância perfeita entre bot e humano, mantendo compatibilidade com o modelo atual de tickets e a arquitetura sem Express.

## Objetivo

Tornar o **ticket o “controle” da conversa**:

- `ticket.mode = human`: engine **não** envia respostas automáticas
- `ticket.mode = bot`: mensagens seguem para a engine normalmente
- A UI permite alternar (handover) com histórico e auditoria

## Alterações de Dados (PostgreSQL / Sequelize)

Migration: `api/db/migrations/20260119000005-add-ticket-handover-fields.js`

Novas colunas em `tickets`:

- `conversation_id` (string, nullable): liga ao `channel_conversations.id` quando disponível
- `channel_type` (string, nullable): `whatsapp|instagram|webchat`
- `mode` (string, NOT NULL): `bot|human` — **default: `human`** (compatibilidade)
- `pause_reason` (string, nullable):
  - `user_request`
  - `agent_takeover`
  - `outside_window`
  - `failed_delivery`
  - `compliance`
  - `inactivity`

Além disso, o histórico de handover é mantido em:

- `tickets.context.handoverHistory[]` (JSON) e também como mensagens `sender=system` em `tickets.messages[]`

## Backend

### `api/services/handoverService.js`

Funções:

- `takeOver(ticketId, agent, reason)`
  - muda `ticket.mode` para `human`
  - registra histórico e emite `ticket.updated` via WebSocket
  - best-effort: sincroniza `channel_conversations.status` para `human`

- `returnToBot(ticketId, agent, reason)`
  - muda `ticket.mode` para `bot`
  - registra histórico e emite `ticket.updated` via WebSocket
  - best-effort: sincroniza `channel_conversations.status` para `bot`

- `startAutoReturnToBot({ inactivityMinutes, intervalMs })`
  - varre tickets em `human` e retorna para `bot` por inatividade
  - habilitação via env:
    - `ENABLE_AUTO_RETURN_TO_BOT` (default: habilitado)
    - `AUTO_RETURN_TO_BOT_MINUTES` (default: 30)

### `api/services/messageProcessor.js`

Regra aplicada:

- Se existir ticket ativo para a sessão e `ticket.mode === 'human'`, o processamento **para** (sem respostas automáticas).
- Se `ticket.mode === 'bot'`, o processamento segue normalmente.

## Endpoints

Novos endpoints (multi-tenant via `requireAuth` + `req.tenantId`):

- `POST /tickets/:id/takeover`
  - body opcional: `{ "reason": "agent_takeover" }`
  - retorna o ticket atualizado

- `POST /tickets/:id/return-to-bot`
  - body opcional: `{ "reason": "user_request" }`
  - retorna o ticket atualizado

Auditoria (AuditService):

- `ticket_takeover`
- `ticket_return_to_bot`

## Frontend (SupportPage)

Em `frontend/src/pages/SupportPage.jsx`:

- Mostra **Modo atual** (Humano/Bot) e `pauseReason` quando existir
- Botões:
  - “Assumir atendimento” (quando modo bot)
  - “Devolver ao bot” (quando modo humano)
- Lista um resumo do **histórico de handover** (últimos 5 eventos)

API client:

- `frontend/src/api/tickets.js`: `takeOverTicket()` e `returnToBotTicket()`

