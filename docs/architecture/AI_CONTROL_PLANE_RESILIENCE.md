# AI Control Plane — Resiliência, Fail-Safe, Degraded Mode e DR

Documento canônico da camada de resiliência do AI control plane.

Objetivo (não "qualquer missão a qualquer custo"):

```
SAFE CONTINUATION WHEN POSSIBLE
+ SAFE DEGRADATION WHEN NECESSARY
+ FAIL CLOSED WHEN REQUIRED
+ AUDITABLE RECOVERY
```

Falha do control plane **não** pode provocar: `ALLOW ALL`,
`USE WHATEVER MODEL RESPONDS`, `IGNORE POLICY`,
`ASSUME OLD PRICE IS CURRENT`, `DECLARE GO WITHOUT AUDIT`.

## 1. Mapa de componentes (confrontado com a arquitetura real)

| Componente | Onde vive | Criticalidade | Falha pode continuar? | Estratégia |
|---|---|---|---|---|
| Policy Engine (política de acesso/principal/tenant fail-closed) | `src/core/cognitive/principal.js`, `api/middleware/requireClassification.js`, `api/services/tenantAIService.js`, constituição | `SAFETY_CRITICAL` | Só com policy snapshot seguro; caso contrário **block** | Last Known Good snapshot assinado + fresh; senão `GOVERNANCE_ROUTING_BLOCKED` |
| Model Registry (providerRegistry) | `engine/aiProviderManager.js` | `ROUTING_CRITICAL` | Talvez, via snapshot verificado | `LAST_KNOWN_GOOD_MODEL_REGISTRY`; **nunca** promover modelo novo durante degradação |
| Market Intelligence | `api/core/market-intelligence/`, `api/modules/market-intelligence/` | `ECONOMIC_CRITICAL` | Geralmente sim | `LAST_KNOWN_GOOD_MARKET_SNAPSHOT` + `MARKET_INTELLIGENCE_STATUS=STALE`; reduz `ECONOMIC_CONFIDENCE`, não `MODEL_QUALITY` |
| Budget Manager | `api/services/billingService.js`, limites de tenant | `ECONOMIC_CRITICAL` | Não para gasto incerto com hard cap | Fail closed p/ novas ações pagas incertas; soft budget → `BUDGET_STATUS=UNKNOWN/DEGRADED` conservador |
| Release Manager | `tools/system/release-manifest.js`, `release-gate.js` | `ROUTING_CRITICAL` | Não para missão crítica com release ativa desconhecida | `CURRENT_KNOWN_ACTIVE_RELEASE`; `UNKNOWN_ACTIVE_RELEASE` bloqueia missão de risco |
| Database | Postgres (Sequelize) | `SAFETY_CRITICAL` | Decisões podem continuar; telemetria via buffer | `PERSISTENCE_DEGRADED_MODE` + buffer limitado |
| Observability | `selftestService.js`, `systemStatusService.js`, `eventLedger` | `OBSERVABILITY_CRITICAL` | Parcialmente | `AI_OBSERVABILITY_STATUS=DEGRADED`; tarefa crítica não-auditável → `CRITICAL_OBSERVABILITY_REQUIRED` |
| Benchmark Service | `qa-mesh`, waves | `OPTIONAL` | Sim p/ modelos homologados | Bloquear apenas novas qualificações/rehomologação |

SPOFs relevantes e mitigação:

- **providerRegistry em memória** (`engine/aiProviderManager.js`): SPOF de roteamento. Mitigação: registro de providers é determinístico no boot; ausência ⇒ `MODEL_REGISTRY=BLOCKED` e `generateAiResponse` falha fechado (nunca "qualquer modelo").
- **Credenciais no DB** (`tenantAIService.getDecryptedAPIKey`): SPOF econômico/segurança. Mitigação: `AI_PROVIDER_NOT_CONFIGURED` explícito; **proibido** fallback para secret em arquivo local (itens 48-50).
- **Provider único por tenant**: mitigação via `fallbacks.aiProviderSecondary` (failover governado, nunca para provider proibido — itens 44-45).

## 2. Estados operacionais

```
AI_CONTROL_PLANE_STATUS ∈ HEALTHY | DEGRADED | SAFE_MODE | RECOVERING | BLOCKED | UNKNOWN
```

Por componente: `POLICY_ENGINE`, `MODEL_REGISTRY`, `MARKET_INTELLIGENCE`,
`BUDGET_MANAGER`, `RELEASE_MANAGER`, `DATABASE`, `OBSERVABILITY`,
`BENCHMARK_SERVICE`.

Agregação (item 112): `BLOCKED` safety-critical > `SAFE_MODE` > `DEGRADED` >
`RECOVERING` > `UNKNOWN` > `HEALTHY`. Componente `OPTIONAL` nunca derruba
sozinho além de `DEGRADED`.

Gate de operação crítica (`canRunCriticalOperation`, item 124): componente
`SAFETY_CRITICAL` em `BLOCKED` **ou** `UNKNOWN` impede operação crítica.
`MARKET_INTELLIGENCE=DEGRADED` não impede; `POLICY_ENFORCEMENT=UNKNOWN` impede.

