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

const fs = require('fs');
const path = require('path');
const engineeringTaskService = require('./engineeringTaskService');
const { ROOT, expandGlobsToFiles } = require('./contextBuilderService');
const { runTestCommands } = require('./testRunnerService');
const { buildRegressionPlan } = require('../../../engine/engineeringRouter/regressionPlan');
const { computeSourceFingerprint } = require('../../../governance/proof-engine/fingerprint-chain');
const { TEST_OUTCOMES } = require('../../../engine/engineeringRouter/constants');
const { runChildWithDeadline } = require('../../utils/operationDeadline');
const logger = require('../../utils/logger');

/**
 * Diretórios que o walk do workspace nunca percorre: pesados e irrelevantes para descobrir
 * suítes de teste (e `node_modules` pode estar symlinkado no worktree).
 */
const WORKSPACE_IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'logs', 'tmp', 'cache']);

/**
 * Candidatos a "teste relacionado"/"subsistema" resolvidos A PARTIR DO WORKSPACE DA TENTATIVA.
 *
 * DEFEITO ELIMINADO (2026-10-08). `buildRegressionPlan` recebia `expandGlobsToFiles(['tests/**\/*.test.js'])`
 * SEM reader, então a lista vinha do ROOT do processo (o repositório principal). Os comandos do plano,
 * porém, rodam com `cwd: workspacePath` — o worktree isolado da tentativa (`source_commit` + patch).
 * Um arquivo que existe numa fonte e não na outra vira `npx jest <arquivo>` ⇒ "No tests found"
 * (exit 1), e a regressão reprova por um comando que NUNCA poderia passar.
 *
 * Medido ao vivo (task eef5f81e, missão ca56cbdc): o coder aplicou um patch de 1354B e passou os três
 * test runs do contrato; a regressão reprovou em `tests/unit/engineeringMissionGovernanceSafeguards.
 * test.js` e `tests/unit/engineeringMissionSpec.test.js` — suítes que existiam na main e NÃO existiam
 * no worktree da missão. O RED do patch era, na verdade, um artefato do plano.
 *
 * A lista passa a ser resolvida no MESMO lugar onde os comandos rodam (inclusive arquivos de teste
 * CRIADOS pelo patch), e o que ficou de fora por não existir no workspace é registrado como
 * observação auditável — nunca descartado em silêncio.
 *
 * @returns {{availableTestFiles: string[], audit: Object}}
 */
function resolveAvailableTestFiles(workspacePath) {
  const ignoredByJest = (f) => f.startsWith('tests/rpa/') || f.startsWith('tests/fixtures/engineering-router-sandbox/');
  // O filtro acima replica as exclusões de `testPathIgnorePatterns` do jest.config.cjs real: um
  // diretório ignorado pelo jest nunca pode virar comando do plano.
  const doWorkspace = expandGlobsToFiles(['tests/**/*.test.js'], createWorkspaceReader(workspacePath))
    .filter((f) => !ignoredByJest(f));
  const availableTestFiles = [...new Set(doWorkspace)].sort();

  // AUDITORIA: candidatos que existem no repositório principal e NÃO existem no workspace. Sem este
  // registro, o desalinhamento de fonte desapareceria sem deixar rastro.
  let ausentesNoWorkspace = [];
  try {
    const doPrincipal = expandGlobsToFiles(['tests/**/*.test.js']).filter((f) => !ignoredByJest(f));
    const presentes = new Set(availableTestFiles);
    ausentesNoWorkspace = doPrincipal.filter((f) => !presentes.has(f)).sort();
  } catch (err) {
    logger.warn('[engineeringRegressionGovernance] auditoria de candidatos indisponível', {
      workspacePath, error: err.message,
    });
  }

  return {
    availableTestFiles,
    audit: {
      workspacePath,
      source: 'WORKSPACE_DA_TENTATIVA',
      availableTestFilesCount: availableTestFiles.length,
      candidatesAbsentInWorkspace: ausentesNoWorkspace,
      candidatesAbsentInWorkspaceCount: ausentesNoWorkspace.length,
    },
  };
}

/**
 * Reader dos arquivos do WORKSPACE da tentativa (walk de fs, com cache).
 *
 * O contrato é o mesmo dos readers de `contextBuilderService` (`listFiles`/`isFile`/`readFile`):
 * `listFiles()` devolve a lista relativa de arquivos, e `null` faria `expandGlobsToFiles` cair no
 * walk do ROOT — exatamente o comportamento errado que este reader existe para eliminar.
 */
