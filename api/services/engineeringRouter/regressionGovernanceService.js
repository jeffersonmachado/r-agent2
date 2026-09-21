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
const { ROOT } = require('./contextBuilderService');

const execFileAsync = util.promisify(execFile);

/**
 * @param {string} attemptId
 * @returns {Promise<{pass:boolean, evidence:Object}>}
 */
async function checkRegression(attemptId) {
  const testRuns = await engineeringTaskService.listTestRuns(attemptId);
  const checkedAt = new Date().toISOString();

  if (testRuns.length === 0) {
    return {
      pass: false,
      evidence: { checkedAt, testRunCount: 0, reason: 'Nenhum EngineeringTestRun persistido para esta tentativa' },
    };
  }

  const failed = testRuns.filter((r) => r.status !== 'PASS' || r.exit_code !== 0);
  return {
    pass: failed.length === 0,
    evidence: {
      checkedAt,
      testRunCount: testRuns.length,
      allPass: failed.length === 0,
      commands: testRuns.map((r) => ({ command: r.command, status: r.status, exitCode: r.exit_code })),
      failed: failed.map((r) => ({ command: r.command, status: r.status, exitCode: r.exit_code })),
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
