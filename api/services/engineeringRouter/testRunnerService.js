'use strict';

/**
 * api/services/engineeringRouter/testRunnerService.js
 *
 * Test Runner determinístico. O modelo NUNCA declara PASS — a autoridade é sempre o exitCode
 * real do processo. Todo comando passa pela allowlist (`engine/engineeringRouter/commandPolicy`)
 * antes de ser executado; comandos fora da allowlist são rejeitados sem execução. Evidência
 * (stdout/stderr completos) é persistida em disco, referenciada por caminho — o banco guarda
 * apenas um excerto + a referência.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseCommand } = require('../../../engine/engineeringRouter/commandPolicy');
const { buildSafeTestEnv } = require('./safeEngineeringEnvironment');
const { redactText } = require('../../../engine/engineeringRouter/secretRedaction');
const { ROOT } = require('./contextBuilderService');
// ER-V1-SEAL-003 (Dedicated Execution Runner): a API principal NUNCA mais importa
// `executionSandbox.js` diretamente (isso exigiria Docker CLI + socket do host dentro do
// processo da API). `engineeringRunnerClient.js` fala com o Engineering Runner — um serviço
// SEPARADO, o único autorizado a ter o Docker socket montado — via HTTP interno autenticado,
// preservando a MESMA assinatura e os MESMOS códigos de erro (SANDBOX_UNAVAILABLE/
// SANDBOX_INVALID_WORKSPACE) que `executionSandbox.runInSandbox` já tinha.
const { runInSandbox } = require('./engineeringRunnerClient');

const { TEST_OUTCOMES } = require('../../../engine/engineeringRouter/constants');
const { resolvePolicy } = require('../../utils/operationDeadline');

const EVIDENCE_ROOT = process.env.ENGINEERING_ROUTER_EVIDENCE_ROOT
  || path.join(ROOT, 'dev', 'engineering-router-v1', 'evidence');

const EXCERPT_LIMIT = 4000;

/**
 * Deadline de UM comando de teste — Timeout Policy Registry, nunca magic number. A política padrão
 * é `INTEGRATION_TEST` (default 120s, o mesmo valor que antes era hardcoded aqui); a regressão usa
 * `REGRESSION_COMMAND`. `ENGINEERING_ROUTER_TEST_TIMEOUT_MS` continua aceito como override, sempre
 * clampado em [min,max] da política. `timeoutMultiplier` é o deadline ADAPTATIVO pedido pelo Router
 * depois de um TIMEOUT (nunca ultrapassa o `max` da política).
 */
function resolveCommandDeadlineMs({ policy = 'INTEGRATION_TEST', timeoutMultiplier = 1 } = {}) {
  const legacy = Number(process.env.ENGINEERING_ROUTER_TEST_TIMEOUT_MS);
  const base = resolvePolicy(policy, { override: policy === 'INTEGRATION_TEST' && Number.isFinite(legacy) && legacy > 0 ? legacy : null });
  const multiplier = Number.isFinite(timeoutMultiplier) && timeoutMultiplier > 1 ? timeoutMultiplier : 1;
  if (multiplier === 1) return base.resolved;
  return resolvePolicy(policy, { override: Math.round(base.resolved * multiplier) }).resolved;
}

/** Compatibilidade: valor efetivo da política padrão (antes, constante hardcoded de 120000). */
const DEFAULT_TIMEOUT_MS = resolveCommandDeadlineMs();

/**
 * Semântica explícita de resultado (TEST_OUTCOMES). `timedOut` NUNCA vira FAIL: FAIL é o código
 * rodando e reprovando; TIMEOUT é a operação que não terminou no deadline; INFRA_ERROR é não ter
 * conseguido rodar (sandbox/runner indisponível); BLOCKED é recusa por política (allowlist).
 */
function classifyCommandOutcome(run) {
  if (run.code === 'SANDBOX_UNAVAILABLE' || run.code === 'SANDBOX_INVALID_WORKSPACE') return TEST_OUTCOMES.INFRA_ERROR;
  if (run.timedOut) return TEST_OUTCOMES.TIMEOUT;
  if (run.exitCode === 0) return TEST_OUTCOMES.PASS;
  if (run.exitCode === null || run.exitCode === undefined) return TEST_OUTCOMES.INFRA_ERROR;
  return TEST_OUTCOMES.FAIL;
}

function slugCommand(command) {
  return crypto.createHash('sha1').update(command).digest('hex').slice(0, 12);
}

