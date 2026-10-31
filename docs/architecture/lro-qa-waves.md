# LRO — Long-Running Operations (piloto QA Waves)

**Status:** Fase 0 concluída (auditoria + contrato + plano). Sem implementação nesta fase, por exigência
do próprio mandato ("não implemente até ter testes de contrato e matriz de riscos").

Estado medido: worktree `er-fixci`, branch `fix/jest-ci-history`, HEAD `11a9301b1`, árvore limpa.
Base remota autorizada: `dev/engineering-hardening`. `main` intocada.

Complementa — e **não substitui** — `docs/architecture/timeout-architecture.md` (taxonomia
`SLOW != STUCK != DEAD`, deadlines, lease, heartbeat). Toda política de tempo deste documento referencia
aquela taxonomia.

---

## 1. O que já existe (medido, com arquivo:linha)

| # | Componente | Onde | Contrato real | Estado |
|---|---|---|---|---|
| 1 | Fila de execução do QA Waves/Mesh | `qa-mesh/executionQueue.js:5` (`const executions = new Map()`) | `enqueueExecution(kind, payload, runner)`, `getExecution`, `getAllExecutions(limit,{tenantId})`, `appendLog`, `updateExecution` | **EM MEMÓRIA** — sem DB, sem arquivo |
| 2 | Trava de execução única | `qa-mesh/executionQueue.js:118` (`getActiveExecution`) + `:127` (`enqueueExecution`) | lança `EXECUTION_ALREADY_RUNNING` | **GLOBAL** — não filtra tenant (ver §3.1) |
| 3 | Espera bloqueante de execução | `qa-mesh/executionQueue.js:23` (`waitForQueuedExecution`, default 60 s) | `onUpdate` callback | Bloqueia a requisição HTTP que a usa |
| 4 | Orquestração mesh | `api/services/qaMeshService.js:327` (`queueMeshRun`), `:419` (replay) | delega a `executionQueue` | Reaproveitável |
| 5 | API de execuções | `api/modules/qa-waves/routes.js:396` (GET), `:479` (POST), `:375` (DELETE), `:438` (detalhe) | HTTP + `requireAuth` + tenant + classificação DEVELOPMENT | Reaproveitável |
| 6 | Entrega em tempo real | `api/services/websocketService.js` (756 linhas) | `validateToken` (:19), índice por tenant `tenantClients` (:66-71), `broadcastToTenant` | **EFÊMERO** — sem log durável, sem cursor |
| 7 | Lease distribuído (Mission) | `api/db/migrations/20260924160000-engineering-mission-distributed-lease.js`, `api/db/models/EngineeringMission.js:78` (`lease_expires_at`), índice `:116` | lease + expiração | **REUTILIZÁVEL** (modelo de referência) |
| 8 | Lease + fencing (Task) | `api/db/migrations/20260925120000-engineering-task-lease-fencing.js`, `api/db/models/EngineeringTask.js:57`, índice `:92`, `api/services/engineeringRouter/engineeringTaskService.js` | fencing token impede escrita de dono antigo | **REUTILIZÁVEL** |
| 9 | Deadline de operação | `api/utils/operationDeadline.js` | deadline + classificação de expiração | **REUTILIZÁVEL** |
| 10 | Outbox com retry/backoff e idempotência | `api/services/outboundQueueService.js:132` (backoff exponencial cap 300 s + jitter), `:184-202` (grava `attempt` **antes** do provider, `idempotency_key`) | outbox transacional de mensageria | **PADRÃO REUTILIZÁVEL** (não é genérico) |
| 11 | SSE | `api/modules/pbx/pbx-core/operatorPanelRoutes.js` (`text/event-stream`) | painel de operador PBX | Só PBX; sem `Last-Event-ID` |
| 12 | Redis Streams | — | — | **INEXISTENTE** (0 arquivos com `XADD`) |
| 13 | Entidade LRO genérica | — | `lro_*` | **INEXISTENTE** (0 arquivos) |
| 14 | Governed runs (release) | `governance_runs` (model `api/db/models/GovernanceRun.js`) | estado de run de governança | Referência de máquina de estados |

---

## 2. Lacunas (o que falta para LRO)

1. **Persistência**: execução do QA Waves vive só no processo. Reinício do servidor, deploy ou segunda
   instância ⇒ histórico perdido e nenhuma recuperação. Não há `status/phase/progress` autoritativos em DB.
2. **Eventos duráveis**: WS entrega apenas o que acontece enquanto o cliente está conectado. Sem log
   append-only e sem cursor (`Last-Event-ID`), reconexão perde eventos — não há como reidratar a UI.
3. **Replay/retomada**: `waitForQueuedExecution` bloqueia a requisição; não existe retomada após crash
   nem reconciliação de execução órfã.
4. **Feedback humano**: não há entidade de pedido/resposta de decisão humana com prazo, escopo e
   idempotência; aprovações de missão existem no domínio Mission, não no QA Waves.
5. **Progresso**: o progresso vem do runner em memória; não há `progress_current/total` autoritativo, nem
   revisão de total quando o escopo muda (cenários adicionados no meio).
