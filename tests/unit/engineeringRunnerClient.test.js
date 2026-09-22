'use strict';

/**
 * ER-V1-SEAL-003 (Dedicated Execution Runner) — `engineeringRunnerClient.js`, o único ponto do
 * lado da API que fala com o Engineering Runner. Prova a garantia FAIL-CLOSED central da
 * missão: sem runner configurado, ou com o runner indisponível/em erro, a task NUNCA roda no
 * host como fallback — sempre `SANDBOX_UNAVAILABLE` explícito.
 */

describe('ER-V1-SEAL-003 — engineeringRunnerClient (fail-closed, nunca fallback local)', () => {
  const originalUrl = process.env.ENGINEERING_RUNNER_URL;
  const originalToken = process.env.ENGINEERING_RUNNER_TOKEN;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.ENGINEERING_RUNNER_URL; else process.env.ENGINEERING_RUNNER_URL = originalUrl;
    if (originalToken === undefined) delete process.env.ENGINEERING_RUNNER_TOKEN; else process.env.ENGINEERING_RUNNER_TOKEN = originalToken;
    global.fetch = originalFetch;
    jest.resetModules();
  });

  test('sem ENGINEERING_RUNNER_URL/TOKEN configurados → SANDBOX_UNAVAILABLE imediato, nunca tenta rede', async () => {
    delete process.env.ENGINEERING_RUNNER_URL;
    delete process.env.ENGINEERING_RUNNER_TOKEN;
    jest.resetModules();
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    // eslint-disable-next-line global-require
    const { runInSandbox } = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    await expect(runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' })).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('runner configurado mas inalcançável (fetch rejeita) → SANDBOX_UNAVAILABLE, nunca lança erro cru nem executa localmente', async () => {
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:1';
    process.env.ENGINEERING_RUNNER_TOKEN = 'fake-token';
    jest.resetModules();
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    // eslint-disable-next-line global-require
    const { runInSandbox } = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    await expect(runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' })).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
  });

  test('runner responde com erro estruturado (ex.: SANDBOX_INVALID_WORKSPACE) → o mesmo .code é preservado, nunca mascarado', async () => {
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:9';
    process.env.ENGINEERING_RUNNER_TOKEN = 'fake-token';
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: 'cwd inválido', code: 'SANDBOX_INVALID_WORKSPACE' }),
    });

    // eslint-disable-next-line global-require
    const { runInSandbox } = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    await expect(runInSandbox({ executable: 'echo', args: ['a'], cwd: '/opt/results/ria/r-agent2' })).rejects.toMatchObject({ code: 'SANDBOX_INVALID_WORKSPACE' });
  });

  test('runner responde 200 com contrato válido → retorna exitCode/stdout/stderr, envia Bearer correto', async () => {
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:9';
    process.env.ENGINEERING_RUNNER_TOKEN = 'fake-token-real';
    jest.resetModules();
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ executionId: 'x', exitCode: 0, durationMs: 10, stdout: 'ok\n', stderr: '', timedOut: false, signal: null }),
    });
    global.fetch = fetchSpy;

    // eslint-disable-next-line global-require
    const { runInSandbox } = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    const result = await runInSandbox({ executable: 'echo', args: ['ok'], cwd: '/tmp', timeoutMs: 5000 });

    expect(result).toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '', timedOut: false, signal: null });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9/execute');
    expect(init.headers.Authorization).toBe('Bearer fake-token-real');
    const sentBody = JSON.parse(init.body);
    expect(sentBody.executable).toBe('echo');
    expect(sentBody.cwd).toBe('/tmp');
  });

  test('resposta não é JSON válido → SANDBOX_UNAVAILABLE, nunca lança um erro de parse cru', async () => {
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:9';
    process.env.ENGINEERING_RUNNER_TOKEN = 'fake-token';
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => { throw new Error('unexpected token'); },
    });

    // eslint-disable-next-line global-require
    const { runInSandbox } = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    await expect(runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' })).rejects.toMatchObject({ code: 'SANDBOX_UNAVAILABLE' });
  });
});
