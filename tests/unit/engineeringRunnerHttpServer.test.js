'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — servidor HTTP do Engineering Runner, real e
 * completo (porta efêmera real, requisições HTTP reais via `fetch`), provando: fail-closed sem
 * token configurado (config.js), autenticação Bearer obrigatória em /execute, /health nunca
 * autenticado, e validação estrutural do contrato (nunca aceita shell arbitrário/args fora do
 * formato esperado).
 */

const { loadConfig } = require('../../services/engineering-runner/src/config');
const { createHttpServer } = require('../../services/engineering-runner/src/httpServer');

describe('ER-V1-SEAL-003 — services/engineering-runner/src/config.js (fail-closed)', () => {
  test('sobe sem ENGINEERING_RUNNER_TOKEN → lança explicitamente, nunca sobe anônimo', () => {
    expect(() => loadConfig({}, {})).toThrow(/ENGINEERING_RUNNER_TOKEN ausente/);
  });

  test('token vazio é tratado como ausente', () => {
    expect(() => loadConfig({ ENGINEERING_RUNNER_TOKEN: '' }, {})).toThrow(/ENGINEERING_RUNNER_TOKEN ausente/);
  });

  test('com token válido, config carrega com defaults sãos', () => {
    const config = loadConfig({ ENGINEERING_RUNNER_TOKEN: 'abc' }, {});
    expect(config.authToken).toBe('abc');
    expect(config.port).toBe(8090);
    expect(config.maxTimeoutMs).toBeGreaterThan(0);
  });

  test('ENGINEERING_RUNNER_MAX_TIMEOUT_MS fora do intervalo permitido é rejeitado', () => {
    expect(() => loadConfig({ ENGINEERING_RUNNER_TOKEN: 'abc', ENGINEERING_RUNNER_MAX_TIMEOUT_MS: '999999999' }, {})).toThrow(/ENGINEERING_RUNNER_MAX_TIMEOUT_MS/);
  });
});

describe('ER-V1-SEAL-003 — servidor HTTP do Engineering Runner (real, porta efêmera)', () => {
  let http;
  let baseUrl;
  const TOKEN = 'jest-unit-engineering-runner-token';

  beforeAll(async () => {
    const config = loadConfig({ ENGINEERING_RUNNER_TOKEN: TOKEN, ENGINEERING_RUNNER_PORT: '0' }, {});
    http = createHttpServer({ config, logger: { error: () => {} } });
    await http.start();
    const address = http.server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await http.stop();
  });

  test('GET /health nunca exige autenticação e sempre responde 200', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.sandboxAvailable).toBe('boolean');
  });

  test('POST /execute sem Authorization → 401, nunca executa nada', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: ['a'], cwd: '/tmp' }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /execute com Bearer token errado → 401', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-errado' },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: ['a'], cwd: '/tmp' }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /execute autenticado mas com contrato inválido (args não é array) → 400, nunca tenta executar', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: 'nao-e-array', cwd: '/tmp' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_execute_contract');
  });

  test('POST /execute autenticado, sem executionId → 400 (contrato estruturado é obrigatório, nunca inferido)', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ executable: 'echo', args: ['a'], cwd: '/tmp' }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /execute com timeoutMs acima do teto configurado → 400, nunca aceito silenciosamente', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ executionId: 'x', executable: 'echo', args: ['a'], cwd: '/tmp', timeoutMs: 999999999 }),
    });
    expect(res.status).toBe(400);
  });

  test('corpo não é JSON válido → 400 explícito', async () => {
    const res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: '{ isso nao é json',
    });
    expect(res.status).toBe(400);
  });

  test('rota inexistente → 404', async () => {
    const res = await fetch(`${baseUrl}/rota-que-nao-existe`);
    expect(res.status).toBe(404);
  });
});
