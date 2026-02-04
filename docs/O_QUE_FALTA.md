# O que falta (fonte única) — backlog operacional e critérios de “v1 vendável”

Este documento é a **fonte de verdade única** do “o que falta” a partir do estado atual do repositório (Fev/2026).  
Ele substitui a visão antiga “capability-driven vs benchmarks” como lista operacional de execução.

> Referências: `docs/ROADMAP_3A5_ANOS.md` (Now/Next/Later) e `docs/O_QUE_FALTA_GAPS_VS_BENCHMARKS.md` (histórico/benchmark).

---

## 1) Estado atual (Fev/2026) — o que já foi entregue (resumo)

### Core (eventos + execução)
- **Event Model canônico v1**: `api/events/eventModelV1.js`
- **Event ledger append-only (`event_ledger`)**: migration `api/db/migrations/20260204020000-create-event-ledger.js` + `api/services/eventLedgerService.js`
- **Retenção mínima (prune)**: `api/services/pruneEventLedgerService.js` (por `EVENT_LEDGER_RETENTION_DAYS`)
- **Execution Queue + Scheduler v1 (DB-first)**:
  - migrations `api/db/migrations/20260204021000-create-exec-jobs-and-schedules.js`
  - worker `api/services/executionQueueService.js`
  - scheduler `api/services/schedulerService.js`
  - SLA scan `api/services/opsSlaService.js` (`DeliverySLARisk`, `PhysicalSLARisk`)
- **Execution ledger por nó (v1, DB-first)**:
  - migrations `api/db/migrations/20260204031000-create-flow-execution-ledger.js` (tabelas `flow_executions` + `node_executions`)
  - serviço: `api/services/flowExecutionLedgerService.js` (header + steps por node; replay controlado em modo simulation)
- **Dispatcher de triggers a partir do `event_ledger` (v1 parcial)**:
  - cursor: migration `api/db/migrations/20260204033000-event-dispatch-state-and-schedule.js` (`event_dispatch_state` + schedule `scan_event_triggers`)
  - serviço: `api/services/eventLedgerTriggerDispatcher.js` (scan + enqueue + dispatch via webhooks)

### Suites verticais (MVP→v1 operacional)
- **Fast service (filas físicas)**:
  - público por token: `/physical/*` (kiosk/panel/station) em `api/server.js`
  - operações adicionais (station): `start/skip/transfer`
  - admin: `GET/POST /api/physical/queues`, `GET /api/physical/metrics`
  - sequenciamento robusto: `physical_ticket_sequences` (migration `20260204022000-physical-queues-multiunit-and-sequences.js`)
- **Pedidos/Storefront/Delivery**:
  - público por token: `POST /storefront/orders`
  - hardening v1: idempotência por `idempotencyKey` (storefront) + propagação de `correlationId` (best-effort)
  - incidente mínimo: `POST /orders/:id/incidents` (abre ticket digital e emite evento)
- **PBX v1**:
  - base produto/realtime/CDR via migrations PBX
  - `dialplan/apply` com trilha mínima em `pbx_config_versions` (signature)
  - **Provisionamento de ramais (MVP)**: `POST /api/pbx/extensions` aceita `provisioning` (vendor+mac) e expõe `GET /provision/<tenantKey>/<vendor>/<mac>` (ou com token). Ver `docs/PBX_PROVISIONING_GRANDSTREAM_AVAYA.md`.

### Gate operacional
- **Selftest**: `GET /health/selftest`
- **Runner de stack**: `scripts/system-autotest-stack.sh` com gate de selftest (FAIL bloqueia)
- **Unit tests**: `npm run test:unit` passando no estado atual
- **Bootstrap/autoprovisionamento (base)**:
  - `startInitialization()` em `api/server.js` garante `systemadmin`/tenant `system` (primeira inicialização).
  - Seed idempotente: `api/db/seed.js` (+ utilitário `scripts/create-super-admin.js`).
  - One-click bootstrap (super-admin): `POST /super-admin/bootstrap/one-click` (serviço `api/services/oneClickBootstrapService.js`).

---

## 2) Backlog único (priorizado) — Now/Next/Later (o que falta)

> Regra: cada item abaixo é “único” (não duplicar em outros docs). Se um tema aparecer em mais de um pilar, ele deve ser referenciado (não replicado).

### Now (0–3 meses) — hardening para v1 vendável (suite operável)

#### 2.1 Execução “enterprise mínima” (sem prometer marketplace)
- **Conectar o execution ledger por nó ao runtime + expor consulta/replay assistido**
  - **Status**: a base DB-first já existe (`flow_executions`/`node_executions` + `flowExecutionLedgerService`).
  - **Saídas mínimas**:
    - registrar execuções reais do DAG (não só simulation/flows específicos)
    - endpoints de consulta (por `execution_id`, `correlation_id`, `subject_id`) com RBAC
    - replay parcial “from node” com controles (ambiente/flag) e trilha auditável
  - **Critério de pronto**: responder “o que aconteceu em qual node” e permitir replay controlado com rastreabilidade.

#### 2.2 Queue/Scheduler v1 → enterprise mínimo
- **Quotas por tenant + DLQ formal + observabilidade**
  - **Saídas mínimas**:
    - limites por tenant (concorrência, jobs/min)
    - DLQ consultável e reprocessável (com auditoria)
    - métricas (lag, taxa de falha, retries) + selftest WARN/FAIL por limiar
  - **Critério de pronto**: “não explode em produção” e dá visibilidade de gargalos.

#### 2.3 Fast service v1 → vendável (operação + auditoria + métricas)
- **Auditoria operacional consultável**
  - hoje há eventos e métricas mínimas, mas falta trilha “quem fez o quê” por estação/unidade/serviço.
