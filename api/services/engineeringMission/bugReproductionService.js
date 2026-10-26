'use strict';

/**
 * api/services/engineeringMission/bugReproductionService.js
 *
 * REPRODUÇÃO CONTROLADA de um finding. Executa o comando de reprodução declarado (ou avalia os
 * invariantes declarados) em um WORKSPACE ISOLADO (git worktree detached no HEAD real, via
 * `patchApplyService.createWorkspace`) e usa o MESMO runner de comandos do Router
 * (`testRunnerService.runTestCommands` → sandbox Docker). Nenhuma infraestrutura paralela: o
 * mecanismo de execução é o que já governa os testes do Router.
 *
 * A decisão (reproduziu / não reproduziu / inconclusivo) é do motor puro
 * (`evaluateReproduction`) — aqui só se executa e se persiste a evidência.
 *
 * NUNCA destrutivo: nada é executado no repositório de trabalho; o workspace é descartado no fim.
 */

const engine = require('../../../engine/engineeringMission/bugFinding');
const bugFindingService = require('./bugFindingService');
// Lease do finding: MESMA definição usada por `confirmFinding` (aquisição + heartbeat + liberação).
const { withFindingLeaseOwned } = bugFindingService;
const patchApplyService = require('../engineeringRouter/patchApplyService');
const testRunnerService = require('../engineeringRouter/testRunnerService');
const logger = require('../../utils/logger');

/**
 * Limite de reproduções INCONCLUSIVAS CONSECUTIVAS antes de BLOCKED declarado.
 * Ver comentário em `reproduce()`: repetição inconclusiva sem limite monopoliza o runner
 * compartilhado e mantém o finding em vaivém REPRODUCING↔SUSPECTED para sempre.
 */
