'use strict';

/**
 * securityIntelWorker — monitoramento CONTÍNUO da inteligência de segurança.
 *
 * Motivo de existir: a capacidade não pode depender de alguém lembrar de rodar o
 * CLI. Uma CVE recém-publicada afeta componentes JÁ instalados, sem nenhuma
 * mudança de código — se nada reavaliar, a plataforma fica desatualizada em
 * silêncio.
 *
 * Cadência do ciclo (tudo OFFLINE por padrão):
 *   1. (opcional, opt-in) sincronizar a base de advisories se estiver vencida;
 *   2. reexecutar a correlação inventário × advisories;
 *   3. regenerar o plano de correção;
 *   4. escalar se surgir achado KEV/CRITICAL/HIGH novo.
 *
 * O passo 1 toca a internet: só roda com `SECURITY_INTEL_SYNC_ADVISORIES=1` e
 * respeitando a política de idade/rate limit. Por padrão o worker mantém a
 * correlação fresca — que é o que muda estado — sem sair para a rede.
 *
 * Falha do worker é VISÍVEL (health DOWN + log de erro), nunca um aviso mudo:
 * um monitor que não roda é indistinguível de um monitor que não encontra nada.
 *
 * Escalonamento usa o modelo de alerta canônico do RAP: evento auditável na
 * própria trilha (`security_finding_events`, escrito pelo scan) + log
 * estruturado + relatórios renovados (que os gates consomem). A integração com
 * o Event Ledger fica pendente de fixar o contrato — não se inventa API.
 */

const logger = require('../../utils/logger');
const { loadPolicy } = require('./vulnerabilityScanService');

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

const state = {
  running: false,
  timer: null,
  startedAt: null,
  cycles: 0,
  consecutiveErrors: 0,
  lastRunAt: null,
  lastDurationMs: null,
  lastError: null,
  lastSummary: null,
  lastEscalation: null,
  intervalMs: null,
};

function isEnabled(env = process.env) {
  return env.ENABLE_SECURITY_INTEL_WORKER !== 'false';
}