function createWorkspaceReader(workspacePath) {
  const root = path.resolve(workspacePath);
  let cachedListing = null;

  const walk = (dir, acc) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return acc;
    }
    for (const entry of entries) {
      if (WORKSPACE_IGNORED_DIRS.has(entry.name)) continue;
      // Symlink não é seguido: um link para fora do workspace não representa o que os comandos veem.
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, acc);
      else if (entry.isFile()) acc.push(path.relative(root, abs).split(path.sep).join('/'));
    }
    return acc;
  };

  return {
    kind: 'WORKSPACE',
    commit: null,
    listFiles: () => {
      if (cachedListing === null) cachedListing = walk(root, []);
      return cachedListing;
    },
    isFile: (relPath) => {
      try {
        return fs.statSync(path.join(root, relPath)).isFile();
      } catch (_) {
        return false;
      }
    },
    readFile: (relPath) => {
      try {
        return fs.readFileSync(path.join(root, relPath), 'utf8');
      } catch (_) {
        return null;
      }
    },
  };
}

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

  // Candidatos a "teste relacionado"/"subsistema" resolvidos AQUI (I/O real) — `buildRegressionPlan`
  // permanece puro, recebendo a lista já pronta.
  //
  // A resolução é feita A PARTIR DO WORKSPACE DA TENTATIVA, que é onde os comandos rodam
  // (`cwd: workspacePath` abaixo). Antes vinha do ROOT do processo e o plano sugeria comandos para
  // arquivos que não existiam no worktree — "No tests found" (exit 1) reprovando a regressão por um
  // defeito do plano, não do patch. Ver `resolveAvailableTestFiles` para a medição ao vivo.
  const { availableTestFiles, audit: testFileAudit } = resolveAvailableTestFiles(workspacePath);
  const plan = buildRegressionPlan({ touchedPaths, targetedCommands, risk, availableTestFiles });

  if (plan.commands.length === 0) {
    return {
      pass: false,
      evidence: { checkedAt, planTier: plan.tier, testFileAudit, reason: 'RegressionPlan vazio — nenhum comando determinístico para executar' },
    };
  }

  // FINGERPRINT DA FONTE (defeito medido em 2026-10-08): o modelo `EngineeringRegressionRun`
  // declara que `source_fingerprint` é "da working tree no momento da execução", mas o cálculo
  // usava o ROOT do PROCESSO enquanto os comandos rodam com `cwd: workspacePath`. Numa task de
  // missão o workspace é materializado do commit da FONTE DA MISSÃO, então o fingerprint descrevia
  // a `main` e o veredito falava do WORKSPACE — duas árvores, o mesmo campo. Agora fingerprinta a
  // árvore onde os comandos de fato rodaram, e a raiz usada fica registrada na evidência.
  const sourceFingerprint = computeSourceFingerprint(workspacePath);
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

  // PLANO DEGRADADO É SINALIZADO, NÃO SILENCIADO: um tier HIGH/CRITICAL que executa apenas os
  // comandos do contrato mede menos do que promete. Sem este evento, o caso só existiria num JSON
  // de evidência que ninguém consulta — e foi assim que ele passou desapercebido.
  if (plan.degraded === true) {
    await engineeringTaskService.recordTelemetry({
      task_id: taskId,
      attempt_id: attemptId,
      role: 'REGRESSION',
      result: 'PLAN_DEGRADED',
      event_type: 'REGRESSION_PLAN_DEGRADED',
      detail: {
        planTier: plan.tier,
        breakdown: plan.breakdown,
        commandCount: plan.commands.length,
        touchedPaths: Array.isArray(touchedPaths) ? touchedPaths : [],
        availableTestFilesCount: testFileAudit ? testFileAudit.availableTestFilesCount : null,
      },
    });
  }

  const failed = results.filter((r) => r.status !== 'PASS');
  return {
    pass: allPass,
    outcome,
    evidence: {
      checkedAt,
      planTier: plan.tier,
      sourceFingerprint,
      // De QUAL árvore é o fingerprint acima (auditável): antes ele vinha do ROOT do processo.
      sourceFingerprintRoot: { kind: 'WORKSPACE_DA_TENTATIVA', path: workspacePath },
      outcome,
      commandCount: plan.commands.length,
      // Composição do plano por origem + os caminhos tocados que a alimentaram: sem isto, um plano
      // CRITICAL com 3 comandos e outro com 43 produziam evidência indistinguível.
      planBreakdown: plan.breakdown,
      planDegraded: plan.degraded === true,
      touchedPaths: Array.isArray(touchedPaths) ? touchedPaths : [],
      testFileAudit,
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
  // Exportados para teste direto: a resolução dos candidatos é a fronteira que estava lendo a
  // fonte errada, e precisa ser verificável sem banco nem sandbox.
  resolveAvailableTestFiles,
  createWorkspaceReader,
};
