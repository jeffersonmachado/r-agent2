'use strict';

/**
 * api/services/engineeringMission/missionRecoveryCoordinator.js
 *
 * RECOVERY AUTOMÁTICO (§7, §8, §22) — o requisito é:
 *
 *   crash → processo morre → aplicação reinicia → recovery AUTOMÁTICO → missões incompletas são
 *   descobertas → lease é adquirido → execução continua do ponto seguro.
 *
 * Achado real da auditoria V2: a retomada existia, mas só acontecia quando alguém chamava
 * `POST /engineering/missions/resume-interrupted`. O endpoint continua existindo como ferramenta
 * OPERACIONAL, porém não pode ser requisito para o recovery normal — nenhum boot do sistema
 * chamava o orquestrador. Este coordenador fecha isso: varredura no boot + varredura periódica,
 * sem ação humana.
 *
 * Regras que ele respeita:
 *   - só retoma estados RETOMÁVEIS (`RESUMABLE_MISSION_STATES`): missão aguardando aprovação ou
 *     bloqueada espera decisão que não é do coordenador;
 *   - adquire LEASE antes de tocar em qualquer missão (dois processos subindo juntos nunca
 *     trabalham a mesma missão — o perdedor é registrado, não silenciado);
 *   - retoma a TASK, não apenas o status da missão (§8): quem continua o loop é o Router durável
 *     (`runTask`), que já sabe retomar de qualquer fase;
 *   - NUNCA aprova, nunca relaxa gate: a spec aprovada é validada (`assertMissionExecutable`);
 *   - é idempotente: rodar duas vezes seguidas não duplica task, versão, aprovação nem efeito.
 */

const os = require('os');
const crypto = require('crypto');
const { RESUMABLE_MISSION_STATES } = require('../../../engine/engineeringMission/constants');
const missionStore = require('./missionStoreService');
const approvalService = require('./missionApprovalService');
const compiler = require('./missionCompilerService');
const { emitMissionStage } = require('./missionEvents');
const logger = require('../../utils/logger');

const DEFAULT_SWEEP_INTERVAL_MS = Number(process.env.ENGINEERING_MISSION_RECOVERY_INTERVAL_MS || 5 * 60 * 1000);
const DEFAULT_LIMIT = Number(process.env.ENGINEERING_MISSION_RECOVERY_LIMIT || 25);

let sweepTimer = null;
let sweeping = false;
let lastSweep = null;

/** Identidade estável desta instância (o PID é só um detalhe local, nunca a identidade). */
const INSTANCE_ID = process.env.ENGINEERING_MISSION_WORKER_INSTANCE_ID
  || `recovery-${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`;

function recoveryEnabled() {
  const flag = process.env.ENGINEERING_MISSION_RECOVERY_ENABLED;
  if (flag === '0' || flag === 'false') return false;
  if (flag === '1' || flag === 'true') return true;
  return process.env.NODE_ENV !== 'test';
}

/**
 * Classifica o trabalho a ser retomado. Puro o bastante para ser testado sem banco: recebe as
 * linhas e devolve o plano (o que fazer com cada missão e por quê).
 */
function planRecovery(missions) {
  const plan = [];
  for (const mission of missions) {
    if (!RESUMABLE_MISSION_STATES.includes(mission.status)) {
      plan.push({ missionId: mission.id, status: mission.status, action: 'SKIP', reason: 'STATUS_NOT_RESUMABLE' });
      continue;
    }
    if (mission.status === 'CREATED' || mission.status === 'ENRICHING') {
      plan.push({ missionId: mission.id, status: mission.status, action: 'RE_ENRICH', reason: 'ENRICHMENT_INCOMPLETE' });
      continue;
    }
    if (mission.status === 'APPROVED' && !mission.linked_task_id) {
      plan.push({ missionId: mission.id, status: mission.status, action: 'START_EXECUTION', reason: 'APPROVED_WITHOUT_TASK' });
      continue;
    }
    // APPROVED com task ou EXECUTING: quem continua é o Router durável, sobre a task existente.
    plan.push({ missionId: mission.id, status: mission.status, action: 'RESUME_TASK', reason: mission.status === 'EXECUTING' ? 'EXECUTION_INTERRUPTED' : 'APPROVED_TASK_PENDING' });
  }
  return plan;
}

/**
 * Uma varredura completa. Retorna um resumo auditável — inclusive do que NÃO foi retomado e por quê
 * (nunca "sumiu do relatório").
 */
