'use strict';

/**
 * engine/engineeringMission/bugFinding/reproductionDerivation.js
 *
 * DERIVAÇÃO AUTOMÁTICA DO PLANO DE REPRODUÇÃO a partir do CONTEXTO REAL de uma falha.
 *
 * Problema que este módulo resolve (medido 2026-09-30): `hookMissionFailure` registrava o finding
 * sem `reproduction`, então `buildReproductionPlan` devolvia `UNAVAILABLE` e o laço parava em
 * `NO_REPRODUCTION_PLAN` — o caminho normal ficava preso em SUSPECTED. A falha, porém, já carrega
 * contexto suficiente (TestRun que falhou, RegressionRun, comandos declarados na própria
 * EngineeringTask, reasonCode determinístico): o plano deve ser DERIVADO dele.
 *
 * Regras invioláveis:
 *   - NADA é inventado: o comando deriva de um comando REAL já executado/declarado. Não existe
 *     fallback genérico ("npm test") — isso produziria reprodução de mentira.
 *   - `expect` de uma falha é FAIL: reproduzir = o comando falhar de novo.
 *   - Sem contexto suficiente o resultado é `unavailable` com MOTIVO EXPLÍCITO persistível.
 *
 * Módulo PURO: nenhuma I/O, nenhum relógio, nenhum acesso a banco.
 */

const DERIVATION_STRATEGIES = Object.freeze({
  TEST_FAILURE: 'TEST_FAILURE',
  REGRESSION_FAILURE: 'REGRESSION_FAILURE',
  DECLARED_TEST_COMMAND: 'DECLARED_TEST_COMMAND',
  COMMAND_FAILURE: 'COMMAND_FAILURE',
  GOVERNANCE_INVARIANT: 'GOVERNANCE_INVARIANT',
  NONE: 'NONE',
});

/** Fontes de finding que descrevem falha de teste (o teste executado é a reprodução natural). */
const TEST_SOURCES = Object.freeze(['UNIT_TEST', 'INTEGRATION_TEST', 'E2E_TEST', 'REGRESSION_TEST']);

/** reasonCodes cuja violação é determinística: reexecutar o gate/invariante é reprodução válida. */
const DETERMINISTIC_REASON_PATTERN = /(GATE|INVARIANT|FINGERPRINT|STALE|SCHEMA|MISSING_|CONSISTENC|VIOLATION|MISMATCH)/i;

function toCommand(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'object') {
    for (const key of ['command', 'cmd', 'suite', 'test']) {
      const candidate = toCommand(value[key]);
      if (candidate) return candidate;
    }
  }
  return null;
}

function firstCommandOf(list) {
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const command = toCommand(item);
    if (command) return command;
  }
  return null;
}

function isFailedRun(run = {}) {
  const outcome = String(run.outcome || run.status || '').toUpperCase();
  return outcome !== '' && outcome !== 'PASS' && outcome !== 'PASSED' && outcome !== 'SUCCESS';
}

/**
 * Deriva o plano de reprodução do contexto real.
 *
 * @param {object} params
 * @param {object|null} [params.task]            EngineeringTask (usa `test_commands`)
 * @param {object} [params.result]               resultado do runTask (status/reasonCode/...)
 * @param {object[]} [params.testRuns]           TestRuns REAIS do attempt (comando + outcome)
 * @param {object[]} [params.regressionRuns]     RegressionRuns REAIS do fix task
 * @param {string|null} [params.source]          FINDING_SOURCES do finding
 * @param {string|null} [params.reasonCode]      motivo declarado pela execução
 * @returns {{derived: boolean, strategy: string, command: string|null, expect: string,
 *            invariants: object[]|null, reason: string, evidence: object[]}}
 */
