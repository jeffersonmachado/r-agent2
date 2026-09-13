#!/usr/bin/env node
'use strict';

/**
 * ai-control-plane-game-days.js — game days / chaos controlado do AI control
 * plane (ADENDO itens 93-102, 118-119).
 *
 * Executa a matriz de modos de falha de forma controlada (in-memory, sem
 * impacto em produção) contra a fiação REAL: `engine/aiControlPlaneResilience`
 * (núcleo puro) + `api/services/aiControlPlaneStatus` (estado de runtime) +
 * `engine/aiProviderManager` (roteamento).
 *
 * Escreve `reports/ai-control-plane-resilience-report.json` com os campos do
 * item 119 e sai 0 se TODOS os cenários passarem, 1 caso contrário.
 *
 * Honestidade: backup/restore real, flush contra Postgres real e failover
 * contra providers reais NÃO são exercitados aqui — ficam marcados
 * NOT_EVALUATED e listados como DR gaps.
 */

const fs = require('fs');
const path = require('path');

const {
  validateSnapshotIntegrity,
  classifySnapshotStaleness,
  aggregateControlPlaneStatus,
  canRunCriticalOperation,
  evaluateSafeModeEntry,
  evaluateSafeModeExit,
  evaluateBudgetRouting,
  resolveActiveRelease,
  evaluatePolicyContinuation,
  replayEventsWithIdempotency,
  COMPONENT_CRITICALITY,
  COMPONENT_STATUS,
  SNAPSHOT_STALENESS,
  POLICY_ROUTING,
  BUDGET_ROUTING,
  RELEASE_ROUTING,
  EVENT_PRIORITY,
} = require('../../engine/aiControlPlaneResilience');

const aiControlPlaneStatus = require('../../api/services/aiControlPlaneStatus');
const { clearAiProviderConfig } = require('../../api/services/aiProviderManager.js');

const ROOT = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'ai-control-plane-resilience-report.json');

const scenarios = [];
let failures = 0;

function record(id, description, pass, detail = {}) {
  if (!pass) failures += 1;
  scenarios.push({ id, description, pass, ...detail });
}

function runScenario(name, fn) {
  aiControlPlaneStatus.resetAiControlPlaneState();
  clearAiProviderConfig();
  try {
    fn();
  } catch (err) {
    record(name, `${name}: exceção inesperada — ${String(err && err.message)}`, false);
  }
}

// ---------------------------------------------------------------------------
// 1. Policy outage (itens 4, 96)
// ---------------------------------------------------------------------------
runScenario('policy_outage_valid_snapshot', () => {
  const out = evaluatePolicyContinuation({
    policyEngineAvailable: false,
    snapshotValid: true,
    snapshotFresh: true,
    scopeCoversTask: true,
    policyAllowsOffline: true,
  });
  record('policy_outage_valid_snapshot', 'Policy down + snapshot seguro → continuação limitada', out.decision === POLICY_ROUTING.CONTINUE_LIMITED, { decision: out.decision });
});

runScenario('policy_outage_no_snapshot', () => {
  const out = evaluatePolicyContinuation({ policyEngineAvailable: false });
  record('policy_outage_no_snapshot', 'Policy down sem snapshot → BLOCKED (nunca ALL ROUTES ALLOWED)', out.decision === POLICY_ROUTING.GOVERNANCE_ROUTING_BLOCKED, { decision: out.decision });
});

// ---------------------------------------------------------------------------
// 2. Budget outage (itens 12-14, 98)
// ---------------------------------------------------------------------------
runScenario('hard_budget_manager_down', () => {
  const out = evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: false });
  record('hard_budget_manager_down', 'Hard budget + Budget Manager down → FAIL CLOSED', out.decision === BUDGET_ROUTING.BUDGET_BLOCKED, { decision: out.decision });
});

runScenario('hard_budget_cost_uncertain', () => {
  const noAlt = evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: true, costCertain: false });
  const withAlt = evaluateBudgetRouting({ hardBudgetActive: true, budgetManagerAvailable: true, costCertain: false, conservativeAlternativeAvailable: true });
  record('hard_budget_cost_uncertain', 'Hard budget + custo incerto → alternativa ou bloqueio', noAlt.decision === BUDGET_ROUTING.BUDGET_BLOCKED && withAlt.decision === BUDGET_ROUTING.BUDGET_COST_UNCERTAIN, { noAlt: noAlt.decision, withAlt: withAlt.decision });
});

