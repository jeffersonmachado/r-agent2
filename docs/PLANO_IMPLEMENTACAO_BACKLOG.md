 # Plano de implementacao do backlog (execucao tecnica)
 
 Este documento detalha entregas, dependencias e criterios de pronto
 para o backlog descrito em `docs/O_QUE_FALTA.md`.
 
 ---
 
## 1) Now (0-3 meses) — hardening v1 vendavel

### 1.1 Execution ledger + replay (2.1)
- **Entregas minimas**
  - Instrumentar runtime para registrar execucoes reais do DAG em
    `flow_executions` e `node_executions`.
  - Endpoints de consulta com RBAC por `execution_id`,
    `correlation_id` e `subject_id`.
  - Replay parcial "from node" com controles (flag de ambiente,
    allowlist de tenants e trilha auditavel).
- **Dependencias**
  - `api/services/flowExecutionLedgerService.js`
  - `api/db/migrations/20260204031000-create-flow-execution-ledger.js`
  - Engine/runner do DAG (ponto de integracao a definir).
- **Criterio de pronto**
  - "O que aconteceu em qual node" consultavel e replay controlado
    com rastreabilidade por tenant.

### 1.2 Queue/Scheduler enterprise minimo (2.2)
- **Entregas minimas**
  - Quotas por tenant (concorrencia e jobs/min).
  - DLQ consultavel e reprocessavel com auditoria.
  - Metricas de lag, falha e retries + selftest WARN/FAIL por limiar.
- **Dependencias**
  - `api/services/executionQueueService.js`
  - `api/services/schedulerService.js`
  - `api/services/opsSlaService.js`
  - `scripts/system-autotest-stack.sh`
- **Criterio de pronto**
  - Operacao estavel sob carga, com visibilidade de gargalos e DLQ.

### 1.3 Event ledger -> runtime (2.3)
- **Entregas minimas**
  - Consumer/dispatcher de `event_ledger` para acionar execucoes.
  - Idempotencia, retry/backoff e DLQ integrados.
- **Dependencias**
  - `api/services/eventLedgerTriggerDispatcher.js`
  - `api/services/flowEventTriggerService.js`

### 1.4 Omnichannel conversa <-> ticket (2.4)
- **Entregas minimas**
  - Persistencia e idempotencia ponta a ponta.
  - Status por mensagem visivel na operacao.

### 1.5 PBX call events v0 (2.5)
- **Entregas minimas**
  - Contrato `ringing/answered/ended` no `event_ledger`.
  - Correlacao com ticket/pedido quando aplicavel.
- **Dependencias**
  - `api/services/pbx/pbxCallEventsService.js`

### 1.6 Fast service v1 vendavel (2.6)
- **Entregas minimas**
  - Auditoria consultavel por estacao/unidade/servico.
  - Metricas completas (abandono, produtividade por estacao).
  - Estados e transicoes definidos (waiting/called/in_service/done/abandoned)
    com idempotencia.
- **Dependencias**
  - Rotas `api/physical/*` e modelos de fila fisica.
  - `api/services/opsSlaService.js` (para alertas de operacao).

### 1.7 Orders/Delivery v1 vendavel (2.7)
- **Entregas minimas**
  - KPIs `order_to_ready` e `order_to_deliver` com alertas.
  - Incidente 1:1 com pedido, idempotencia e status consistente.
- **Dependencias**
  - Rotas `POST /storefront/orders`, `GET /api/orders/metrics`,
    `POST /orders/:id/incidents`.

### 1.8 Tokens publicos (2.8)
- **Entregas minimas**
  - Endpoints admin para listar/revogar/rotacionar tokens
    com auditoria.
  - Rate-limit por token/kind e dashboard minimo de uso.
- **Dependencias**
  - `api/services/publicAccessTokenService.js`
  - migration `api/db/migrations/20260204030000-public-access-tokens-lifecycle.js`

### 1.9 RPA Flow Pipeline v1.1 (2.9)
- **Entregas minimas**
  - Playbooks de uso e rollback.
  - E2E e validacoes de seguranca para seeds/conversoes.
  - Observabilidade (logs, metricas, auditoria).
- **Dependencias**
  - `api/services/rpaFlowPipelineService.js`

### 1.10 Autoprovisionamento v1 (2.10)
- **Entregas minimas**
  - Relatorio padronizado e logs operacionais.
  - Opcoes por suite e por unidade (location).
  - Gates de seguranca e auditoria.
- **Dependencias**
  - `api/services/oneClickBootstrapService.js`

### 1.11 PBX provisioning v1.1 (2.11)
- **Entregas minimas**
  - Templates por vendor/model/firmware.
  - Parametros operacionais (codecs, TLS/SRTP, NTP, timezone, BLF,
    MWI, voicemail).
  - Rotacao/expiracao de token e trilha auditavel.
  - Bulk provisioning e sanity checks.
- **Dependencias**
  - `docs/PBX_PROVISIONING_GRANDSTREAM_AVAYA.md`
  - Rotas `POST /api/pbx/extensions` e `GET /provision/...`
 
 ---
 
## 2) Next (3-6 meses) — produto inicial por suite

### 2.1 Omnichannel v1 (2.12)
- **Entregas minimas**
  - Roteamento/skills basicos e SLA simples.
  - Historico unificado e auditoria operacional.

### 2.2 Marketing v1 (2.13)
- **Entregas minimas**
  - UI/admin completa.
  - Jornadas e funil basico.
  - Refinamento de scoring v1.

### 2.3 Templates solutions por segmento (2.14)
- **Entregas minimas**
  - Pacotes E2E (fastfood/pizzaria/clinica) com operacao e
    metricas minimas.

## 3) Next (6-12 meses) — consolidacao core + PBX/voz v1

### 3.1 Core DAG + event model (2.15)
- **Entregas minimas**
  - Triggers/handlers full-fidelity do `event_ledger` para o runtime.
  - Retencao por tenant e custo previsivel por execucao.

### 3.2 PBX + voz v1 (2.16)
- **Entregas minimas**
  - URA visual v1, filas de voz e gravacao com trilha auditavel.
  - Observabilidade de voz (CDR/eventos) e custos basicos.

### 3.3 Marketing v1 completo (2.17)
- **Entregas minimas**
  - Funil v1 e bases para atribuicao/ROI.
  - Templates de campanhas e jornadas v1 refinadas.
 
 ---
 
## 4) Later/Longo (12-60 meses)
 - SDK/marketplace de nodes com governanca (perms, versionamento,
   assinatura).
 - Analytics/ROI completo e voz v1 no DAG (ARI/AMI, URA visual, filas,
   gravacao, click-to-call).
 - Enterprise: SSO/SCIM, ambientes dev/stage/prod, HA/DR, auditoria
   imutavel, programa de parceiros.
 
 ---
 
 ## 4) Gates e DoD (criterios de pronto)
 - `scripts/system-autotest-stack.sh` deve cobrir:
   - token publico -> pedido -> transicoes -> status publico
   - token publico -> kiosk cria ticket -> station opera -> panel reflete
   - `/health/selftest` retorna PASS/WARN
 - `tools/system/validate.js` passa (contratos + QA completa).
 - `scripts/autotest.js` com veredito GO.
 - DoD minimo:
   - ledger por node + replay auditavel
   - queue/scheduler com quotas + DLQ + metricas + selftest
   - suites vendaveis com estados/idempotencia/auditoria
