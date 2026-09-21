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

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { checkCommand } = require('../../../engine/engineeringRouter/commandPolicy');
const { ROOT } = require('./contextBuilderService');

const EVIDENCE_ROOT = process.env.ENGINEERING_ROUTER_EVIDENCE_ROOT
  || path.join(ROOT, 'dev', 'engineering-router-v1', 'evidence');

const DEFAULT_TIMEOUT_MS = Number(process.env.ENGINEERING_ROUTER_TEST_TIMEOUT_MS || 120000);
const EXCERPT_LIMIT = 4000;

function slugCommand(command) {
  return crypto.createHash('sha1').update(command).digest('hex').slice(0, 12);
}

function runOneCommand(command, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(command, {
      cwd,
      shell: true,
      timeout: timeoutMs,
      env: { ...process.env },
    });

    child.stdout?.on('data', (d) => { stdout += d.toString(); });
    child.stderr?.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        exitCode: code,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut: signal === 'SIGTERM' && (Date.now() - startedAt) >= timeoutMs,
      });
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ exitCode: null, error: err.message, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
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
    const policyCheck = checkCommand(command);
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
    const run = await runOneCommand(command, { cwd });
    const completedAt = new Date();

    const fileSlug = slugCommand(command);
    const stdoutFile = path.join(evidenceDir, `${fileSlug}.stdout.log`);
    const stderrFile = path.join(evidenceDir, `${fileSlug}.stderr.log`);
    try {
      fs.writeFileSync(stdoutFile, run.stdout || '', 'utf8');
      fs.writeFileSync(stderrFile, run.stderr || '', 'utf8');
    } catch (_) { /* evidência é best-effort quanto à persistência em disco */ }

    results.push({
      command,
      status: run.exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      stdoutRef: path.relative(ROOT, stdoutFile),
      stderrRef: path.relative(ROOT, stderrFile),
      stdoutExcerpt: (run.stdout || '').slice(-EXCERPT_LIMIT),
      stderrExcerpt: (run.stderr || '').slice(-EXCERPT_LIMIT),
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