const MAX_INCONCLUSIVE_REPRODUCTIONS = (() => {
  const raw = Number(process.env.ENGINEERING_MAX_INCONCLUSIVE_REPRODUCTIONS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
})();

/** Ponto de injeção para teste/E2E; o default é o runner REAL do Router. */
const defaultRunner = {
  createWorkspace: (taskId, attempt) => patchApplyService.createWorkspace(taskId, attempt),
  destroyWorkspace: (dir) => patchApplyService.destroyWorkspace(dir),
  runCommands: (params) => testRunnerService.runTestCommands(params),
};

function buildPlan(finding) {
  return engine.buildReproductionPlan(finding);
}

function appendAttempt(finding, attempt) {
  const list = Array.isArray(finding.reproduction_attempts) ? finding.reproduction_attempts : [];
  return [...list, attempt].slice(-20);
}

function evidenceForRun(run) {
  const first = Array.isArray(run?.results) ? run.results[0] : null;
  return bugFindingService.makeEvidence({
    type: 'COMMAND_RUN',
    ref: first?.stdoutRef || first?.stderrRef || `command-run:${run?.outcome || 'unknown'}`,
    detail: first ? `${first.command} → ${first.status} (exit ${first.exitCode ?? 'n/a'})` : `outcome ${run?.outcome}`,
    source: 'bugReproductionService',
  });
}

/**
 * Executa a tentativa de reprodução.
 *
 * @param {string} findingId
 * @param {object} [opts]
 * @param {object} [opts.runner]  injeção (default: runner real)
 * @param {object[]} [opts.invariantResults] para planos INVARIANT (`{ id, violated, detail }`)
 */
async function reproduce(findingId, {
  actor = null, tenantId = null, runner = defaultRunner, invariantResults = null, attemptNumber = null,
  lease = null, workerInstanceId = null,
} = {}) {
  // EXCLUSIVIDADE (defeito medido em 2026-10-25): a tentativa inteira — inclusive a confirmação que
  // ela dispara — roda sob o lease do finding. Sem isto, a varredura de OUTRO processo pegava o mesmo
  // finding em REPRODUCING, rodava a própria tentativa e o devolvia a SUSPECTED no meio desta, que
  // então falhava no CAS ao confirmar. Lease de outro worker ⇒ recusa explícita, nunca paralelismo.
  const dono = await withFindingLeaseOwned(findingId, { lease, workerInstanceId }, async ({ lease: meuLease }) => {
    return executarReproducao(findingId, {
      actor, tenantId, runner, invariantResults, attemptNumber, lease: meuLease,
    });
  });
  if (dono && dono.skipped) {
    return { outcome: 'SKIPPED_LEASE_HELD', skipped: true, code: dono.code, lease: dono.lease, plan: null, finding: null };
  }
  return dono;
}

async function executarReproducao(findingId, {
  actor, tenantId, runner, invariantResults, attemptNumber, lease,
}) {
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });

  const plan = buildPlan(finding);
  const attempt = (attemptNumber || (finding.reproduction_attempts || []).length + 1);

  // PROVENIÊNCIA PRESERVADA (defeito medido em 2026-10-26): gravar o plano DERIVADO como se fosse a
  // reprodução do finding apagava o que o finding DECLAROU — `strategy`, `source` e o comando
  // declarado sumiam na PRIMEIRA tentativa, inclusive quando quem reproduzia era outro processo (o
  // laço global do runner). Quem declarou `DECLARED_TEST_COMMAND` continua auditável como tal; o plano
  // entra por cima do que ele deriva (comando/expect), nunca no lugar do registro de origem.
  const reproductionComProveniencia = plan && typeof plan === 'object'
    ? { ...(finding.reproduction || {}), ...plan }
    : null;

  if (finding.status === 'SUSPECTED' || finding.status === 'NOT_REPRODUCED') {
    await bugFindingService.markReproducing(findingId, { actor, plan, reproduction: reproductionComProveniencia });
  }

  // Plano inexistente ou INVARIANT: nada é executado em sandbox.
  if (plan.kind !== 'COMMAND') {
    const evaluation = engine.evaluateReproduction({ plan, invariantResults });
    await persistAttempt(findingId, {
      plan, evaluation, attempt, actor,
      run: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
    if (evaluation.outcome === 'REPRODUCED') {
      const confirmed = await bugFindingService.confirmFinding(findingId, {
        basis: evaluation.basis,
        evidence: [bugFindingService.makeEvidence({ type: 'INVARIANT_EVALUATION', ref: `invariants:${findingId}`, detail: evaluation.reason, source: 'bugReproductionService' })],
        actor,
        tenantId,
        lease,
      });
      if (confirmed && confirmed.skipped) return { outcome: confirmed.outcome, skipped: true, plan, evaluation, finding: null };
      return { outcome: evaluation.outcome, plan, evaluation, finding: confirmed.finding };
    }
    if (evaluation.outcome === 'NOT_REPRODUCED') {
      const result = await bugFindingService.markNotReproduced(findingId, { actor, reason: evaluation.reason, plan, reproduction: reproductionComProveniencia });
      return { outcome: evaluation.outcome, plan, evaluation, finding: result.finding };
    }
    // INCONCLUSIVE: volta para SUSPECTED — a reprodução não provou nada e o finding não pode ficar
    // "preso" em REPRODUCING fingindo que uma tentativa está em curso.
    const back = await bugFindingService.transitionFinding(findingId, 'SUSPECTED', { actor, reason: evaluation.reason, tenantId });
    return { outcome: evaluation.outcome, plan, evaluation, finding: back.finding };
  }

  // Plano COMMAND: workspace isolado + runner real.
  let workspace = null;
  let run = null;
  let error = null;
  const startedAt = new Date().toISOString();
  try {
    workspace = await runner.createWorkspace(`bug-${findingId}`, attempt);
    run = await runner.runCommands({
      taskId: `bug-${findingId}`,
      attemptNumber: attempt,
      commands: [plan.command],
      cwd: workspace,
    });
  } catch (err) {
    error = err;
    logger.warn('[bugReproductionService] reprodução não executou', { findingId, error: err.message, code: err.code });
  } finally {
    if (workspace) await runner.destroyWorkspace(workspace).catch(() => {});
  }

  const evaluation = error
    ? { outcome: 'INCONCLUSIVE', reason: `falha ao executar a reprodução: ${error.message}`, code: engine.BUG_FAILURE_CODES.REPRODUCTION_INCONCLUSIVE }
    : engine.evaluateReproduction({ plan, run });

  await persistAttempt(findingId, { plan, evaluation, attempt, actor, run, startedAt, finishedAt: new Date().toISOString() });

  if (evaluation.outcome === 'REPRODUCED') {
    const confirmed = await bugFindingService.confirmFinding(findingId, {
      basis: evaluation.basis,
      evidence: [evidenceForRun(run)],
      actor,
      tenantId,
      reproduction: {
        ...(finding.reproduction || {}),
        command: plan.command,
        expect: plan.expect,
        lastOutcome: evaluation.outcome,
        lastExitCode: run?.results?.[0]?.exitCode ?? null,
        confirmedAt: new Date().toISOString(),
      },
      lease,
    });
    if (confirmed && confirmed.skipped) {
      return { outcome: confirmed.outcome, skipped: true, plan, evaluation, run, finding: null };
    }
    return { outcome: evaluation.outcome, plan, evaluation, run, finding: confirmed.finding };
  }

  if (evaluation.outcome === 'NOT_REPRODUCED') {
    const result = await bugFindingService.markNotReproduced(findingId, {
      actor,
      reason: evaluation.reason,
      plan,
      // Mesma preservação de proveniência do caminho acima: o plano derivado NÃO substitui o registro
      // declarado pelo finding (`strategy`/`source`/comando declarado continuam auditáveis).
      reproduction: reproductionComProveniencia,
      evidence: [evidenceForRun(run)],
    });
    return { outcome: evaluation.outcome, plan, evaluation, run, finding: result.finding };
  }

  // INCONCLUSIVO = nada foi provado. O finding NÃO pode ficar em REPRODUCING fingindo trabalho em
  // curso, e também não pode voltar para SUSPECTED indefinidamente.
  //
  // DEFEITO REAL MEDIDO (2026-10-20, lote 5 do runner autoritativo): um finding cuja reprodução
  // falhava por concorrência com outra correção voltava para SUSPECTED e era reproduzido de novo no
  // tick seguinte, para sempre (o mesmo finding aparece REPRODUCING→SUSPECTED em todos os ciclos).
  // Isso consome o runner compartilhado e impede o laço de atender trabalho novo. Tentativas
  // inconclusivas CONSECUTIVAS acima do limite viram `BLOCKED` declarado (nunca "PASS por cansaço").
  const attemptsSoFar = Array.isArray(finding.reproduction_attempts) ? finding.reproduction_attempts : [];
  const consecutiveInconclusive = engine.countConsecutiveInconclusive(attemptsSoFar) + 1;
  if (consecutiveInconclusive >= MAX_INCONCLUSIVE_REPRODUCTIONS) {
    await bugFindingService.blockFinding(findingId, {
      actor,
      dependency: 'BUG_REPRODUCTION_INCONCLUSIVE',
      evidence: [bugFindingService.makeEvidence({
        type: 'LOG_CORRELATION',
        ref: `reproduction-inconclusive:${consecutiveInconclusive}`,
        detail: `${consecutiveInconclusive} tentativa(s) de reprodução inconclusivas consecutivas (limite ${MAX_INCONCLUSIVE_REPRODUCTIONS}); último motivo: ${evaluation.reason || 'n/d'}`,
        source: 'bugReproductionService.reproduce',
      })],
      minimumHumanAction: 'verificar infraestrutura/allowlist da reprodução (sandbox, comando, concorrência com outra correção) e reabrir o finding',
      tenantId,
    });
    return { outcome: evaluation.outcome, plan, evaluation, run, blocked: true, code: 'BUG_REPRODUCTION_INCONCLUSIVE', finding: await bugFindingService.getFinding(findingId) };
  }

  const back = await bugFindingService.transitionFinding(findingId, 'SUSPECTED', { actor, reason: evaluation.reason, tenantId });
  return { outcome: evaluation.outcome, plan, evaluation, run, finding: back.finding };
}

/** Persiste a tentativa (estado + evento) — a trilha de auditoria de "tentou reproduzir". */
async function persistAttempt(findingId, { plan, evaluation, attempt, actor, run, startedAt, finishedAt }) {
  const finding = await bugFindingService.getFinding(findingId);
  const record = {
    attempt,
    kind: plan.kind,
    command: plan.command || null,
    expect: plan.expect || null,
    outcome: evaluation.outcome,
    reason: evaluation.reason,
    exitCode: run?.results?.[0]?.exitCode ?? null,
    durationMs: run?.results?.[0]?.durationMs ?? null,
    aggregateOutcome: run?.outcome || null,
    stdoutRef: run?.results?.[0]?.stdoutRef || null,
    stderrRef: run?.results?.[0]?.stderrRef || null,
    startedAt,
    finishedAt,
  };
  const Model = require('../../db/models/EngineeringBugFinding');
  const M = Model();
  await M.update({ reproduction_attempts: appendAttempt(finding, record) }, { where: { id: findingId } });
  await bugFindingService.recordEvent(findingId, 'REPRODUCTION_ATTEMPTED', record, { actor });
  return record;
}

module.exports = {
  defaultRunner,
  buildPlan,
  reproduce,
  MAX_INCONCLUSIVE_REPRODUCTIONS,
};