async function sweep({ tenantId = 'system', limit = DEFAULT_LIMIT, workerInstanceId = INSTANCE_ID, host = os.hostname(), autoStart = true } = {}) {
  const expired = await missionStore.findMissionsWithExpiredLease({ limit });
  const neverLeased = await missionStore.findMissionsWithoutLease({ limit });
  const byId = new Map();
  for (const mission of [...expired, ...neverLeased]) byId.set(mission.id, mission);
  const candidates = [...byId.values()];

  const summary = {
    workerInstanceId,
    host,
    scanned: candidates.length,
    recovered: 0,
    skippedLeaseHeld: 0,
    skippedNotResumable: 0,
    failed: 0,
    items: [],
    startedAt: new Date().toISOString(),
  };

  const plan = planRecovery(candidates);
  for (const step of plan) {
    if (step.action === 'SKIP') {
      summary.skippedNotResumable += 1;
      summary.items.push(step);
      continue;
    }

    const acquired = await missionStore.acquireMissionLease(step.missionId, {
      workerInstanceId, workerType: 'RECOVERY', host,
    });
    if (!acquired.acquired) {
      summary.skippedLeaseHeld += 1;
      summary.items.push({ ...step, action: 'SKIP', reason: acquired.reason || 'LEASE_NOT_ACQUIRED' });
      continue;
    }

    try {
      if (step.action === 'RE_ENRICH') {
        await compiler.enrichMission(step.missionId, { tenantId, actor: `RECOVERY:${workerInstanceId}` });
        summary.recovered += 1;
        summary.items.push({ ...step, action: 'RE_ENRICHED', leaseFence: acquired.lease.fence });
        continue;
      }

      const orchestrator = require('./missionOrchestratorService');
      if (step.action === 'START_EXECUTION' && autoStart) {
        await orchestrator.startExecution(step.missionId, { actor: `RECOVERY:${workerInstanceId}`, tenantId });
        summary.items.push({ ...step, action: 'EXECUTION_STARTED', leaseFence: acquired.lease.fence });
      }

      // §8: retomada da TASK (não apenas do status da missão). O Router é durável e retoma da fase
      // em que parou; se a task já terminou, a chamada é reconciliadora e idempotente.
      const current = await missionStore.getMission(step.missionId);
      if (current?.linked_task_id) {
        await orchestrator.runMissionTask(step.missionId, { tenantId });
        summary.recovered += 1;
        summary.items.push({ ...step, action: 'TASK_RESUMED', taskId: current.linked_task_id, leaseFence: acquired.lease.fence });
      } else {
        summary.items.push({ ...step, action: 'NO_TASK_TO_RESUME' });
      }
    } catch (error) {
      summary.failed += 1;
      summary.items.push({ ...step, action: 'FAILED', reason: error.code || error.message });
      logger.warn('[missionRecovery] falha ao retomar missão', { missionId: step.missionId, code: error.code, message: error.message });
    } finally {
      await missionStore.releaseMissionLease(step.missionId, { leaseToken: acquired.lease.token }).catch(() => {});
    }
  }

  summary.finishedAt = new Date().toISOString();
  lastSweep = summary;
  if (summary.scanned > 0) {
    logger.info('[missionRecovery] varredura concluída', {
      scanned: summary.scanned, recovered: summary.recovered, skippedLeaseHeld: summary.skippedLeaseHeld,
      skippedNotResumable: summary.skippedNotResumable, failed: summary.failed,
    });
  }
  return summary;
}

/** Varredura de BOOT — chamada na subida da aplicação, antes de qualquer ação humana. */
async function runBootRecovery(options = {}) {
  if (!recoveryEnabled()) {
    return { skipped: true, reason: 'RECOVERY_DISABLED' };
  }
  const summary = await sweep({ ...options, workerInstanceId: options.workerInstanceId || `${INSTANCE_ID}-boot` });
  if (summary.scanned > 0) {
    emitMissionStage('system', null, {
      stage: 'RECOVERY_SWEEP',
      status: summary.failed > 0 ? 'error' : 'success',
      phase: 'RECOVERY',
      message: `recovery de boot: ${summary.recovered} retomada(s), ${summary.skippedLeaseHeld} com lease de outro worker, ${summary.failed} falha(s)`,
      meta: { scanned: summary.scanned, recovered: summary.recovered },
    });
  }
  return summary;
}

/** Varredura periódica (o boot cobre o restart; o timer cobre worker que morre com o app vivo). */
function startRecoveryLoop({ intervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}) {
  if (!recoveryEnabled()) return { started: false, reason: 'RECOVERY_DISABLED' };
  if (sweepTimer) return { started: false, reason: 'ALREADY_RUNNING' };
  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    sweep().catch((error) => logger.warn('[missionRecovery] varredura periódica falhou', { message: error.message }))
      .finally(() => { sweeping = false; });
  }, intervalMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  return { started: true, intervalMs, workerInstanceId: INSTANCE_ID };
}

function stopRecoveryLoop() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    return true;
  }
  return false;
}

module.exports = {
  INSTANCE_ID,
  recoveryEnabled,
  planRecovery,
  sweep,
  runBootRecovery,
  startRecoveryLoop,
  stopRecoveryLoop,
  lastSweep: () => lastSweep,
};