## 3. Implementação

- Núcleo puro/determinístico: `engine/aiControlPlaneResilience.js`
  (`createCircuitBreaker`, `classifyProviderError`, `createBoundedEventBuffer`,
  `validateSnapshotIntegrity`, `classifySnapshotStaleness`,
  `aggregateControlPlaneStatus`, `canRunCriticalOperation`,
  `evaluateSafeModeEntry`, `evaluateSafeModeExit`,
  `evaluateBudgetRouting`, `resolveActiveRelease`, `evaluatePolicyContinuation`,
  `dedupeEventsByKey`, `replayEventsWithIdempotency`).
- Estado de runtime (singleton): `api/services/aiControlPlaneStatus.js`
  (status por componente, circuit breakers por provider, buffer de eventos,
  `getControlPlaneReport()`).
- Integração: `api/services/aiProviderService.js` registra os providers
  envoltos no circuit breaker central de cada provider; marca
  `MODEL_REGISTRY` no boot. `api/modules/market-intelligence/` marca
  `MARKET_INTELLIGENCE` HEALTHY/DEGRADED conforme o resultado real da rota.
- Observabilidade: `api/services/selftestService.js` expõe o check
  `aiControlPlane` (deriva `DATABASE`/`OBSERVABILITY` dos sinais existentes e
  reporta o status por componente).
- Game days (itens 93-102): `npm run validate:ai-control-plane-resilience`
  executa `scripts/governance/ai-control-plane-game-days.js` — a matriz de
  modos de falha de forma controlada (in-memory, sem produção) contra a
  fiação real e grava `reports/ai-control-plane-resilience-report.json`
  (campos do item 119). Backup/restore real e flush/failover contra ambiente
  vivo ficam `NOT_EVALUATED` e listados como DR gaps.

## 4. Circuit breaker (itens 39-43)

- Estado `CLOSED → OPEN → HALF-OPEN → CLOSED` com **probation de recuperação**
  (só fecha após N probes com sucesso consecutivos; não volta tudo após um
  único sucesso).
- Central por provider (`wrapProviderGenerate`): estado compartilhado evita
  retry storm quando a falha é provider-wide.
- Retry NUNCA para: credencial inválida, policy denial, modelo aposentado,
  hard budget block (`classifyProviderError`).

## 5. Buffer de eventos (itens 17-19)

- Limitado (`AI_CP_BUFFER_MAX_ENTRIES`, default 1000) e priorizado: policy
  violations > model access failures > attribution > routing > budget >
  critical audit > telemetry.
- Descartar evento crítico incrementa `droppedCritical` ⇒
  `AUDIT_DATA_LOSS_RISK` (pode impedir GO). Nunca unbounded.

## 6. Snapshots (itens 6-11, 31-33)

- Validação estrutural (`validateSnapshotIntegrity`): exige
  `version`, `created_at`, `hash`, `scope`, `source`; rejeita corrompido.
- Staleness (`classifySnapshotStaleness`): `FRESH | STALE_ACCEPTABLE |
  STALE_UNSAFE | UNKNOWN`; expiração explícita vence sobre janelas de idade.
- Market data stale ⇒ reduz `ECONOMIC_CONFIDENCE`, não `MODEL_QUALITY`;
  hard budget + preço incerto ⇒ `BUDGET_COST_UNCERTAIN` ⇒ alternativa ou
  bloqueio de escalonamento caro.

## 7. Safe mode (itens 53-58)

- Gatilhos: `POLICY_ENGINE_INSTABILITY`, `REGISTRY_CORRUPTION`,
  `MAJOR_PROVIDER_OUTAGE`, `RELEASE_INTEGRITY_FAILURE`, `DATABASE_INCIDENT`,
  `MULTIPLE_CONTROL_PLANE_FAILURES`.
- Rotas pré-homologadas (`KNOWN_GOOD`, `HOMOLOGATED`, `POLICY_ALLOWED`,
  `LOW_RISK`); **não** descobrir rotas novas durante incidente.
- Saída exige: health restored + consistency + policy integrity + release
  integrity (não basta um componente responder uma vez).

## 7.1 Budget routing (itens 12-14)

`evaluateBudgetRouting` decide ação paga sob hard/soft budget:

- soft budget → `PROCEED` com `budgetStatus` UNKNOWN/DEGRADED;
- hard budget + Budget Manager indisponível → `BUDGET_BLOCKED` (fail closed,
  nunca orçamento infinito);
- hard budget + custo incerto → `BUDGET_COST_UNCERTAIN` (alternativa
  conservadora) ou `BUDGET_BLOCKED` (sem alternativa).

## 7.2 Active release (itens 22-23)

`resolveActiveRelease` nunca seleciona `LATEST` quando o Release Manager está
indisponível:

- manager ok + release ativa conhecida → `CURRENT_KNOWN_ACTIVE_RELEASE`;
- manager down + release ativa conhecida → `USING_KNOWN_ACTIVE_DEGRADED`;
- release ativa indeterminável → `UNKNOWN_ACTIVE_RELEASE` (bloqueia missão de
  risco).

