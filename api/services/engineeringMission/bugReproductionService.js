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
const patchApplyService = require('../engineeringRouter/patchApplyService');
const testRunnerService = require('../engineeringRouter/testRunnerService');
const logger = require('../../utils/logger');

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
} = {}) {
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });

  const plan = buildPlan(finding);
  const attempt = (attemptNumber || (finding.reproduction_attempts || []).length + 1);

  if (finding.status === 'SUSPECTED' || finding.status === 'NOT_REPRODUCED') {
    await bugFindingService.markReproducing(findingId, { actor, plan });
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
      });
      return { outcome: evaluation.outcome, plan, evaluation, finding: confirmed.finding };
    }
    if (evaluation.outcome === 'NOT_REPRODUCED') {
      const result = await bugFindingService.markNotReproduced(findingId, { actor, reason: evaluation.reason, plan });
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
    });
    return { outcome: evaluation.outcome, plan, evaluation, run, finding: confirmed.finding };
  }

  if (evaluation.outcome === 'NOT_REPRODUCED') {
    const result = await bugFindingService.markNotReproduced(findingId, {
      actor,
      reason: evaluation.reason,
      plan,
      evidence: [evidenceForRun(run)],
    });
    return { outcome: evaluation.outcome, plan, evaluation, run, finding: result.finding };
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
};
