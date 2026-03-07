# Sistema de Agendamento Generalista

## Objetivo
Este módulo implementa uma infraestrutura central de agenda operacional, desacoplada de atendimento humano e reutilizável por qualquer domínio (ticket, CRM, tarefas, SLA, operações internas).

## Modelo Único (`operational_schedules`)
Um único objeto cobre todos os casos:

- `id`
- `tenant_id` (`tenant_key` no banco)
- `context_type`: `ticket | crm | task | system | custom`
- `context_id`
- `contact_id` (opcional)
- `conversation_id` (opcional)
- `channel`: `whatsapp | voice | email | internal | system`
- `mode`: `free | team_based`
- `origin`: `bot | human | system`
- `start_at`, `end_at`, `timezone`
- `requires_confirmation` (bool)
- `confirmation_status`: `pending | confirmed | declined | not_required`
- `status`: `draft | scheduled | in_progress | done | no_show | canceled`
- `owner_id`, `team_id` (opcionais)
- `purpose`, `notes`, `metadata`
- `idempotency_key` (única por tenant)
- `created_at`, `updated_at`

## Eixos de Variação

### 1) Confirmação
- `requires_confirmation=true`: inicia como `confirmation_status=pending`.
- `requires_confirmation=false`: inicia como `confirmation_status=not_required`.

### 2) Disponibilidade
- `mode=free`: não exige checagem de disponibilidade.
- `mode=team_based`: backend valida jornada, bloqueios e conflitos.

### 3) Canal
Independente do canal. O core não depende de WhatsApp.

### 4) Origem
`origin` identifica quem disparou (`bot`, `human`, `system`), sem alterar o modelo.

## Infra de Disponibilidade

### Jornadas
Tabela: `schedule_working_hours`
- Escopo por `scope_type` (`team|owner`) + `scope_id`.
- Janela por dia da semana (`weekday`) com `start_time/end_time`.

### Bloqueios
Tabela: `schedule_blocks`
- Bloqueios manuais/sistêmicos por escopo (`team|owner`).
- Janelas `start_at/end_at` com `active`.

### Reservas
Conflitos são detectados no backend em `operational_schedules` para status ativos (`scheduled`, `in_progress`).

## Serviço de Domínio
Arquivo: `api/services/schedulingService.js`

Funções principais:
- `createSchedule()`
- `confirmSchedule()`
- `declineSchedule()`
- `rescheduleSchedule()`
- `cancelSchedule()`
- `markInProgress()`
- `markDone()`
- `markNoShow()`
- `listSchedules()`
- `getAvailability()`

Complementares de infraestrutura:
- `upsertWorkingHours()`, `listWorkingHours()`
- `createBlock()`, `listBlocks()`, `deactivateBlock()`
- `listReminders()`

## Confirmação Genérica
A confirmação pode vir de:
- UI humana (`/api/schedules/:id/confirm` / `decline`)
- integração de mensagem (qualquer canal)
- fluxo de sistema (`by=system`)

O core não presume reply-context de WhatsApp.

## Confirmação por WhatsApp

Implementação operacional em `api/services/scheduleWhatsAppResponder.js` + parser `api/utils/scheduleReplyParser.js`.

- Reconhece respostas: `1/confirmar/confirmo/ok/sim/confirmado`, `2/reagendar/remarcar/trocar/outro horário`, `3/cancelar/cancela/não/desmarcar`.
- Resolução do schedule alvo:
1. `reply_to_message_id`/contexto de citação da mensagem (metadata `confirmation_message_id` e `schedule_message_links`).
2. Fallback por `tenant + conversation_id/contact_id` com `status=scheduled`, `requires_confirmation=true`, `confirmation_status=pending`, janela configurável (`SCHEDULE_WA_RESOLVE_WINDOW_BACK_DAYS`, `SCHEDULE_WA_RESOLVE_WINDOW_AHEAD_DAYS`).
- Respostas operacionais (sem IA):
1. Confirmado: `✅ Confirmado! Falamos em ...`
2. Cancelado: `❌ Agendamento cancelado...`
3. Reagendamento: oferece 3 slots e salva estado em `metadata.reschedule_state=awaiting_choice` + `metadata.reschedule_options`.
- Escolha de slot (`1/2/3`) executa `rescheduleSchedule` e finaliza estado de reagendamento.
- Sempre respeita handover bot↔humano: este fluxo é template operacional, fora da resposta IA.

## Engine de Lembretes
Tabela: `schedule_reminders`
- Offsets em minutos (negativos/positivos).
- Ações: `notify`, `request_confirmation`, `mark_no_show`.
- Totalmente orientada a dados via `reminders` no payload/metadados do schedule.

## Reminders Worker

Serviços:
- `api/services/scheduleRemindersService.js`
- `api/workers/scheduleRemindersWorker.js`

Bootstrap:
- `ENABLE_SCHEDULE_REMINDERS_WORKER=true` inicia worker no `api/server.js`.
- Intervalo configurável: `SCHEDULE_REMINDERS_WORKER_INTERVAL_MS` (default `60000`).

Execução:
1. Seleciona candidatos due (`status=pending`, `execute_at<=now`) via Sequelize (`findAll` com `limit/order`).
2. Faz claim otimista por item (`UPDATE ... WHERE id=? AND status='pending'`) e só processa quando `affectedRows===1`.
3. Executa ação:
   - `notify`: envia lembrete operacional via `outbound_queue` (WhatsApp).
   - `request_confirmation`: reenvia template `1/2/3` se schedule ainda `pending`.
   - `mark_no_show`: aplica regra de grace + status e executa `markNoShow`.