## 7.3 Recovery idempotente (itens 20-21, 85-86)

`dedupeEventsByKey` e `replayEventsWithIdempotency` protegem contra retry de
flush: eventos já vistos (por chave) são classificados como duplicatas e não
reaplicados — recovery não duplica execução/custo/audit. Evento sem chave não
é descartado silenciosamente (sem correlação, aplica e registra).

## 7.4 Policy outage (itens 4, 96)

`evaluatePolicyContinuation` nunca assume ALL ROUTES ALLOWED quando o Policy
Engine está indisponível. Usa `LAST_KNOWN_GOOD_POLICY_SNAPSHOT` (continuação
limitada) apenas se: snapshot válido + fresh dentro da janela permitida +
escopo da tarefa coberto + offline permitido. Caso contrário:
`GOVERNANCE_ROUTING_BLOCKED`.

## 8. DR / RPO / RTO (itens 59-75)

- RPO por tipo de dado: auditoria crítica ⇒ tolerância próxima de zero;
  métricas agregadas ⇒ tolerância maior. Valores concretos dependem do
  ambiente de produção (não inventados aqui).
- Restore test obrigatório: backup → restore → registry disponível →
  policies disponíveis → release identificável → histórico de auditoria
  disponível. Backup sem restore test não é garantia.
- **Procedimento de restore test** (item 64, ambiente controlado — nunca
  produção): (1) `scripts/backup-postgres.sh` gera dump completo; (2)
  `scripts/restore-postgres.sh` restaura em Postgres efêmero; (3) validar
  `providerRegistry` disponível (boot sem erros de registry), (4) policies
  disponíveis (`tenantAIService`/configuração de tenant), (5) release
  identificável (`qa/release-manifest.json`), (6) histórico de auditoria
  disponível (`event_ledger`/`runtime_artifacts`). O harness de game days
  valida estaticamente que o backup cobre o DB completo e que o restore
  existe; o restore em runtime continua `NOT_EXECUTED` até rodar em ambiente
  controlado.
- **Drill de persistência real** (itens 15-16, 20-21): `npm run
  drill:ai-control-plane-persistence` valida, contra o Postgres real,
  write → integridade SHA-256 → reescrita idempotente (sem duplicar) →
  leitura fiel → cleanup (`reports/ai-control-plane-persistence-drill.json`).
  Pula com exit 0 se o DB estiver indisponível.
- **Drill de restore em Postgres efêmero** (itens 64, 68-73): `npm run
  drill:ai-control-plane-restore` cria um database temporário
  (`r_agent2_dr_drill_<ts>`), faz `pg_dump` do banco real (excluindo o DATA
  das 6 tabelas grandes — `event_ledger`, `vertical_engagement_signals`,
  `node_executions`, `pbx_config_versions`, `execution_jobs`,
  `flow_executions`; o backup real de produção NÃO exclui), restaura no
  temporário, verifica as 4 camadas com **Sequelize** (registry: 2 settings +
  2 credenciais; policy: 73 decisões; release: 14.704 artefatos; audit:
  `event_ledger` presente) e DROP o temporário
  (`reports/ai-control-plane-restore-drill.json`, `sourceAuditRows` registra a
  contagem real de auditoria). Credenciais vêm de `config.getDatabaseUrl()` —
  nunca há prompt de senha.
- Recuperação parcial ⇒ `AI_CONTROL_PLANE_PARTIALLY_RESTORED` (nunca READY).
- Ordem conceitual de recuperação: DATABASE → POLICY → RELEASE → REGISTRY →
  ROUTER → OBSERVABILITY → MARKET REFRESH. Market data restaurada deve ser
  refrescada antes de decisões economicamente relevantes.

## 9. Violações críticas (impedem `AUTONOMOUS_READY_GO`)

`POLICY_FAILURE_FAILS_OPEN`, `HARD_BUDGET_FAILURE_ASSUMES_UNLIMITED_BUDGET`,
`UNKNOWN_RELEASE_AUTO_EXECUTED`, `CORRUPTED_SNAPSHOT_ACCEPTED`,
`UNBOUNDED_EVENT_BUFFER`, `CRITICAL_AUDIT_EVENT_SILENTLY_LOST`,
`RECOVERY_DUPLICATES_SIDE_EFFECTS`, `SAFE_MODE_BYPASSED`,
`STALE_POLICY_USED_OUTSIDE_ALLOWED_WINDOW`,
`BACKUP_DECLARED_VALID_WITHOUT_RESTORE_EVIDENCE`,
`CONTROL_PLANE_FAILURE_DECLARED_HEALTHY`.

## 10. Critério de declaração

`AI_CONTROL_PLANE_RESILIENCE_READY` só quando comprovado (com teste) que:
policy failure é segura, hard budget failure é segura, model registry failure
é segura, market failure degrada com segurança, provider outage faz failover,
event buffer é limitado, recovery é idempotente, active release é recuperável,
safe mode funciona, backup/restore é verificado e o status do control plane é
observável — com zero gaps críticos de fail-open.
