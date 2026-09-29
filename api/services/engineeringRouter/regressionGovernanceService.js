'use strict';

/**
 * api/services/engineeringRouter/regressionGovernanceService.js
 *
 * ERV1-CLOSE-004: antes desta correção, REGRESSION e GOVERNANCE eram apenas transições de
 * estado — `executeRoutedLoop` chamava `transitionTask(taskId, 'REGRESSION')` e
 * `transitionTask(taskId, 'GOVERNANCE')` sem executar nem verificar nada de verdade entre elas.
 * `status` no banco dizendo "REGRESSION"/"GOVERNANCE" NUNCA é evidência — é proibido pela
 * missão de fechamento. Este módulo produz evidência real e determinística para os dois
 * estágios, capaz de reprovar (nunca decorativo):
 *
 *   - `checkRegression`: reverifica no BANCO (não confia só na variável em memória do loop) que
 *     todo `EngineeringTestRun` desta tentativa é `PASS`/`exitCode 0` — "V1: regressão local =
 *     o próprio conjunto determinístico de testCommands já executado de forma limpa neste
 *     attempt (workspace isolado, sem estado residual)" é exatamente o texto já presente na
 *     missão original; não inventa uma suíte nova, só exige que a evidência já real seja lida
 *     de volta e confirmada antes de avançar.
 *   - `checkGovernance`: executa de verdade o gate canônico já existente
 *     (`scripts/governance/validate-engineering-router-v1.js`) como subprocess real — nunca
 *     reimplementa governança, só invoca a autoridade que já existe.
 */

const path = require('path');
const engineeringTaskService = require('./engineeringTaskService');
const { ROOT, expandGlobsToFiles } = require('./contextBuilderService');
const { runTestCommands } = require('./testRunnerService');
const { buildRegressionPlan } = require('../../../engine/engineeringRouter/regressionPlan');
const { computeSourceFingerprint } = require('../../../governance/proof-engine/fingerprint-chain');
const { TEST_OUTCOMES } = require('../../../engine/engineeringRouter/constants');
const { runChildWithDeadline } = require('../../utils/operationDeadline');

/**
 * ER-V1-FINAL-006 — Real Regression.
 *
 * Achado real (confirmado por inspeção direta do código-fonte): a versão anterior desta
 * função só chamava `listTestRuns(attemptId)` — relia os `EngineeringTestRun` já persistidos
 * pela fase TESTING (executada ANTES do REVIEW aprovar). Isso é evidence revalidation (prova
 * que algo passou no passado), nunca regression execution (prova que o código, no estado
 * ATUAL, ainda passa). Corrigido: constrói um `RegressionPlan` real proporcional ao risco
 * (`engine/engineeringRouter/regressionPlan.js`) e EXECUTA os comandos de verdade, no mesmo
 * workspace isolado (via o sandbox real de ER-V1-FINAL-001), persistindo um
 * `EngineeringRegressionRun` amarrado ao `sourceFingerprint` da working tree no momento da
 * execução.
 *
 * @param {Object} params
 * @param {string} params.taskId
 * @param {string} params.attemptId
 * @param {string} params.workspacePath - workspace isolado da tentativa (patch já aplicado).
 * @param {string[]} params.touchedPaths - caminhos tocados pelo patch validado.
 * @param {string} params.risk - LOW|MEDIUM|HIGH|CRITICAL (do Task Contract).
 * @param {string[]} params.targetedCommands - testCommands do Task Contract.
 * @returns {Promise<{pass:boolean, evidence:Object}>}
 */
