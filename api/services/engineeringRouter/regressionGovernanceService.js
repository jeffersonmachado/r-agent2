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

const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const engineeringTaskService = require('./engineeringTaskService');
const { ROOT, expandGlobsToFiles } = require('./contextBuilderService');
const { runTestCommands } = require('./testRunnerService');
const { buildRegressionPlan } = require('../../../engine/engineeringRouter/regressionPlan');
const { computeSourceFingerprint } = require('../../../governance/proof-engine/fingerprint-chain');

const execFileAsync = util.promisify(execFile);

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
async function checkRegression({ taskId, attemptId, workspacePath, touchedPaths, risk, targetedCommands }) {
  const checkedAt = new Date().toISOString();

  // Candidatos a "teste relacionado"/"subsistema" resolvidos AQUI (I/O real, glob do
  // repositório) — buildRegressionPlan em si permanece puro, recebendo a lista já pronta.
  const availableTestFiles = expandGlobsToFiles(['tests/**/*.test.js']);
  const plan = buildRegressionPlan({ touchedPaths, targetedCommands, risk, availableTestFiles });

  if (plan.commands.length === 0) {
    return {
      pass: false,
      evidence: { checkedAt, planTier: plan.tier, reason: 'RegressionPlan vazio — nenhum comando determinístico para executar' },
    };
  }

  const sourceFingerprint = computeSourceFingerprint(ROOT);
  const startedAt = new Date();
  const { results, allPass } = await runTestCommands({
    taskId,
    attemptNumber: 'regression',
    commands: plan.commands,
    cwd: workspacePath,
  });
  const completedAt = new Date();

  const exitCodes = results.map((r) => r.exitCode);
  const evidenceRefs = results.map((r) => ({ command: r.command, stdoutRef: r.stdoutRef || null, stderrRef: r.stderrRef || null }));

  await engineeringTaskService.createRegressionRun(taskId, attemptId, {
    plan_tier: plan.tier,
    commands: plan.commands,
    exit_codes: exitCodes,
    source_fingerprint: sourceFingerprint,
    result: allPass ? 'PASS' : 'FAIL',
    evidence_refs: evidenceRefs,
    started_at: startedAt,
    completed_at: completedAt,
  });

  const failed = results.filter((r) => r.status !== 'PASS');
  return {
    pass: allPass,
    evidence: {
      checkedAt,
      planTier: plan.tier,
      sourceFingerprint,
      commandCount: plan.commands.length,
      commands: results.map((r) => ({ command: r.command, status: r.status, exitCode: r.exitCode })),
      failed: failed.map((r) => ({ command: r.command, status: r.status, exitCode: r.exitCode })),
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
async function checkGovernance() {
  const scriptPath = path.join(ROOT, 'scripts', 'governance', 'validate-engineering-router-v1.js');
  const checkedAt = new Date().toISOString();

  try {
    const { stdout } = await execFileAsync(process.execPath, [scriptPath], {
      cwd: ROOT,
      timeout: 60000,
      maxBuffer: 5 * 1024 * 1024,
    });
    return {
      pass: true,
      evidence: { checkedAt, gate: 'validate-engineering-router-v1', exitCode: 0, summary: stdout.trim().split('\n').slice(0, 3) },
    };
  } catch (err) {
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    return {
      pass: false,
      evidence: {
        checkedAt,
        gate: 'validate-engineering-router-v1',
        exitCode,
        summary: String(err.stdout || err.message || '').trim().split('\n').slice(0, 10),
      },
    };
  }
}

module.exports = {
  checkRegression,
  checkGovernance,
};