6. **Cancelamento cooperativo**: `DELETE /executions` limpa registros; não há transição `CANCELLED`
   coordenada com o runner nem compensação.
7. **Observabilidade**: sem métricas de fila/execução (backlog, duração, taxa de falha, cardinalidade).

---

## 3. Riscos (com a evidência que os sustenta)

### 3.1 R1 — Trava de execução é GLOBAL e vaza entre tenants (severidade alta)

`enqueueExecution` (`qa-mesh/executionQueue.js:127`) chama `getActiveExecution()` (`:118`), que varre
`executions.values()` **sem filtro de tenant**. Consequência: a onda em execução do tenant A faz o
`enqueue` do tenant B falhar com `EXECUTION_ALREADY_RUNNING` — indisponibilidade cruzada entre clientes,
sem que o payload de B tenha qualquer relação com A.

### 3.2 R2 — Estado não sobrevive ao processo (alta)

Map em memória (`:5`). Reinício ⇒ `GET /executions` volta vazio e a UI mostra "sem execuções" mesmo tendo
havido execuções reais. Não há reconciliação.

### 3.3 R3 — Reconexão perde eventos (média/alta)

`websocketService` faz broadcast para os clientes conectados. Cliente que perde a conexão não recebe o
intervalo — e não existe log para replay.

### 3.4 R4 — Requisição bloqueada por espera (média)

`waitForQueuedExecution` (default 60 s) é acoplado a caminho HTTP. Medido no ambiente de dev: a página
`/dev/qa-waves` registrou `Request timeout` de 90 s em `/api/qa-waves/executions?limit=50` e em
`/intelligence/*` com a API antiga em execução; a página ficava em `0 Cenários / 0%` (ver
`AI_MEMORY/evidence/engineering-router-hardening-definitivo/RELATORIO.md` §11.38).

### 3.5 R5 — Progresso presumido (média)

Sem total autoritativo, qualquer barra de progresso é narrativa. O mandato exige: progresso desconhecido
é **indeterminado**, nunca 100% presumido; `COMPLETED` não implica GO.

---

## 4. Contrato LRO proposto (reaproveitando o que existe)

### 4.1 Entidade autoritativa `long_running_operations`

Campos exigidos pelo mandato, com origem de reuso onde já há precedente:

| Campo | Origem/observação |
|---|---|
| `id` UUID, `tenant_id`, `owner_actor_id` | padrão das tabelas do projeto |
| `operation_type`, `visibility_class` (`PRODUCTION|SUPPORT|DEVELOPMENT`) | alinhado a `api/modules/agent-os/experience-segregation.js` |
| `status`, `phase` | estados do §4.2 |
| `progress_current`, `progress_total`, `progress_unit`, `progress_revision` | `progress_revision` cobre "escopo mudou" |
| `message_code`, `result_ref`, `error_code` | `result_ref` aponta para artefato/evidência, nunca embeda payload técnico em PRODUCTION |
| `created_at`, `started_at`, `updated_at`, `completed_at`, `heartbeat_at` | `heartbeat_at` alimenta `SLOW/STUCK/DEAD` de `timeout-architecture.md` |
| `checkpoint_ref`, `version` | optimistic locking (`version`) |
| `lease_owner`, `lease_expires_at`, `fencing_token` | **cópia do desenho de `EngineeringTask`** (migrations 20260924/20260925) |
| `correlation_id`, `idempotency_key`, `retention_policy` | outbox/`outboundQueueService` como precedente |

### 4.2 Estados e transições

`CREATED → QUEUED → RUNNING → {WAITING_FEEDBACK → RUNNING} → {COMPLETED|FAILED|CANCELLED|TIMED_OUT}`,
com `PAUSED` permitido a partir de `RUNNING`/`QUEUED`. Terminal é **imutável**; mudança só por
procedimento de reconciliação auditado (`lro_events` registra o motivo).

### 4.3 Tabelas

- `lro_events` — append-only, `(operation_id, seq)` único, payload semântico; base do replay do SSE.
- `lro_outbox` — transação de estado + evento no mesmo commit (padrão já usado em mensageria).
- `lro_feedback_requests` / `lro_feedback_responses` — prazo, destinatário, schema de resposta,
  `version` da operação, ator, autorização, `idempotency_key`, auditoria.

Índices mínimos: `(tenant_id, created_at desc)`, `(status) where status in ('QUEUED','RUNNING')`,
`(lease_expires_at)`, `(operation_id, seq)`.

### 4.4 Entrega

- **Autoridade**: PostgreSQL. Redis Streams, se adotado, é transporte — nunca fonte de verdade.
- **SSE autenticado** com `Last-Event-ID` + replay de `lro_events`; autorização por subscribe/replay;
  heartbeat; limite de buffer. Complementa o WS existente (não o substitui nesta fase).
- **REST** para consultar, decidir, pausar, retomar, cancelar.

---

## 5. Plano incremental (com flag e rollback)