- **Métricas v1 completas**
  - abandono, produtividade por estação, e recortes por unidade/fila/horário.
- **Definição e contratos de estados**
  - clarificar `waiting/called/in_service/done/abandoned` e transições + idempotência.

#### 2.4 Orders/Delivery v1 → vendável (SLA + incidentes operáveis)
- **SLA operacional e dashboard mínimo**
  - consolidar `order_to_ready` e `order_to_deliver` como KPIs e alertas.
- **Incidente operacional (omnichannel)**
  - amarrar ticket de incidente ao pedido (1:1), com idempotência e status.

#### 2.5 Tokens públicos (segurança operacional)
- **Ciclo de vida vendável (já existe em serviço/migration) + APIs/UI**
  - **Status**: existe base de lifecycle (expiração/revogação/rotação/last_used) em:
    - migration `api/db/migrations/20260204030000-public-access-tokens-lifecycle.js`
    - serviço `api/services/publicAccessTokenService.js` (`revokePublicToken`, `rotatePublicToken`, `expiresAt`, `lastUsedAt`)
  - **Saídas mínimas**:
    - endpoints admin para listar/revogar/rotacionar tokens (com auditoria)
    - política de rate-limit por token/kind e dashboards mínimos de uso

#### 2.6 Autoprovisionamento v1 (reduzir “tempo até operar”)
- **Hardening do one-click bootstrap (já existe)**
  - **Status**: existe endpoint super-admin `POST /super-admin/bootstrap/one-click` + serviço `oneClickBootstrapService` (idempotente).
  - **Saídas mínimas**:
    - checklist/relatório padronizado + logs operacionais
    - opções por suíte (fast service / pedidos / PBX) e por unidade (location)
    - gates de segurança (limitar quando/quem pode executar; auditar)

#### 2.7 PBX — autoprovisionamento de ramais v1.1 (parque real)
- **Provisioning “vendável” (além do mínimo SIP)**
  - **Saídas mínimas**:
    - templates por **vendor/model/firmware** (ex.: Grandstream por série; Avaya 96x1/J-series por variação)
    - parâmetros operacionais: codecs, TLS/SRTP (quando aplicável), NTP, timezone, BLF/teclas, voicemail/MWI (se suportado)
    - rotação/expiração de token (`PROVISIONING_PUBLIC_TOKEN`) e trilha auditável (quem provisionou, quando)
    - provisionamento em lote (bulk) e “sanity check” (MAC duplicado, ramal desativado, senha fraca)
  - **Critério de pronto**: um parque típico (Grandstream/Avaya) sobe com baixa intervenção manual e rollback simples.

### Next (3–6 meses) — “tudo vira evento/node” (primeiro corte real)

#### 2.8 Triggers do runtime a partir do `event_ledger`
- **Consumer/dispatcher** de `event_ledger` para acionar execuções (regras mínimas)
  - mapping evento→flow/trigger, com `correlation_id` e idempotência
  - retry/backoff e DLQ (integrado ao item 2.2)
  - **Nota**: já existe dispatcher v1 para webhooks (`eventLedgerTriggerDispatcher`), mas falta ligar os kinds do worker (ex.: `scan_event_triggers` e `dispatch_event_trigger`) e/ou conectar ao runtime do DAG.

#### 2.9 Unificação conversa↔ticket 1:1 (omnichannel)
- **Persistência e idempotência ponta a ponta**
  - conversa tem 1 ticket “current” consistente
  - mensagens não duplicam em retries
  - status por mensagem visível na operação (delivered/read/failed)

#### 2.10 PBX: eventos de chamada v0 (pré-ARI completo)
- **Contrato call events v0**
  - `ringing/answered/ended` entrando no `event_ledger` (CDR + base para ARI/AMI)
  - correlação com ticket/pedido quando aplicável

### Next (6–12 meses) — produto inicial completo (entrada marketing v1)

#### 2.11 Marketing v1 (RD-like mínimo)
- forms/LP/tracker + scoring + jornadas + email (mínimo vendável)
- modelo analítico inicial (funil básico) e bases para ROI

#### 2.12 Templates “solutions” por segmento
- pacotes E2E (fastfood/pizzaria/clínica) com operação e métricas mínimas

### Later (12–24 meses) — plataforma integrada (SDK/marketplace + ROI + voz v1 no DAG)
- **SDK/marketplace de nodes** com governança (sandbox/perms/versionamento/assinatura)
- **Analytics/ROI** completo (atribuição, custo por canal, receita por jornada)
- **Voz v1 no DAG** (ARI/AMI, URA visual, filas de voz, gravação, click-to-call)

### Longo (24–60 meses) — enterprise + ecossistema
- SSO/SCIM, ambientes dev/stage/prod para flows, HA/DR, auditoria imutável, programa de parceiros, marketplace monetizado.

---

## 3) Gates e “Definição de Pronto” (DoD) — para declarar v1 vendável

### 3.1 Gate mínimo de CI/Stack
- `scripts/system-autotest-stack.sh` deve cobrir (no mínimo):
  - token público → pedido → transições (kitchen/dispatch) → status público
  - token público → kiosk cria ticket → station opera (call/start/finish/skip/transfer) → panel reflete
  - `/health/selftest` retorna `PASS` ou `WARN` (FAIL bloqueia)

### 3.2 DoD (por tema)
- **Ledger por nó + replay**: execução auditável (inputs/outputs), replay parcial controlado, retenção por tenant.
- **Queue/scheduler enterprise mínimo**: quotas, DLQ, métricas e selftest por limiar.
- **Suites vendáveis** (Fast service + Orders/Delivery): estados consistentes + idempotência + auditoria + KPIs mínimos.