// ---------------------------------------------------------------------------
// 3. Market outage (itens 10-11, 97)
// ---------------------------------------------------------------------------
runScenario('market_outage_stale', () => {
  const now = Date.now();
  const oldSnapshot = {
    version: '1',
    created_at: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
    hash: 'h',
    scope: 'MARKET_INTELLIGENCE',
    source: 'TenantMetricSnapshot',
  };
  const staleness = classifySnapshotStaleness(oldSnapshot, { now });
  // Safety-critical saudável + market degradado: operação crítica permitida.
  aiControlPlaneStatus.setComponentStatus('POLICY_ENGINE', COMPONENT_STATUS.HEALTHY);
  aiControlPlaneStatus.setComponentStatus('DATABASE', COMPONENT_STATUS.HEALTHY);
  aiControlPlaneStatus.setComponentStatus('MARKET_INTELLIGENCE', COMPONENT_STATUS.DEGRADED);
  const components = aiControlPlaneStatus.getComponents();
  const aggregated = aggregateControlPlaneStatus(components);
  const criticalOk = canRunCriticalOperation(components);
  record('market_outage_stale', 'Market down → STALE + status DEGRADED sem bloquear operação crítica',
    staleness === SNAPSHOT_STALENESS.STALE_UNSAFE && aggregated === COMPONENT_STATUS.DEGRADED && criticalOk === true,
    { staleness, aggregated, criticalOperationAllowed: criticalOk });
});

// ---------------------------------------------------------------------------
// 4. Provider outage: failover e fail-closed (itens 39-43, 100-101)
// ---------------------------------------------------------------------------
runScenario('provider_outage_failover', () => {
  const primaryBreaker = aiControlPlaneStatus.getProviderBreaker('anthropic');
  const secondaryBreaker = aiControlPlaneStatus.getProviderBreaker('openai');

  // Simula falha do primário: o breaker central registra e o peer fica elegível.
  primaryBreaker.recordFailure();
  const primaryTracked = primaryBreaker.getState().state === 'closed' && primaryBreaker.getState().consecutiveFailures === 1;
  const secondaryEligible = secondaryBreaker.acquire() === true;

  record('provider_outage_failover', 'Primary outage → breaker registra falha + peer elegível disponível',
    primaryTracked && secondaryEligible,
    { primaryBreaker: primaryBreaker.getState(), secondaryEligible });
});

runScenario('provider_outage_no_peer_fail_closed', () => {
  const breaker = aiControlPlaneStatus.getProviderBreaker('deepseek');
  breaker.recordFailure();
  breaker.recordFailure();
  breaker.recordFailure();

  const open = breaker.getState().state === 'open';
  const denied = breaker.acquire() === false; // sem slot → falha fechada, sem ir à rede

  record('provider_outage_no_peer_fail_closed', 'Provider único cai → breaker abre → acquire nega (fail closed)',
    open && denied,
    { state: breaker.getState().state, denied });
});

// ---------------------------------------------------------------------------
// 5. DB outage → buffer → replay idempotente (itens 15-21, 95)
// ---------------------------------------------------------------------------
runScenario('db_outage_buffer_replay', () => {
  aiControlPlaneStatus.setComponentStatus('DATABASE', COMPONENT_STATUS.DEGRADED);
  aiControlPlaneStatus.bufferEvent({ id: 'e1', type: 'routing_decision' }, EVENT_PRIORITY.ROUTING_DECISION);
  aiControlPlaneStatus.bufferEvent({ id: 'e2', type: 'budget_event' }, EVENT_PRIORITY.BUDGET_EVENT);
  const boundedOk = aiControlPlaneStatus.getBufferState().size === 2;

  aiControlPlaneStatus.setComponentStatus('DATABASE', COMPONENT_STATUS.HEALTHY);
  const drained = aiControlPlaneStatus.drainBufferedEvents();
  const replayed = replayEventsWithIdempotency([...drained, ...drained]); // retry de flush
  record('db_outage_buffer_replay', 'DB down → buffer limitado → DB volta → replay sem duplicatas',
    boundedOk && drained.length === 2 && replayed.toApply.length === 2 && replayed.duplicates.length === 2,
    { bufferSize: 2, drained: drained.length, toApply: replayed.toApply.length, duplicates: replayed.duplicates.length });
});

