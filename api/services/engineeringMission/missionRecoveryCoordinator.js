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
// Teto de itens por varredura: a drenagem do backlog é limitada para manter o custo do boot
// previsível (o excedente é retomado na varredura periódica seguinte).
const MAX_SWEEP_ITEMS = Number(process.env.ENGINEERING_MISSION_RECOVERY_MAX_ITEMS || 500);

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
  // DRENAGEM DO BACKLOG — defeito real corrigido em 2026-09-25.
  //
  // Antes, cada fonte era consultada UMA vez com `limit` (default 25) e a varredura parava aí.
  // Como as consultas ordenam por tempo ASC, o corte ficava SEMPRE com os mais antigos: quando o
  // backlog passava do limite, uma missão recém-abandonada NUNCA entrava no corte e o boot
  // recovery reportava "varredura concluída" sem recuperar o trabalho mais novo (fail-open de
  // recovery). Medido no banco real: 196 missões, ~152 candidatos, corte de 25 — a missão criada
  // pelo teste jamais era alcançada.
  //
  // A drenagem repete a consulta EXCLUINDO o que já foi visto. Exclusão por ID é obrigatória (não
  // `offset`): os itens processados SAEM do filtro ao ganhar lease/status, então `offset` pularia
  // registros; e os que permanecem (SKIP por lease de worker vivo) fariam o laço nunca terminar.
  // `MAX_SWEEP_ITEMS` limita o custo de uma varredura.
  const seenIds = new Set();
  const drained = [];
  while (seenIds.size < MAX_SWEEP_ITEMS) {
    const excludeIds = [...seenIds];
    const [expiredPage, neverLeasedPage] = await Promise.all([
      missionStore.findMissionsWithExpiredLease({ limit, excludeIds }),
      missionStore.findMissionsWithoutLease({ limit, excludeIds }),
    ]);
    for (const mission of [...expiredPage, ...neverLeasedPage]) seenIds.add(mission.id);
    drained.push(...expiredPage, ...neverLeasedPage);
    // Ambas as fontes vieram incompletas ⇒ backlog esgotado nesta fonte (ou teto atingido).
    if (expiredPage.length < limit && neverLeasedPage.length < limit) break;
  }
  const byId = new Map();
  for (const mission of drained) byId.set(mission.id, mission);
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
  // Coordenação explícita entre os dois caminhos do sweep: a missão com `linked_task_id` retoma a
  // task pelo Router (caminho com contexto de fase) e o sweep de TASKS não deve disputar o mesmo
  // lease depois. Medido em 2026-09-25: sem esta marca, o sweep de tasks tomava o lease primeiro e o
  // caminho da missão falhava com TASK_ALREADY_RUNNING — a recuperação acontecia, mas por um caminho
  // e com um erro no outro.
  const tasksResumedByMission = new Set();
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
        // A posse tomada pelo recovery é PROPAGADA ao compiler (mesmo token/fence) — nunca um
        // segundo worker com outra identidade disputando a mesma missão.
        await compiler.enrichMission(step.missionId, { tenantId, actor: `RECOVERY:${workerInstanceId}`, lease: acquired.lease });
        summary.recovered += 1;
        summary.items.push({ ...step, action: 'RE_ENRICHED', leaseFence: acquired.lease.fence });
        continue;
      }

      const orchestrator = require('./missionOrchestratorService');
      if (step.action === 'START_EXECUTION' && autoStart) {
        await orchestrator.startExecution(step.missionId, { actor: `RECOVERY:${workerInstanceId}`, tenantId, lease: acquired.lease });
        summary.items.push({ ...step, action: 'EXECUTION_STARTED', leaseFence: acquired.lease.fence });
      }

      // §8: retomada da TASK (não apenas do status da missão). O Router é durável e retoma da fase
      // em que parou; se a task já terminou, a chamada é reconciliadora e idempotente.
      const current = await missionStore.getMission(step.missionId);
      if (current?.linked_task_id) {
        // TAKEOVER DO LEASE DA TASK — defeito real corrigido em 2026-09-25.
        //
        // A retomada pela via da missão executava a task SEM tomar posse do lease dela. O worker
        // anterior estava morto (SIGKILL) mas o lease continuava no nome dele; a execução então
        // escrevia com um fence que não era mais do dono e era recusada com TASK_LEASE_EXPIRED.
        // Pior: como a via da missão marcava a task em `tasksResumedByMission`, a varredura de
        // tasks (que ADQUIRE lease corretamente) fazia SKIP com ALREADY_RESUMED_BY_MISSION — ou
        // seja, as duas vias se anulavam e o lease órfão permanecia. Medido pelo verificador de
        // retomada real: `FENCE_AVANCOU antes=1 depois=1` e `LEASE_NAO_E_MAIS_DO_WORKER_MORTO`.
        //
        // Aqui a posse é tomada ANTES de executar: `acquireTaskLease` é CAS e só recusa se houver
        // lease VIVO de outro worker; lease expirado é assumido com `fence+1`, que é exatamente o
        // que invalida o worker morto.
        const taskService = require('../engineeringRouter/engineeringTaskService');
        const taskLease = await taskService.acquireTaskLease(current.linked_task_id, {
          workerInstanceId: `${workerInstanceId}-mission`,
        });
        if (!taskLease.acquired) {
          summary.skippedLeaseHeld += 1;
          summary.items.push({
            ...step,
            action: 'SKIP',
            taskId: current.linked_task_id,
            reason: taskLease.reason || 'TASK_LEASE_NOT_ACQUIRED',
            detail: 'lease da task pertence a outro worker VIVO — não se retoma por cima',
          });
          continue;
        }
        // O MESMO dono (workerInstanceId + token + fence) é PROPAGADO: o Router executa com o lease
        // que o recovery acabou de tomar — runtime normal e recovery usam o mesmo modelo de posse.
        if (taskLease.takeover) {
          summary.items.push({ ...step, action: 'TASK_LEASE_TAKEOVER', taskId: current.linked_task_id, previousWorker: taskLease.takeover.previousWorker, previousFence: taskLease.takeover.previousFence, leaseFence: taskLease.lease.fence });
        }
        const runOutcome = await orchestrator.runMissionTask(step.missionId, {
          tenantId,
          runnerId: `${workerInstanceId}-mission`,
          missionLease: acquired.lease,
          taskLease: taskLease.lease,
        });
        tasksResumedByMission.add(current.linked_task_id);
        summary.recovered += 1;
        summary.items.push({
          ...step,
          action: 'TASK_RESUMED',
          taskId: current.linked_task_id,
          leaseFence: taskLease.lease.fence,
          previousWorker: taskLease.takeover ? taskLease.takeover.previousWorker : null,
          finalTaskStatus: runOutcome?.result?.status || null,
          finalReasonCode: runOutcome?.result?.reasonCode || null,
        });
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

  // ── Varredura de ENGINEERINGTASK (missão V2) ────────────────────────────────────────────────
  // GAP CONFIRMADO: o sweep só olhava MISSÕES. Uma task cujo worker morreu (lease expirado) e cuja
  // missão não é resumível ficava órfã para sempre, e a retomada dependia de a missão estar no
  // caminho. A missão exige explicitamente: "scan incomplete EngineeringTasks → evaluate leases →
  // acquire valid lease → schedule task → continue execution".
  const taskService = require('../engineeringRouter/engineeringTaskService');
  summary.taskItems = [];
  try {
    const orphanTasks = await taskService.findTasksWithExpiredLease({ limit: DEFAULT_LIMIT });
    for (const task of orphanTasks) {
      // Já retomada pelo caminho da missão nesta mesma varredura: não disputa o lease.
      if (tasksResumedByMission.has(task.id)) {
        summary.taskItems.push({ taskId: task.id, action: 'SKIP', reason: 'ALREADY_RESUMED_BY_MISSION' });
        continue;
      }
      const acquired = await taskService.acquireTaskLease(task.id, {
        workerInstanceId: `${workerInstanceId}-task`,
        host,
      });
      if (!acquired.acquired) {
        summary.taskItems.push({ taskId: task.id, action: 'SKIP', reason: acquired.reason || 'TASK_LEASE_NOT_ACQUIRED' });
        continue;
      }
      // A task está sob posse de um worker vivo (o deste recovery) com fence avançado: a execução
      // continua do ponto onde parou COM ESTA MESMA POSSE (defeito real corrigido em 2026-09-28:
      // antes o `runMissionTask` era chamado sem runnerId/lease, criava um "Runner B" com outra
      // identidade e era recusado pelo próprio lease recém-tomado — TASK_ALREADY_RUNNING). Task sem
      // missão também é retomada pelo Router (antes o lease ficava tomado e nada executava).
      const runnerId = `${workerInstanceId}-task`;
      let outcome = null;
      try {
        if (task.missionId || task.mission_id) {
          const orchestrator = require('./missionOrchestratorService');
          const out = await orchestrator.runMissionTask(task.missionId || task.mission_id, { tenantId, runnerId, taskLease: acquired.lease });
          outcome = out?.result || null;
        } else {
          const router = require('../engineeringRouter/engineeringRouterService');
          outcome = await router.runTask(task.id, { runnerId, lease: acquired.lease, eventAudienceTenantId: tenantId });
        }
      } catch (error) {
        summary.taskItems.push({ taskId: task.id, action: 'RESUME_FAILED', reason: error.code || error.message, leaseFence: acquired.lease.fence });
        await taskService.releaseTaskLease(task.id, { leaseToken: acquired.lease.token }).catch(() => {});
        continue;
      }
      summary.taskItems.push({
        taskId: task.id,
        action: 'TASK_RESUMED',
        previousWorker: acquired.takeover ? acquired.takeover.previousWorker : (task.lease_worker_instance_id || null),
        leaseFence: acquired.lease.fence,
        resumed: true,
        finalTaskStatus: outcome?.status || null,
        finalReasonCode: outcome?.reasonCode || null,
      });
    }
    summary.tasksScanned = orphanTasks.length;
    summary.tasksRecovered = summary.taskItems.filter((i) => i.action === 'TASK_RESUMED').length;
  } catch (error) {
    summary.taskItems.push({ action: 'TASK_SWEEP_FAILED', reason: error.code || error.message });
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

/**
 * RECONCILIAÇÃO DE INTEGRATION INTENTS NÃO TERMINAIS — parte do recovery de BOOT.
 *
 * DEFEITO ELIMINADO (2026-10-03): a reconciliação pós-crash existia, mas só era alcançada quando a
 * MESMA tríade era reenviada por um chamador. Se o processo morresse entre o `git update-ref` e o
 * CAS do banco e ninguém reenviasse aquela integração, a fonte da missão ficava permanentemente
 * mentindo — a branch à frente do banco — e nada no boot corrigia isso. A reconciliação dependia,
 * na prática, de um comando manual.
 *
 * Agora o boot varre os intents NÃO terminais (PREPARED/GIT_APPLIED/DB_APPLIED/RECOVERY_REQUIRED) e
 * fecha o estado de cada missão afetada usando a matriz determinística: completa o banco quando o
 * efeito git já estava autorizado, e marca RECOVERY_REQUIRED quando o estado é divergente. Nunca
 * reaplica um efeito já aplicado.
 */
async function reconcilePendingIntents({ limit = 200 } = {}) {
  const { EngineeringMissionIntegration } = require('../../db/models');
  const missionSourceService = require('./missionSourceService');
  const Integration = EngineeringMissionIntegration();

  const rows = await Integration.findAll({
    where: { integration_status: ['PREPARED', 'GIT_APPLIED', 'DB_APPLIED', 'RECOVERY_REQUIRED'] },
    attributes: ['mission_id'],
    limit,
  });
  const missionIds = [...new Set((rows || []).map((r) => String(r.mission_id)).filter(Boolean))];
  if (missionIds.length === 0) return { missions: 0, reconciled: 0, outcomes: [] };

  const outcomes = [];
  let reconciled = 0;
  for (const missionId of missionIds) {
    try {
      const result = await missionSourceService.reconcileMissionSourceIntents({ missionId });
      reconciled += result.reconciled;
      for (const outcome of result.outcomes) outcomes.push({ missionId, ...outcome });
    } catch (err) {
      // Falha de uma missão não pode impedir a reconciliação das outras (fail-closed por missão).
      logger.error('[missionRecovery] falha ao reconciliar intents de uma missão', {
        missionId, errorName: err && err.name, errorMessage: err && err.message,
      });
      outcomes.push({ missionId, outcome: 'ERROR', reason: err && err.message });
    }
  }
  if (outcomes.length > 0) {
    logger.warn('[missionRecovery] intents não terminais reconciliados no boot', {
      missions: missionIds.length, reconciled, total: outcomes.length,
    });
  }
  return { missions: missionIds.length, reconciled, outcomes };
}

/** Varredura de BOOT — chamada na subida da aplicação, antes de qualquer ação humana. */
async function runBootRecovery(options = {}) {
  if (!recoveryEnabled()) {
    return { skipped: true, reason: 'RECOVERY_DISABLED' };
  }
  // Antes de retomar missões: fecha a coerência git↔banco dos intents que ficaram no meio. Sem
  // isto, retomar uma missão cuja fonte ficou inconsistente seria retomar sobre estado mentiroso.
  const intentReconciliation = await reconcilePendingIntents(options).catch((err) => {
    logger.error('[missionRecovery] reconciliação de intents falhou no boot', { errorMessage: err && err.message });
    return { missions: 0, reconciled: 0, outcomes: [], error: err && err.message };
  });

  const summary = await sweep({ ...options, workerInstanceId: options.workerInstanceId || `${INSTANCE_ID}-boot` });
  summary.intentReconciliation = intentReconciliation;
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

/**
 * Varredura periódica (o boot cobre o restart; o timer cobre worker que morre com o app vivo).
 *
 * A RECONCILIAÇÃO DE INTENTS roda AQUI TAMBÉM — não apenas no boot. DEFEITO ELIMINADO (2026-10-03):
 * `reconcilePendingIntents` só era chamada em `runBootRecovery`. Uma integração que morresse entre o
 * `git update-ref` e o CAS do banco com a aplicação VIVA (crash do worker, não do processo) ficava
 * com a fonte mentindo indefinidamente: nenhum boot acontece, e nada mais varria os intents
 * pendentes. A varredura periódica é idempotente e determinística, então repeti-la é seguro — e
 * reconciliar ANTES do sweep garante que a retomada nunca trabalhe sobre estado inconsistente.
 */
function startRecoveryLoop({ intervalMs = DEFAULT_SWEEP_INTERVAL_MS } = {}) {
  if (!recoveryEnabled()) return { started: false, reason: 'RECOVERY_DISABLED' };
  if (sweepTimer) return { started: false, reason: 'ALREADY_RUNNING' };
  sweepTimer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    reconcilePendingIntents()
      .catch((error) => logger.warn('[missionRecovery] reconciliação periódica de intents falhou', { message: error.message }))
      .then(() => sweep())
      .catch((error) => logger.warn('[missionRecovery] varredura periódica falhou', { message: error.message }))
      .finally(() => { sweeping = false; });
  }, intervalMs);
  if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
  return { started: true, intervalMs, workerInstanceId: INSTANCE_ID, reconcilesIntents: true };
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
  reconcilePendingIntents,
  startRecoveryLoop,
  stopRecoveryLoop,
  lastSweep: () => lastSweep,
};