function resolveIntervalMs(env = process.env) {
  const parsed = parseInt(env.SECURITY_INTEL_WORKER_INTERVAL_MS || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(parsed, MIN_INTERVAL_MS);
}

function shouldSyncAdvisories(env = process.env) {
  // Egress é opt-in explícito: o worker nunca fala com a internet por padrão.
  return String(env.SECURITY_INTEL_SYNC_ADVISORIES || '') === '1';
}

/** Conta achados que exigem atenção imediata (KEV ou CRITICAL/HIGH). */
function countEscalations(scanReport) {
  const bySeverity = scanReport?.bySeverity || {};
  return {
    kev: scanReport?.kevFindings || 0,
    critical: bySeverity.CRITICAL || 0,
    high: bySeverity.HIGH || 0,
    underInvestigation: bySeverity.UNDER_INVESTIGATION || 0,
  };
}

/** Executa UM ciclo. Exportado para teste — não agenda nada por si só. */
async function runCycle({ tenantKey = 'system', env = process.env } = {}) {
  const startedAt = Date.now();
  const policy = loadPolicy({ reload: true });
  const summary = { sync: null, scan: null, plans: null, escalation: null };

  // 1) Base de advisories (opt-in; só se vencida).
  if (shouldSyncAdvisories(env)) {
    const { listDistinctPackages } = require('./inventoryStoreService');
    const { syncAdvisories } = require('./vulnerabilityScanService');
    const latestSyncAge = await getLatestAdvisorySyncAge();
    const staleAfter = policy.advisorySources?.osv?.maxAgeHoursBeforeStale ?? 72;
    if (latestSyncAge === null || latestSyncAge > staleAfter) {
      const packages = await listDistinctPackages({ tenantKey, scope: 'direct' });
      const result = await syncAdvisories({
        packages,
        tenantKey,
        actor: 'security-intel-worker',
        options: { rateLimitPerSecond: 4 },
      });
      summary.sync = { packages: packages.length, advisories: result.stats.advisories, failures: result.failures.length };
    } else {
      summary.sync = { skipped: true, ageHours: Math.round(latestSyncAge * 100) / 100 };
    }
  }

  // 2) Correção inventário × advisories (offline, idempotente).
  const { scanComponents } = require('./vulnerabilityScanService');
  const scan = await scanComponents({ tenantKey, scope: 'installed', actor: 'security-intel-worker' });
  summary.scan = {
    components: scan.componentsScanned,
    findings: scan.findings,
    events: scan.events,
    resolved: scan.resolved,
    kev: scan.kevFindings,
    advisoryBaseStale: scan.advisoryBaseStale,
  };

  // 3) Plano de correção renovado.
  const { generatePatchPlans } = require('./patchPlanService');
  const plans = await generatePatchPlans({ tenantKey });
  summary.plans = { candidates: plans.candidates, withoutPatch: plans.summary.withoutPatch, requiringHumanApproval: plans.summary.requiringHumanApproval };

  // 4) Escalonamento: novo achado KEV/CRITICAL/HIGH, ou eventos novos em geral.
  const escalation = countEscalations(scan);
  summary.escalation = escalation;
  const newRiskEvents = scan.events > 0;
  if (newRiskEvents && (escalation.kev > 0 || escalation.critical > 0 || escalation.high > 0)) {
    logger.error('[securityIntelWorker] achados de risco exigem atenção', {
      tenantKey,
      kev: escalation.kev,
      critical: escalation.critical,
      high: escalation.high,
      newEvents: scan.events,
      advisoryBaseStale: scan.advisoryBaseStale,
      patchCandidates: plans.candidates,
    });
    state.lastEscalation = { at: new Date().toISOString(), ...escalation, newEvents: scan.events };
  }

  return { durationMs: Date.now() - startedAt, summary };
}

/** Idade (em horas) da última sincronização de advisories, ou null. */
async function getLatestAdvisorySyncAge() {
  const { connect, getSequelize } = require('../../db/sequelize');
  const getSecurityAdvisorySync = require('../../db/models/SecurityAdvisorySync');
  if (!getSequelize()) await connect(3, 500);
  const Sync = getSecurityAdvisorySync();
  const row = await Sync.findOne({ where: { source: 'osv' }, order: [['started_at', 'DESC']], raw: true });
  if (!row) return null;
  return (Date.now() - new Date(row.finished_at || row.started_at).getTime()) / 3600000;
}

async function tick({ tenantKey, env }) {
  if (!state.running) return;
  try {
    const result = await runCycle({ tenantKey, env });
    state.cycles += 1;
    state.consecutiveErrors = 0;
    state.lastRunAt = new Date().toISOString();
    state.lastDurationMs = result.durationMs;
    state.lastSummary = result.summary;
    state.lastError = null;
    logger.info('[securityIntelWorker] ciclo concluído', { durationMs: result.durationMs, ...result.summary.scan });
  } catch (error) {
    state.consecutiveErrors += 1;
    state.lastError = error.message;
    logger.error('[securityIntelWorker] ciclo FALHOU', {
      error: error.message,
      consecutiveErrors: state.consecutiveErrors,
      code: error.code || null,
    });
  } finally {
    if (state.running) {
      state.timer = setTimeout(() => tick({ tenantKey, env }), state.intervalMs);
      if (typeof state.timer.unref === 'function') state.timer.unref();
    }
  }
}

/**
 * Inicia o worker (cadeia de `setTimeout`, nunca `setInterval`: o próximo ciclo
 * só é agendado depois que o anterior termina, então dois ciclos não se
 * sobrepõem por construção).
 */
function startSecurityIntelWorker({ intervalMs, tenantKey = 'system', env = process.env, runImmediately = false } = {}) {
  if (state.running) return { started: false, reason: 'already_running' };
  if (!isEnabled(env)) return { started: false, reason: 'disabled_by_env' };
  state.intervalMs = intervalMs || resolveIntervalMs(env);
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.cycles = 0;
  state.consecutiveErrors = 0;
  logger.info('[securityIntelWorker] iniciado', { intervalMs: state.intervalMs, tenantKey, syncAdvisories: shouldSyncAdvisories(env) });
  if (runImmediately) {
    state.timer = setTimeout(() => tick({ tenantKey, env }), 0);
    if (typeof state.timer.unref === 'function') state.timer.unref();
  } else {
    state.timer = setTimeout(() => tick({ tenantKey, env }), state.intervalMs);
    if (typeof state.timer.unref === 'function') state.timer.unref();
  }
  return { started: true, intervalMs: state.intervalMs };
}

function stopSecurityIntelWorker() {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.running = false;
  logger.info('[securityIntelWorker] parado', { cycles: state.cycles });
  return { stopped: true, cycles: state.cycles };
}

/**
 * Saúde do worker. `DOWN` quando nunca subiu ou quando erra repetidamente —
 * visível de propósito: um monitor parado não pode parecer saudável.
 */
function getSecurityIntelWorkerStatus() {
  let health = 'UP';
  let code = null;
  if (!state.running) {
    health = 'DOWN';
    code = state.startedAt ? 'worker_stopped' : 'worker_not_started';
  } else if (state.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    health = 'DEGRADED';
    code = 'consecutive_cycle_failures';
  }
  return {
    health,
    code,
    running: state.running,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt,
    cycles: state.cycles,
    consecutiveErrors: state.consecutiveErrors,
    lastRunAt: state.lastRunAt,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError,
    lastSummary: state.lastSummary,
    lastEscalation: state.lastEscalation,
    syncAdvisoriesEnabled: shouldSyncAdvisories(),
  };
}

/** Reset de estado — usado por teste; nunca em produção. */
function _resetSecurityIntelWorkerState() {
  if (state.timer) clearTimeout(state.timer);
  Object.assign(state, {
    running: false,
    timer: null,
    startedAt: null,
    cycles: 0,
    consecutiveErrors: 0,
    lastRunAt: null,
    lastDurationMs: null,
    lastError: null,
    lastSummary: null,
    lastEscalation: null,
    intervalMs: null,
  });
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  MAX_CONSECUTIVE_ERRORS,
  isEnabled,
  resolveIntervalMs,
  shouldSyncAdvisories,
  countEscalations,
  runCycle,
  startSecurityIntelWorker,
  stopSecurityIntelWorker,
  getSecurityIntelWorkerStatus,
  _resetSecurityIntelWorkerState,
};