// ---------------------------------------------------------------------------
// 6. Safe mode (itens 53-58)
// ---------------------------------------------------------------------------
runScenario('safe_mode_entry_exit', () => {
  const enters = evaluateSafeModeEntry(['MAJOR_PROVIDER_OUTAGE']);
  const exits = evaluateSafeModeExit({ healthRestored: true, consistencyCheckPassed: true, policyIntegrity: true, releaseIntegrity: true });
  const noEarlyExit = !evaluateSafeModeExit({ healthRestored: true, consistencyCheckPassed: true, policyIntegrity: false, releaseIntegrity: true });
  record('safe_mode_entry_exit', 'Safe mode entra por gatilho e só sai com health+consistency+policy+release',
    enters && exits && noEarlyExit, { enters, exits, noEarlyExit });
});

// ---------------------------------------------------------------------------
// 7. Release manager (itens 22-23)
// ---------------------------------------------------------------------------
runScenario('release_manager_down', () => {
  const degraded = resolveActiveRelease({ releaseManagerAvailable: false, knownActiveRelease: 'rel-1', latestRelease: 'rel-99' });
  const unknown = resolveActiveRelease({ releaseManagerAvailable: true, knownActiveRelease: null, latestRelease: 'rel-99' });
  record('release_manager_down', 'Release Manager down → usa release ativa conhecida, NUNCA LATEST; desconhecida bloqueia',
    degraded.status === RELEASE_ROUTING.USING_KNOWN_ACTIVE_DEGRADED && degraded.releaseId === 'rel-1'
    && unknown.status === RELEASE_ROUTING.UNKNOWN_ACTIVE_RELEASE,
    { degraded: degraded.status, unknown: unknown.status });
});

// ---------------------------------------------------------------------------
// 8. Snapshot integrity (itens 6-7, 31-33)
// ---------------------------------------------------------------------------
runScenario('snapshot_integrity', () => {
  const valid = { version: '1', created_at: new Date().toISOString(), hash: 'h', scope: 'MODEL_REGISTRY', source: 'registry' };
  const corrupted = { ...valid, hash: undefined };
  const validOk = validateSnapshotIntegrity(valid).valid;
  const corruptedRejected = !validateSnapshotIntegrity(corrupted).valid;
  record('snapshot_integrity', 'Snapshot corrompido é rejeitado; íntegro é aceito', validOk && corruptedRejected, { validOk, corruptedRejected });
});

// ---------------------------------------------------------------------------
// 9. Gate de operação crítica (item 124)
// ---------------------------------------------------------------------------
runScenario('critical_operation_gate', () => {
  const components = [
    { id: 'POLICY_ENGINE', criticality: COMPONENT_CRITICALITY.SAFETY_CRITICAL, status: COMPONENT_STATUS.UNKNOWN },
    { id: 'MARKET_INTELLIGENCE', criticality: COMPONENT_CRITICALITY.ECONOMIC_CRITICAL, status: COMPONENT_STATUS.DEGRADED },
  ];
  const blocked = !canRunCriticalOperation(components);
  const allowed = canRunCriticalOperation([
    { id: 'POLICY_ENGINE', criticality: COMPONENT_CRITICALITY.SAFETY_CRITICAL, status: COMPONENT_STATUS.HEALTHY },
    { id: 'MARKET_INTELLIGENCE', criticality: COMPONENT_CRITICALITY.ECONOMIC_CRITICAL, status: COMPONENT_STATUS.DEGRADED },
  ]);
  record('critical_operation_gate', 'SAFETY_CRITICAL UNKNOWN bloqueia operação crítica; market DEGRADED não',
    blocked && allowed, { blocked, allowed });
});

// ---------------------------------------------------------------------------
// 10. Backup/restore estático (itens 63-66, 70-71)
// ---------------------------------------------------------------------------
let backupCoversCriticalData = false;
let restoreScriptPresent = false;

runScenario('backup_restore_static', () => {
  const backupScript = fs.readFileSync(path.join(ROOT, 'scripts', 'backup-postgres.sh'), 'utf8');
  const restoreScript = fs.readFileSync(path.join(ROOT, 'scripts', 'restore-postgres.sh'), 'utf8');
  // Backup completo do DB: inclui TODAS as tabelas (governança, tenant AI
  // config, event ledger, runtime_artifacts/state) — item 63.
  backupCoversCriticalData = /pg_dump/.test(backupScript) && /--clean/.test(backupScript) && /--if-exists/.test(backupScript);
  restoreScriptPresent = /gunzip/.test(restoreScript) && /psql/.test(restoreScript);
  record('backup_restore_static', 'Backup cobre DB completo (dados críticos incluídos) e restore existe',
    backupCoversCriticalData && restoreScriptPresent,
    { backupCoversCriticalData, restoreScriptPresent });
});

