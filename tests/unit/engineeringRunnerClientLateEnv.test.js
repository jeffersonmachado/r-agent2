'use strict';

/**
 * CONFIGURAÇÃO DE RUNNER LIDA EM TEMPO DE CHAMADA — regressão adversarial.
 *
 * DEFEITO REAL MEDIDO (2026-10-20, lote autoritativo): `engineeringRunnerClient.js` congelava
 * `ENGINEERING_RUNNER_URL` no `require` do módulo. O `.env` traz `127.0.0.1:8090` e o `globalSetup`
 * do Jest sobe o runner de teste em `127.0.0.1:8097`, exportando a variável DEPOIS — então o cliente
 * falava com a porta errada e a fix task morria em
 * `SANDBOX_UNAVAILABLE ... :8090: fetch failed (fail-closed)`, um diagnóstico que aponta para um
 * Docker caído quando a causa é URL congelada.
 *
 * Aqui se prova, nos dois sentidos: (a) valor definido DEPOIS do require é usado; (b) o valor
 * ANTERIOR não fica grudado, nem corrompe o token.
 */

describe('engineeringRunnerClient — env resolvida na chamada, nunca no load do módulo', () => {
  const originalUrl = process.env.ENGINEERING_RUNNER_URL;
  const originalToken = process.env.ENGINEERING_RUNNER_TOKEN;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.ENGINEERING_RUNNER_URL; else process.env.ENGINEERING_RUNNER_URL = originalUrl;
    if (originalToken === undefined) delete process.env.ENGINEERING_RUNNER_TOKEN; else process.env.ENGINEERING_RUNNER_TOKEN = originalToken;
    global.fetch = originalFetch;
    jest.resetModules();
  });

  test('URL/token definidos DEPOIS do require são os usados na chamada', async () => {
    delete process.env.ENGINEERING_RUNNER_URL;
    delete process.env.ENGINEERING_RUNNER_TOKEN;
    jest.resetModules();

    // eslint-disable-next-line global-require
    const client = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    expect(client.isRunnerConfigured()).toBe(false);

    // O `globalSetup` real define a env DEPOIS de o módulo já estar no cache.
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:8097';
    process.env.ENGINEERING_RUNNER_TOKEN = 'late-token';
    expect(client.isRunnerConfigured()).toBe(true);

    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
    });
    global.fetch = fetchSpy;

    const result = await client.runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' });
    expect(result.exitCode).toBe(0);

    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe('http://127.0.0.1:8097/execute');
    expect(init.headers.Authorization).toBe('Bearer late-token');
  });

  test('trocar a URL entre duas chamadas troca o destino (nada fica congelado)', async () => {
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:8090';
    process.env.ENGINEERING_RUNNER_TOKEN = 'token-a';
    jest.resetModules();

    // eslint-disable-next-line global-require
    const client = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    });
    global.fetch = fetchSpy;

    await client.runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' });
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:8097';
    await client.runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' });

    expect(fetchSpy.mock.calls[0][0]).toBe('http://127.0.0.1:8090/execute');
    expect(fetchSpy.mock.calls[1][0]).toBe('http://127.0.0.1:8097/execute');
  });

  test('a mensagem de indisponibilidade nomeia a URL REAL do momento da falha', async () => {
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:8090';
    process.env.ENGINEERING_RUNNER_TOKEN = 'token-a';
    jest.resetModules();

    // eslint-disable-next-line global-require
    const client = require('../../api/services/engineeringRouter/engineeringRunnerClient');
    process.env.ENGINEERING_RUNNER_URL = 'http://127.0.0.1:8097';
    global.fetch = jest.fn().mockRejectedValue(new Error('fetch failed'));

    await expect(client.runInSandbox({ executable: 'echo', args: ['a'], cwd: '/tmp' }))
      .rejects.toThrow(/8097/);
  });
});
