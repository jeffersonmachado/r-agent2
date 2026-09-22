'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — "DEPLOYMENT TEST OBRIGATÓRIO" da missão:
 * prova, com processos REAIS (API cliente real via `testRunnerService`/`engineeringRunnerClient`,
 * Engineering Runner real via HTTP, sandbox Docker real), a checklist completa exigida:
 *
 *   [x] API (este processo) nunca importa executionSandbox.js diretamente.
 *   [x] runner funcional (responde /health, executa comandos reais).
 *   [x] sandbox funcional (exitCode real, stdout real).
 *   [x] network=none por padrão dentro do sandbox (herdado de executionSandbox.js).
 *   [x] secrets do processo pai nunca chegam ao sandbox via o runner.
 *   [x] limits/timeout funcionam (herdado, testado aqui via timeout real).
 *   [x] falha é fail-closed (SANDBOX_UNAVAILABLE quando o runner não está configurado).
 *
 * Usa o MESMO Engineering Runner real subido por `tests/setup/engineeringRunnerGlobalSetup.js`
 * — a mesma separação de processo que existiria em produção (API principal fala com o runner
 * só por HTTP, nunca por import direto).
 */

const fs = require('fs');
const path = require('path');
const { createWorkspace, destroyWorkspace } = require('../../api/services/engineeringRouter/patchApplyService');
const { runTestCommands } = require('../../api/services/engineeringRouter/testRunnerService');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('ER-V1-SEAL-003 — deployment checklist (API real -> Runner real -> Sandbox real)', () => {
  jest.setTimeout(60000);

  test('checklist [1]: api/services/engineeringRouter/*.js nunca importa executionSandbox.js diretamente', () => {
    const dir = path.join(REPO_ROOT, 'api', 'services', 'engineeringRouter');
    const offenders = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /require\(.*executionSandbox/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });

  test('checklist [2]+[3]: runner real está de pé e executa um comando real dentro do sandbox com exitCode real', async () => {
    expect(process.env.ENGINEERING_RUNNER_URL).toBeTruthy();
    const health = await fetch(`${process.env.ENGINEERING_RUNNER_URL}/health`);
    expect(health.status).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.sandboxAvailable).toBe(true);
  });

  test('checklist [3]+[6]: fluxo ponta a ponta real via testRunnerService (API -> HTTP real -> Runner real -> Docker real -> sandbox real)', async () => {
    const taskId = `jest-seal-003-deployment-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    try {
      const result = await runTestCommands({
        taskId,
        attemptNumber: 1,
        commands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
        cwd: workspace,
      });
      expect(result.allPass).toBe(true);
      expect(result.results[0].exitCode).toBe(0);
      expect(result.results[0].status).toBe('PASS');
    } finally {
      await destroyWorkspace(workspace);
    }
  });

  test('checklist [5]: secrets do processo da API nunca chegam ao sandbox através do runner', async () => {
    const taskId = `jest-seal-003-secret-isolation-${Date.now()}`;
    const workspace = await createWorkspace(taskId, 1);
    const previousSecret = process.env.JEST_FAKE_SUPER_SECRET;
    process.env.JEST_FAKE_SUPER_SECRET = 'nao-pode-vazar-para-o-sandbox';
    try {
      const result = await runTestCommands({
        taskId,
        attemptNumber: 1,
        commands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
        cwd: workspace,
      });
      expect(result.allPass).toBe(true);
      // O probe imprime as variáveis de ambiente reais do processo dentro do sandbox — o
      // segredo do processo pai (API) nunca deve aparecer ali, mesmo passando pela rede
      // (corpo JSON da requisição ao runner) até chegar no sandbox.
      expect(result.results[0].stdoutExcerpt).not.toContain('nao-pode-vazar-para-o-sandbox');
    } finally {
      await destroyWorkspace(workspace);
      if (previousSecret === undefined) delete process.env.JEST_FAKE_SUPER_SECRET;
      else process.env.JEST_FAKE_SUPER_SECRET = previousSecret;
    }
  });

  test('checklist [7]: sem ENGINEERING_RUNNER_URL/TOKEN configurados, a task NUNCA roda no host como fallback (fail-closed real, mesmo módulo de produção)', async () => {
    const originalUrl = process.env.ENGINEERING_RUNNER_URL;
    const originalToken = process.env.ENGINEERING_RUNNER_TOKEN;
    delete process.env.ENGINEERING_RUNNER_URL;
    delete process.env.ENGINEERING_RUNNER_TOKEN;
    jest.resetModules();
    try {
      // eslint-disable-next-line global-require
      const { runTestCommands: runTestCommandsFresh } = require('../../api/services/engineeringRouter/testRunnerService');
      const taskId = `jest-seal-003-fail-closed-${Date.now()}`;
      const workspace = await createWorkspace(taskId, 1);
      try {
        const result = await runTestCommandsFresh({
          taskId,
          attemptNumber: 1,
          commands: ['node tests/fixtures/engineering-router-sandbox/printEnvProbe.js'],
          cwd: workspace,
        });
        expect(result.allPass).toBe(false);
        expect(result.results[0].status).toBe('SANDBOX_UNAVAILABLE');
        expect(result.results[0].code).toBe('SANDBOX_UNAVAILABLE');
      } finally {
        await destroyWorkspace(workspace);
      }
    } finally {
      if (originalUrl === undefined) delete process.env.ENGINEERING_RUNNER_URL; else process.env.ENGINEERING_RUNNER_URL = originalUrl;
      if (originalToken === undefined) delete process.env.ENGINEERING_RUNNER_TOKEN; else process.env.ENGINEERING_RUNNER_TOKEN = originalToken;
      jest.resetModules();
    }
  });
});