4. Marca `done` ou `failed` com `last_error`.
5. Recovery de `processing` preso por timeout (`SCHEDULE_REMINDERS_PROCESSING_TIMEOUT_MINUTES`):
   - `SCHEDULE_REMINDERS_STALE_STRATEGY=requeue` (padrão) volta para `pending`.
   - `SCHEDULE_REMINDERS_STALE_STRATEGY=failed` marca `failed`.

Defaults automáticos no backend (quando schedule nasce sem `reminders`):
- `requires_confirmation=true`: `-24h request_confirmation`, `-1h notify`, `+10m mark_no_show` (se habilitado).
- `requires_confirmation=false`: `-1h notify`, `+10m mark_no_show` opcional.

## Compatibilidade Multi-Banco (inclui Oracle)

O domínio de agendamento foi implementado para operar sem dependência de dialeto específico:

- Campos JSON-like (`metadata`, `payload`) são persistidos em `TEXT/CLOB` com JSON serializado.
- Nos models, getters/setters mantêm a API de objeto JavaScript (`metadata` e `payload`) sem exigir `JSONB`.
- Claim do worker usa `UPDATE` condicional (otimista) no lugar de `SKIP LOCKED`/`RETURNING`.
- Comparações de data/hora usam `new Date()` no backend, sem `NOW()`/`SYSDATE` em SQL manual.
- Paginação usa `findAll({ limit, offset })` do Sequelize.
- Idempotência usa `UNIQUE (tenant_key, idempotency_key)` + tratamento genérico por `SequelizeUniqueConstraintError`.

Limitações e recomendações:

- `TEXT/CLOB` evita lock-in de tipo JSON nativo, mas não permite indexar campos internos do JSON de forma portável.
- Para consultas frequentes por campos dentro de metadata/payload, promover atributos críticos para colunas explícitas.
- Em ambientes multi-worker, manter timeout/recovery calibrado para evitar reprocessamentos tardios.

## Endpoints REST

- `POST /api/schedules`
- `GET /api/schedules`
- `GET /api/schedules/availability`
- `POST /api/schedules/:id/confirm`
- `POST /api/schedules/:id/decline`
- `POST /api/schedules/:id/reschedule`
- `POST /api/schedules/:id/cancel`
- `POST /api/schedules/:id/in-progress`
- `POST /api/schedules/:id/done`
- `POST /api/schedules/:id/no-show`
- `GET/POST /api/schedules/working-hours`
- `GET/POST /api/schedules/blocks`
- `POST /api/schedules/blocks/:id/deactivate`
- `GET /api/schedules/reminders`

## Auditoria e Event Ledger
Toda operação chama:
- `auditService.logAction(...)`
- `eventLedgerService.appendEventV1(...)`

Eventos canônicos incluem:
- `ScheduleCreated`
- `ScheduleConfirmed`
- `ScheduleDeclined`
- `ScheduleRescheduled`
- `ScheduleCanceled`
- `ScheduleInProgress`
- `ScheduleDone`
- `ScheduleNoShow`
- `ScheduleWorkingHoursUpdated`
- `ScheduleBlockCreated`
- `ScheduleBlockDeactivated`

## Frontend Generalista
Componente reutilizável: `frontend/src/components/ScheduleModal.jsx`

Integrações atuais:
- Ticket: `SupportPage`
- Tarefa: `TasksPage`
- Contato CRM: `ContactsPage`
- Opportunity CRM: `OpportunitiesPage`

O frontend nunca decide disponibilidade; apenas consulta backend.

## Integração no Support

`frontend/src/pages/SupportPage.jsx` foi conectado para uso operacional:

- Abertura do `ScheduleModal` por:
1. Botão visível `Agendar`.
2. Comando `/agendar`.
- Contexto padrão do ticket:
1. `contextType=ticket`
2. `contextId=ticket.id`
3. `contactId`, `conversationId` quando disponíveis
4. `defaultChannel=whatsapp`
5. `defaultPurpose=retorno`
- Painel lateral `Agendamentos` lista `GET /api/schedules?contextType=ticket&contextId=...` e expõe ações:
1. Confirmar
2. Reagendar
3. Cancelar
4. Done
5. No-show
- UI destaca `requires_confirmation` + `confirmation_status`, sem acionar IA durante handover humano.

## Exemplos de Uso

### Atendimento
- `context_type=ticket`, `channel=whatsapp`, `purpose=retorno`, `mode=team_based`.

### CRM
- `context_type=crm`, `context_id=<opportunityId>`, `channel=internal`, `purpose=follow-up`.

### Tarefa Interna
- `context_type=task`, `channel=internal`, `mode=free`, `requires_confirmation=false`.

### SLA Automático
- `context_type=system`, `origin=system`, `purpose=sla_callback`, lembrete `mark_no_show`.

## Integração com WhatsApp
WhatsApp é só um valor de `channel` (`whatsapp`).
As transições e regras de agenda permanecem no core generalista.

## Smoke de Aceite (Checklist 1-6)

Backend (itens 1,2,3,4,6):
- `SMOKE_ALLOW_DB_WRITE=true npm run test:scheduling:whatsapp:first:smoke:backend`

Backend + Frontend (inclui item 5 via teste de `SupportPage`):
- `npm run test:scheduling:whatsapp:first:smoke`
