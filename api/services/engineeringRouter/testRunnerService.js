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
const { runInSandbox } = require('./executionSandbox');

const EVIDENCE_ROOT = process.env.ENGINEERING_ROUTER_EVIDENCE_ROOT
  || path.join(ROOT, 'dev', 'engineering-router-v1', 'evidence');

const DEFAULT_TIMEOUT_MS = Number(process.env.ENGINEERING_ROUTER_TEST_TIMEOUT_MS || 120000);
const EXCERPT_LIMIT = 4000;

function slugCommand(command) {
  return crypto.createHash('sha1').update(command).digest('hex').slice(0, 12);
}

async function runOneCommand(executable, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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
    });
    return {
      exitCode: result.exitCode,
      signal: result.signal,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
      timedOut: result.timedOut,
    };
  } catch (err) {
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
async function runTestCommands({ taskId, attemptNumber, commands, cwd }) {
  const evidenceDir = path.join(EVIDENCE_ROOT, String(taskId), `attempt-${attemptNumber}`);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const results = [];
  for (const command of commands || []) {
    const policyCheck = parseCommand(command);
    if (!policyCheck.allowed) {
      results.push({
        command,
        status: 'REJECTED',
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
    const run = await runOneCommand(policyCheck.executable, policyCheck.args, { cwd });
    const completedAt = new Date();

    // ER-V1-FINAL-001: sandbox indisponível (Docker inacessível) OU cwd inválido (repositório
    // principal em vez de um workspace isolado) são falhas de infraestrutura/uso indevido,
    // nunca um FAIL de teste — fail-closed explícito, nunca executa sem sandbox e nunca
    // confunde "não rodou" com "rodou e falhou".
    if (run.code === 'SANDBOX_UNAVAILABLE' || run.code === 'SANDBOX_INVALID_WORKSPACE') {
      results.push({
        command,
        status: run.code,
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
      status: run.exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      stdoutRef: path.relative(ROOT, stdoutFile),
      stderrRef: path.relative(ROOT, stderrFile),
      stdoutExcerpt: safeStdout.slice(-EXCERPT_LIMIT),
      stderrExcerpt: safeStderr.slice(-EXCERPT_LIMIT),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    });
  }

  const allPass = results.length > 0 && results.every((r) => r.status === 'PASS');
  return { allPass, results };
}

module.exports = {
  EVIDENCE_ROOT,
  DEFAULT_TIMEOUT_MS,
  runTestCommands,
};