| Fase | Entrega | Flag | Rollback |
|---|---|---|---|
| 1 | Migrations `lro_operations` + `lro_events` + outbox (reversíveis) e testes de contrato do núcleo puro de transições | `LRO_ENABLED` (default **off**) | `migrate:undo` (down escrito) — nenhum código lê a tabela com a flag off |
| 2 | Adaptador QA Waves: espelha `enqueueExecution` para `lro_operations` (dual-write), sem trocar a fonte | `LRO_QA_WAVES_MIRROR` | desligar flag ⇒ volta ao comportamento atual, tabela fica órfã e inofensiva |
| 3 | SSE `/api/lro/:id/events` com replay + UI DEVELOPMENT consumindo; remover dependência de polling | `LRO_SSE` | desligar ⇒ UI volta ao REST |
| 4 | Corte: `lro_operations` passa a ser a fonte; Map vira cache | `LRO_AUTHORITATIVE` | religar flag anterior |
| 5 | Extensão (Mission, Replay, RPA, RAG indexing, importações) — um adaptador por vez | `LRO_<MODULO>` | por módulo |

Regras transversais: nenhuma fase entra sem os testes adversariais correspondentes verdes; nenhuma fase
mexe em política de gate ou classificação.

---

## 6. Matriz mínima de testes adversariais (a implementar)

| # | Cenário do mandato | Onde será provado | Estado |
|---|---|---|---|
| 1 | SSE desconecta/reconecta sem lacunas; cursor inválido e cross-tenant negados | `tests/integration/lroSseReplay.test.js` | a criar |
| 2 | Redis fora, PG reinicia, worker morre entre commit e publicação | `tests/integration/lroOutboxReconciliation.test.js` | a criar |
| 3 | Dois workers disputam lease; token antigo não escreve | `tests/integration/lroLeaseFencing.test.js` | a criar |
| 4 | Resposta humana duplicada/tardia/sem permissão/versão obsoleta | `tests/integration/lroFeedbackAuthorization.test.js` | a criar |
| 5 | Falha ao criar banco descartável aborta antes de qualquer limpeza | `tests/integration/suiteDatabaseIsolation.test.js` (já existe, cobre a porta) | **coberto** |
| 6 | Cancelamento durante ação externa, retomada após crash, heartbeat perdido, DLQ | `tests/integration/lroCancelRecovery.test.js` | a criar |
| 7 | QA Waves com uma API pendente e outras concluídas: UI atualiza já; RPA `processing` não aprova | `frontend/src/pages/QaWavesPage.test.jsx` (falha parcial) | **parcial** (falha parcial coberta em `d92572e35`) |
| 8 | Vínculo defeito→teste→execução verificável, não menção textual | `tests/unit/governance/backfillRegressionTests.test.js` + `required-tests` | parcial |
| 9 | PRODUCTION não vê QA Waves/Replay/steps RPA; SUPPORT só investigação autorizada | `validate:experience-api-segregation`, `validate:visibility-policy` | **existe** (gates) |
| 10 | Carga, backpressure, retenção, volume de eventos, cardinalidade | `tests/stress/lroBackpressure.test.js` | a criar |

---

## 7. Decisões de reuso (não criar mecanismo paralelo)

- **Lease/fencing**: copiar o desenho de `EngineeringTask` (já tem migration, índice e serviço) em vez de
  inventar semântica nova.
- **Outbox**: seguir `outboundQueueService` (gravar tentativa **antes** do efeito externo, backoff com
  jitter, `idempotency_key`).
- **Tempo**: usar `api/utils/operationDeadline.js` e a taxonomia de `timeout-architecture.md`.
- **Entrega**: WS existente continua para push; o log durável + SSE é o que acrescenta replay. Não se
  substitui o WS nesta fase.
- **Segregação**: `visibility_class` + os gates `validate:experience-api-segregation` /
  `validate:visibility-policy` são a autoridade; a UI não decide acesso.

---

## 8. Gates desta missão (estado real, não declarado)

| Gate | Estado |
|---|---|
| `IMPLEMENTATION` | **NOT_RUN** (Fase 0 por desenho) |
| `TESTS` | **NOT_RUN** para LRO; suíte existente verde: frontend 141/1066, L0b 41/41, governance 201/2365 |
| `L0` | ALLOWED (medido) — executado nesta sessão: 41/41 suítes |
| `L1` | ALLOWED (medido) — gates individuais verdes |
| `L2`/`L3` | **BLOCKED** — `L2_L3_EXTENSIVO` DENIED (`INVENTARIO_NAO_ANCORADO`, `FECHAMENTO_SEM_PROVA_VALIDA`) |
| `SECURITY` | `validate:experience-api-segregation` e `validate:visibility-policy` existem; nada alterado |
| `RELEASE_CERTIFICATION` | **BLOCKED** — falta `RAP_RELEASE_ATTESTATION_PRIVATE_KEY` (dono) |

---

## 9. Próximo passo proposto

Fase 1 (contrato + migrations reversíveis + núcleo puro de transições com testes que falham antes da
implementação), atrás de `LRO_ENABLED` desligada. **Nada** de Fase 2+ antes de R1 (trava global entre
tenants) ter teste que reproduza a falha — o defeito já é conhecido e mensurável hoje.