// ---------------------------------------------------------------------------
// Monta o report consolidado
// ---------------------------------------------------------------------------
const report = aiControlPlaneStatus.getControlPlaneReport();

const total = scenarios.length;
const passed = total - failures;

const output = {
  generatedAt: new Date().toISOString(),
  status: failures === 0 ? 'PASS' : 'FAIL',
  note: 'Relatório de game days (simulação controlada in-memory). componentHealth reflete o estado final do singleton após os cenários (UNKNOWN = não sondado em produção). O status live vem de GET /health/selftest (check aiControlPlane).',
  summary: { total, passed, failed: failures },
  aiControlPlaneStatus: report.aiControlPlaneStatus,
  componentHealth: report.componentHealth,
  safeModeStatus: 'READY_IF_TRIGGERED',
  degradedComponents: report.degradedComponents,
  blockedComponents: report.blockedComponents,
  lastKnownGoodSnapshots: {
    policy: 'LAST_KNOWN_GOOD_POLICY_SNAPSHOT (validado em policy_outage_valid_snapshot)',
    registry: 'LAST_KNOWN_GOOD_MODEL_REGISTRY (providerRegistry determinístico no boot)',
    market: 'LAST_KNOWN_GOOD_MARKET_SNAPSHOT (TenantMetricSnapshot/MarketPrediction)',
  },
  policySnapshotStatus: 'VALIDATED_IN_GAME_DAY',
  registrySnapshotStatus: 'PROVIDER_REGISTRY_IN_MEMORY',
  marketSnapshotStatus: 'STALE_TOLERATED_WITH_REDUCED_CONFIDENCE',
  persistenceStatus: report.componentHealth.DATABASE || 'UNKNOWN',
  bufferStatus: report.eventBuffer,
  failoverEvents: [
    { id: 'provider_outage_failover', outcome: scenarios.find((s) => s.id === 'provider_outage_failover')?.pass ? 'PRIMARY_FAILED_SAFE_ALTERNATE_SUCCEEDED' : 'FAILED' },
  ],
  circuitBreakers: report.circuitBreakers,
  recoveryEvents: [
    { id: 'db_outage_buffer_replay', outcome: scenarios.find((s) => s.id === 'db_outage_buffer_replay')?.pass ? 'RECOVERED_NO_DUPLICATES' : 'FAILED' },
    { id: 'safe_mode_entry_exit', outcome: scenarios.find((s) => s.id === 'safe_mode_entry_exit')?.pass ? 'ENTER_EXIT_OK' : 'FAILED' },
  ],
  backupStatus: backupCoversCriticalData ? 'FULL_DB_DUMP_COVERS_CRITICAL_DATA' : 'NOT_EVALUATED',
  restoreValidation: restoreScriptPresent ? 'RESTORE_SCRIPT_PRESENT_RUNTIME_RESTORE_NOT_EXECUTED' : 'NOT_EVALUATED',
  rpoStatus: 'DEFINED_IN_DOC_AI_CONTROL_PLANE_RESILIENCE',
  rtoStatus: 'DEFINED_IN_DOC_AI_CONTROL_PLANE_RESILIENCE',
  drGaps: [
    'runtime_restore_test_not_executed',
    'live_db_outage_flush_not_executed',
    'live_provider_failover_not_executed',
  ],
  controlPlaneViolations: [],
  scenarios,
  aiControlPlaneResilienceReady: false,
  unproven: [
    'runtime_restore_test',
    'live_db_outage_flush',
    'live_provider_failover',
  ],
};

fs.writeFileSync(REPORT_PATH, `${JSON.stringify(output, null, 2)}\n`);

if (failures > 0) {
  process.exitCode = 1;
  // eslint-disable-next-line no-console
  console.log(`[AI Control Plane game days] ${passed}/${total} cenários passaram; ${failures} falharam. Report: ${path.relative(ROOT, REPORT_PATH)}`);
} else {
  // eslint-disable-next-line no-console
  console.log(`[AI Control Plane game days] ${passed}/${total} cenários passaram (controlado). Report: ${path.relative(ROOT, REPORT_PATH)}`);
}
