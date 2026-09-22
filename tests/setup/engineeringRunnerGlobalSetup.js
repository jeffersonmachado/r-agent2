'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — globalSetup do Jest.
 *
 * Sobe o Engineering Runner REAL (services/engineering-runner/src/index.js) como processo
 * SEPARADO antes de toda a suíte de testes — a mesma separação de processo que existe em
 * produção (API principal nunca chama `executionSandbox.js` diretamente; fala com o runner via
 * HTTP). `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` setados aqui em `process.env` são
 * herdados pelos workers do Jest (mesmo processo principal do Jest CLI que spawna os workers).
 *
 * PID do processo do runner é persistido em disco (o globalSetup roda e termina antes da suíte
 * — não sobrevive para o globalTeardown localizar o processo por referência em memória).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', '..');
const PID_FILE = path.join(ROOT, '.jest-engineering-runner.pid');
const RUNNER_PORT = Number(process.env.ENGINEERING_RUNNER_TEST_PORT || 8097);
const RUNNER_TOKEN = 'jest-test-engineering-runner-token';
const READY_TIMEOUT_MS = 15000;

function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) { resolve(); return; }
        retry();
      });
      req.on('error', retry);
    };
    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Engineering Runner não respondeu /health dentro de ${timeoutMs}ms`));
        return;
      }
      setTimeout(attempt, 200);
    };
    attempt();
  });
}

module.exports = async function engineeringRunnerGlobalSetup() {
  const child = spawn(process.execPath, [path.join(ROOT, 'services', 'engineering-runner', 'src', 'index.js')], {
    cwd: ROOT,
    env: {
      ...process.env,
      ENGINEERING_RUNNER_TOKEN: RUNNER_TOKEN,
      ENGINEERING_RUNNER_PORT: String(RUNNER_PORT),
    },
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: false,
  });

  fs.writeFileSync(PID_FILE, String(child.pid));

  await waitForHealth(`http://127.0.0.1:${RUNNER_PORT}/health`, READY_TIMEOUT_MS);

  process.env.ENGINEERING_RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`;
  process.env.ENGINEERING_RUNNER_TOKEN = RUNNER_TOKEN;

  // eslint-disable-next-line no-console
  console.log(`[jest-global-setup] Engineering Runner real (pid ${child.pid}) pronto em http://127.0.0.1:${RUNNER_PORT}`);
};

module.exports.PID_FILE = PID_FILE;
module.exports.RUNNER_PORT = RUNNER_PORT;
module.exports.RUNNER_TOKEN = RUNNER_TOKEN;
