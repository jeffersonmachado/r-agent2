# Arquitetura — Filas, Roteamento e SLA (Fase 3)

Este documento descreve as entregas da **Fase 3**: filas estruturadas (queue definitions), roteamento automático e métricas de SLA.

## Objetivo

- Evoluir “queue” de string para um **modelo com metadados**:
  - `priority`, `departmentId`, `routingStrategy`
- Implementar **auto-assign**:
  - `round_robin`, `least_busy`, `manual`
  - reassign quando operador fica offline (best-effort via WebSocket)
- Registrar e expor **SLA**:
  - TME (Tempo Médio de Espera / 1ª resposta)
  - TMA (Tempo Médio de Atendimento / handling)
  - taxa de abandono
  - contenção bot (best-effort)

## Modelos e Migrations

### `queues` (definição de filas)

Migration: `api/db/migrations/20260119000006-create-queues.js`  
Model: `api/db/models/Queue.js`

Campos:

- `tenant_key`
- `name` (único por tenant)
- `priority` (int)
- `department_id` (opcional)
- `routing_strategy` (`manual|round_robin|least_busy`)
- `active`

Compatibilidade:

- `GET /queues` continua retornando **array de strings** (nomes), agora unificando:
  - filas “legadas” (em memória)
  - filas definidas em `queues` (por tenant)
- `POST /queues` continua funcionando e também cria uma definição default (best-effort).

### SLA em `tickets`

Migration: `api/db/migrations/20260119000007-add-ticket-sla-fields.js`

Campos novos:

- `first_response_at`
- `resolved_at`
- `waiting_time_seconds`
- `handling_time_seconds`

Persistência/atualização:

- Em `queueService.addAgentMessage()`: define `firstResponseAt` na primeira resposta do atendente
- Em `queueService.closeTicket()`: define `resolvedAt` e calcula tempos

## Services

### `api/services/queueDefinitionService.js`

Cache em memória + DB para metadados da fila.

### `api/services/assignmentService.js`

Funções:

- `autoAssign(ticketId)`
  - só atua em tickets `waiting` e não atribuídos
  - usa `queueDefinitionService` para ler `routingStrategy`
  - candidatos por tenant; se houver dept associado, restringe aos agentes do dept
  - prefere agentes **online** (WebSocket), com fallback para elegíveis
- `reassignIfOffline(ticketId)`
  - reatribui ticket `in_progress` quando o agente atual está offline (best-effort)
- `startAssignmentWorker()`
  - varre periodicamente e reatribui offline (habilitar/desabilitar via env)

Env:

- `ENABLE_ASSIGNMENT_WORKER=false` desliga worker

## Analytics / Dashboard

### `api/services/analyticsService.js`

Adiciona campos:

- `avgFirstResponseTimeSeconds` (TME)
- `avgHandlingTimeSeconds` (TMA)
- `abandonmentRate` (0..1)
- `botContainmentRate` (0..1 ou `null`)

`botContainmentRate` é best-effort e tenta usar `channel_conversations` quando disponível.

### `frontend/src/pages/AnalyticsPage.jsx`

Exibe cards de SLA:

- TME, TMA
- abandono
- contenção bot

