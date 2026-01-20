## OPERATION_GUIDE — Operação estilo Call Center (Blip-like)

Este guia descreve como operar o `r-agent2` em produção com foco em **atendimento humano**, **filas**, **SLA**, **handover bot ↔ humano** e **observabilidade**.

### Conceitos operacionais

- **Ticket**: unidade de atendimento humano (status `waiting` → `in_progress` → `closed`).
- **Modo (handover)**:
  - **BOT** (`mode=bot`): a engine pode responder automaticamente.
  - **HUMANO** (`mode=human`): a engine **não** responde; o atendente conduz.
  - **PAUSADO** (`mode=paused`): a engine **não** responde; ticket fica “bloqueado” (ex.: compliance/janela WhatsApp).
- **Fila**: agrupamento lógico (`queue` string) com metadados persistidos em `queues` (priority, routing_strategy, department_id).
- **Atribuição automática**:
  - `manual`: não atribui.
  - `round_robin`: alterna agentes (com cursor persistido em `queue_assignment_states`).
  - `least_busy`: escolhe agente com menos tickets `in_progress`.

### Fluxo recomendado de atendimento

- **1) Entrada do usuário (WhatsApp/Instagram)**:
  - O sistema persiste a mensagem (omnichannel) e resolve o tenant por `channel_accounts`.
  - Se já existe ticket e está em **HUMANO/PAUSADO**, o bot não responde e a UI é notificada.

- **2) Assumir atendimento (handover)**:
  - No console (`/support`), clique **“Assumir atendimento”** para colocar em **HUMANO**.
  - O sistema registra:
    - Auditoria (`audit`)
    - Evento (`ticket_events`)
    - Histórico (`handoverHistory` em `Ticket.context`)

- **3) Atribuir**:
  - Se a fila estiver configurada para auto-assign, o ticket pode ser atribuído automaticamente ao entrar em HUMANO.
  - Manualmente, use **“Atribuir Ticket”**.

- **4) Responder**:
  - Envio de mensagens usa **Outbound Queue** (retry/backoff).
  - Status de entrega aparece na timeline (✓, ✓✓, ✓✓ azul, !).

- **5) Encerrar**:
  - Encerramento exige motivo (Close reason).
  - Opcionalmente, aplique tags no fechamento.

### Observabilidade e troubleshooting

- **Saúde do sistema**:
  - `GET /system/status`
  - `GET /system/channel-health` (inclui backlog e falhas do outbound)
- **Falhas de entrega do ticket**:
  - UI: botão **“Falhas de entrega”** no ticket
  - API: `GET /tickets/:id/delivery-failures`

### Rotinas recomendadas de supervisão

- Monitorar:
  - backlog por fila (`/analytics/queues`, `/metrics/queues`)
  - SLA (TME/TMA) via `/analytics/general`
  - outbound failures (channel health + delivery failures)
- Ajustar:
  - estratégia de roteamento por fila (`queues.routing_strategy`)
  - composição de departamento/agentes (departments)