async function checkRegression({ taskId, attemptId, workspacePath, touchedPaths, risk, targetedCommands, signal = null, onCommandCompleted = null, assertHeld = null }) {
  const checkedAt = new Date().toISOString();

  // Candidatos a "teste relacionado"/"subsistema" resolvidos AQUI (I/O real, glob do
  // repositório) — buildRegressionPlan em si permanece puro, recebendo a lista já pronta.
  // Achado real reproduzido ao vivo: sem este filtro, um patch tocando fixtures de teste do
  // próprio Engineering Router (ex.: tests/fixtures/engineering-router-sandbox/mathUtils.js)
  // fazia o plano HIGH/MEDIUM sugerir `npx jest tests/fixtures/engineering-router-sandbox/
  // mathUtils.test.js` — um comando que SEMPRE falha com "No tests found" porque esse
  // diretório está em `testPathIgnorePatterns` do jest.config.cjs real (mesma exclusão de
  // `tests/rpa/`). Não é uma reprovação real de regressão, é o próprio plano sugerindo um
  // comando estruturalmente inválido — replica aqui a MESMA exclusão do jest.config.cjs.
  const availableTestFiles = expandGlobsToFiles(['tests/**/*.test.js'])
    .filter((f) => !f.startsWith('tests/rpa/') && !f.startsWith('tests/fixtures/engineering-router-sandbox/'));
  const plan = buildRegressionPlan({ touchedPaths, targetedCommands, risk, availableTestFiles });

  if (plan.commands.length === 0) {
    return {
      pass: false,
      evidence: { checkedAt, planTier: plan.tier, reason: 'RegressionPlan vazio — nenhum comando determinístico para executar' },
    };
  }

  const sourceFingerprint = computeSourceFingerprint(ROOT);
  const startedAt = new Date();
  // Cada comando da regressão tem o deadline da política REGRESSION_COMMAND (registry), nunca o
  // default de teste unitário: regressão é legitimamente longa e é governada por progresso
  // (cada comando concluído é um evento de progresso), não por wall-clock.
  const { results, allPass, outcome } = await runTestCommands({
    taskId,
    attemptNumber: 'regression',
    commands: plan.commands,
    cwd: workspacePath,
    policy: 'REGRESSION_COMMAND',
    signal,
    onCommandCompleted,
  });
  const completedAt = new Date();
  // Fencing: a evidência de regressão só é gravada se este worker ainda é o dono da task.
  if (typeof assertHeld === 'function') await assertHeld();

  const exitCodes = results.map((r) => r.exitCode);
  const evidenceRefs = results.map((r) => ({ command: r.command, stdoutRef: r.stdoutRef || null, stderrRef: r.stderrRef || null }));

  await engineeringTaskService.createRegressionRun(taskId, attemptId, {
    plan_tier: plan.tier,
    commands: plan.commands,
    exit_codes: exitCodes,
    source_fingerprint: sourceFingerprint,
    result: allPass ? 'PASS' : outcome,
    evidence_refs: evidenceRefs,
    started_at: startedAt,
    completed_at: completedAt,
  });

  const failed = results.filter((r) => r.status !== 'PASS');
  return {
    pass: allPass,
    outcome,
    evidence: {
      checkedAt,
      planTier: plan.tier,
      sourceFingerprint,
      outcome,
      commandCount: plan.commands.length,
      commands: results.map((r) => ({ command: r.command, status: r.status, outcome: r.outcome || r.status, exitCode: r.exitCode })),
      failed: failed.map((r) => ({ command: r.command, status: r.status, outcome: r.outcome || r.status, exitCode: r.exitCode })),
    },
  };
}

/**
 * Executa o gate de governança canônico já existente do Engineering Router como subprocess
 * real. Nunca reimplementa a checagem — só invoca `node scripts/governance/
 * validate-engineering-router-v1.js` e reporta o exitCode real.
 *
 * @returns {Promise<{pass:boolean, evidence:Object}>}
 */
async function checkGovernance({ signal = null } = {}) {
  const scriptPath = path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v1.js');
  const checkedAt = new Date().toISOString();

  // Subprocesso governado pela política REGRESSION_COMMAND (antes: `timeout: 60000` hardcoded, e o
  // `execFile` só mandava SIGTERM — um gate travado ignorando SIGTERM segurava o worker). Agora:
  // deadline do registry → SIGTERM → grace (REGRESSION_CHILD_TERMINATION_GRACE) → SIGKILL, somente
  // no CHILD. Expirar é TIMEOUT (não FAIL): o gate não reprovou, ele não terminou.
  const run = await runChildWithDeadline({
    command: process.execPath,
    args: [scriptPath],
    cwd: ROOT,
    policy: 'REGRESSION_COMMAND',
    gracePolicy: 'REGRESSION_CHILD_TERMINATION_GRACE',
    parentSignal: signal,
    meta: { operation: 'governance_gate:validate-engineering-router-v1', phase: 'GOVERNANCE' },
  });
  if (run.cancelled) {
    const cancelled = new Error('gate de governança cancelado cooperativamente');
    cancelled.code = 'OPERATION_CANCELLED';
    throw cancelled;
  }
  const outcome = run.timedOut ? TEST_OUTCOMES.TIMEOUT
    : run.exitCode === 0 ? TEST_OUTCOMES.PASS
      : run.exitCode === null ? TEST_OUTCOMES.INFRA_ERROR
        : TEST_OUTCOMES.FAIL;
  const summarySource = outcome === TEST_OUTCOMES.PASS ? run.stdout : (run.stdout || run.stderr);
  return {
    pass: outcome === TEST_OUTCOMES.PASS,
    outcome,
    evidence: {
      checkedAt,
      gate: 'validate-engineering-router-v1',
      exitCode: run.exitCode,
      outcome,
      durationMs: run.durationMs,
      deadlineMs: run.deadlineMs,
      terminatedBy: run.terminatedBy,
      summary: String(summarySource || '').trim().split('\n').slice(0, outcome === TEST_OUTCOMES.PASS ? 3 : 10),
    },
  };
}

module.exports = {
  checkRegression,
  checkGovernance,
};