async function runOneCommand(executable, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS, signal = null } = {}) {
  const startedAt = Date.now();

  // ERV1-CLOSE-001: allowlist estrutural de comando (nunca uma string interpretada por shell).
  // ERV1-CLOSE-002: env sandboxed (nunca o environment do processo pai inteiro).
  // ER-V1-FINAL-001: execução dentro de um container Docker descartável, non-root, sem rede,
  // sem docker socket, filesystem raiz read-only e limites de CPU/memória/PIDs — nunca mais um
  // `spawn` de host puro. Fail-closed: SANDBOX_UNAVAILABLE propaga como falha do comando, nunca
  // cai de volta para execução sem sandbox.
  try {
    const result = await runInSandbox({
      executable,
      args,
      cwd,
      env: buildSafeTestEnv({ cwd }),
      timeoutMs,
      signal,
    });
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      timedOut: result.timedOut,
      terminatedBy: result.terminatedBy || null,
    };
  } catch (err) {
    // Cancelamento cooperativo (lease perdido / NO_PROGRESS) não é resultado de teste: propaga
    // para o Router decidir (retry/parar) — nunca vira INFRA_ERROR nem FAIL.
    if (err.code === 'OPERATION_CANCELLED') throw err;
    return {
      exitCode: null,
      error: err.message,
      code: err.code,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Executa uma lista de comandos de teste do Task Contract dentro de um workspace isolado.
 * Comandos fora da allowlist NUNCA são executados — entram no resultado como REJECTED.
 *
 * @param {Object} params
 * @param {string} params.taskId
 * @param {number|string} params.attemptNumber
 * @param {string[]} params.commands
 * @param {string} params.cwd - workspace isolado (patchApplyService.createWorkspace)
 * @returns {Promise<{allPass:boolean, results:Object[]}>}
 */
async function runTestCommands({
  taskId,
  attemptNumber,
  commands,
  cwd,
  policy = 'INTEGRATION_TEST',
  timeoutMultiplier = 1,
  signal = null,
  onCommandCompleted = null,
}) {
  const timeoutMs = resolveCommandDeadlineMs({ policy, timeoutMultiplier });
  const evidenceDir = path.join(EVIDENCE_ROOT, String(taskId), `attempt-${attemptNumber}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const results = [];
  for (const command of commands || []) {
    const policyCheck = parseCommand(command);
    if (!policyCheck.allowed) {
      results.push({
        command,
        status: 'REJECTED',
        outcome: TEST_OUTCOMES.BLOCKED,
        exitCode: null,
        durationMs: 0,
        reason: policyCheck.reason,
        code: policyCheck.code,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      continue;
    }

    const startedAt = new Date();
    const run = await runOneCommand(policyCheck.executable, policyCheck.args, { cwd, timeoutMs, signal });
    const completedAt = new Date();
    const outcome = classifyCommandOutcome(run);

    // ER-V1-FINAL-001: sandbox indisponível (Docker inacessível) OU cwd inválido (repositório
    // principal em vez de um workspace isolado) são falhas de infraestrutura/uso indevido,
    // nunca um FAIL de teste — fail-closed explícito, nunca executa sem sandbox e nunca
    // confunde "não rodou" com "rodou e falhou".
    if (run.code === 'SANDBOX_UNAVAILABLE' || run.code === 'SANDBOX_INVALID_WORKSPACE') {
      results.push({
        command,
        status: run.code,
        outcome,
        exitCode: null,
        durationMs: run.durationMs,
        reason: run.error,
        code: run.code,
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      });
      continue;
    }

    // ERV1-CLOSE-002: toda saída passa por redação ANTES de tocar disco/DB/telemetria/UI —
    // um patch malicioso pode imprimir env/segredos mesmo dentro do env sandboxed (ex.: lendo
    // um arquivo do próprio workspace), então a saída em si nunca é confiável.
    const safeStdout = redactText(run.stdout || '');
    const safeStderr = redactText(run.stderr || '');

    const fileSlug = slugCommand(command);
    const stdoutFile = path.join(evidenceDir, `${fileSlug}.stdout.log`);
    const stderrFile = path.join(evidenceDir, `${fileSlug}.stderr.log`);
    try {
      fs.writeFileSync(stdoutFile, safeStdout, 'utf8');
      fs.writeFileSync(stderrFile, safeStderr, 'utf8');
    } catch (_) { /* evidência é best-effort quanto à persistência em disco */ }

    results.push({
      command,
      status: outcome,
      outcome,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      timedOut: Boolean(run.timedOut),
      deadlineMs: timeoutMs,
      terminatedBy: run.terminatedBy || null,
      stdoutRef: path.relative(ROOT, stdoutFile),
      stderrRef: path.relative(ROOT, stderrFile),
      stdoutExcerpt: safeStdout.slice(-EXCERPT_LIMIT),
      stderrExcerpt: safeStderr.slice(-EXCERPT_LIMIT),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
    if (typeof onCommandCompleted === 'function') {
      try { await onCommandCompleted(results[results.length - 1]); } catch (_) { /* progresso é best-effort */ }
    }
  }

  const allPass = results.length > 0 && results.every((r) => r.status === 'PASS');
  // Veredito agregado com a MESMA semântica: um INFRA_ERROR domina (nada foi provado), depois
  // TIMEOUT, depois FAIL. Nunca "FAIL" genérico para o que foi timeout ou infraestrutura.
  const outcomes = results.map((r) => r.outcome || r.status);
  const aggregateOutcome = allPass ? TEST_OUTCOMES.PASS
    : outcomes.includes(TEST_OUTCOMES.INFRA_ERROR) ? TEST_OUTCOMES.INFRA_ERROR
      : outcomes.includes(TEST_OUTCOMES.TIMEOUT) ? TEST_OUTCOMES.TIMEOUT
        : outcomes.includes(TEST_OUTCOMES.BLOCKED) ? TEST_OUTCOMES.BLOCKED
          : TEST_OUTCOMES.FAIL;
  return { allPass, results, outcome: aggregateOutcome, deadlineMs: timeoutMs };
}

module.exports = {
  EVIDENCE_ROOT,
  DEFAULT_TIMEOUT_MS,
  resolveCommandDeadlineMs,
  classifyCommandOutcome,
  runTestCommands,
};