function deriveReproductionPlan({
  task = null, result = {}, testRuns = [], regressionRuns = [], source = null, reasonCode = null,
} = {}) {
  const evidence = [];
  const effectiveReason = reasonCode || result.reasonCode || null;
  const effectiveSource = String(source || '').toUpperCase();

  // 1) TestRun REAL que falhou — a reprodução é exatamente o comando que já falhou.
  const failedTestRun = (Array.isArray(testRuns) ? testRuns : []).find(isFailedRun);
  if (failedTestRun) {
    const command = toCommand(failedTestRun);
    if (command) {
      evidence.push({ type: 'TEST_REPORT', ref: failedTestRun.stdoutRef || failedTestRun.stdout_ref || `test-run:${command}`, detail: `TestRun ${failedTestRun.outcome || failedTestRun.status} no comando "${command}"` });
      return {
        derived: true,
        strategy: DERIVATION_STRATEGIES.TEST_FAILURE,
        command,
        expect: 'FAIL',
        invariants: null,
        reason: 'comando derivado do TestRun que falhou na execução real da task',
        evidence,
      };
    }
  }

  // 2) RegressionRun REAL que falhou.
  const failedRegression = (Array.isArray(regressionRuns) ? regressionRuns : []).find((run) => {
    const outcome = String(run.result || run.outcome || '').toUpperCase();
    return outcome !== '' && outcome !== 'PASS';
  });
  if (failedRegression) {
    const command = firstCommandOf(failedRegression.commands) || toCommand(failedRegression);
    if (command) {
      evidence.push({ type: 'TEST_REPORT', ref: `regression:${failedRegression.id || 'n/d'}`, detail: `RegressionRun ${failedRegression.result || failedRegression.outcome} no comando "${command}"` });
      return {
        derived: true,
        strategy: DERIVATION_STRATEGIES.REGRESSION_FAILURE,
        command,
        expect: 'FAIL',
        invariants: null,
        reason: 'comando derivado da execução de regressão que falhou',
        evidence,
      };
    }
  }

  // 3) Comando de teste DECLARADO na própria EngineeringTask (contrato da task).
  const declared = firstCommandOf(task && task.test_commands);
  if (declared) {
    evidence.push({ type: 'ARTIFACT', ref: `engineering_task:${task.id || 'n/d'}:test_commands`, detail: `comando declarado no contrato da task: "${declared}"` });
    return {
      derived: true,
      strategy: DERIVATION_STRATEGIES.DECLARED_TEST_COMMAND,
      command: declared,
      expect: 'FAIL',
      invariants: null,
      reason: 'comando derivado de `test_commands` da EngineeringTask',
      evidence,
    };
  }

  // 4) Comando carregado pelo próprio resultado da execução.
  const fromResult = toCommand(result.command) || toCommand(result.testCommand) || toCommand(result.suite);
  if (fromResult) {
    evidence.push({ type: 'ARTIFACT', ref: `task_result:${fromResult}`, detail: `comando informado pelo resultado da execução: "${fromResult}"` });
    return {
      derived: true,
      strategy: DERIVATION_STRATEGIES.COMMAND_FAILURE,
      command: fromResult,
      expect: 'FAIL',
      invariants: null,
      reason: 'comando derivado do resultado da execução',
      evidence,
    };
  }

  // 5) Invariante determinístico: a violação é reproduzível pela reexecução do gate.
  if (effectiveReason && DETERMINISTIC_REASON_PATTERN.test(effectiveReason)) {
    evidence.push({ type: 'INVARIANT_EVALUATION', ref: `reason:${effectiveReason}`, detail: `motivo determinístico reportado pela execução: ${effectiveReason}` });
    return {
      derived: true,
      strategy: DERIVATION_STRATEGIES.GOVERNANCE_INVARIANT,
      command: null,
      expect: 'FAIL',
      invariants: [{ id: effectiveReason }],
      reason: 'invariante determinístico derivado do reasonCode da execução',
      evidence,
    };
  }

  // 6) Nada derivável: motivo EXPLÍCITO (nunca silêncio). Uma falha de TEST_SOURCE sem comando é
  //    defeito do laço e por isso é reportada como tal.
  const isTestSource = TEST_SOURCES.includes(effectiveSource);
  return {
    derived: false,
    strategy: DERIVATION_STRATEGIES.NONE,
    command: null,
    expect: 'FAIL',
    invariants: null,
    reason: isTestSource
      ? 'falha classificada como falha de teste, mas nenhum TestRun/comando declarado foi encontrado (contexto de execução ausente)'
      : 'contexto insuficiente para derivar reprodução segura (nenhum TestRun, RegressionRun, test_command ou reasonCode determinístico)',
    evidence,
  };
}

module.exports = { DERIVATION_STRATEGIES, deriveReproductionPlan };
