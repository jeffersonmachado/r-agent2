/**
 * Testes do cache lazy de index.html no frontend-fallback:
 * - leitura do disco apenas no primeiro acesso (e quando o mtime muda)
 * - stat assíncrono limitado pelo TTL
 * - comportamento de erro preservado quando o arquivo não existe
 */

'use strict';

const path = require('path');
const { createFrontendFallbackRoutes, _internal } = require('../../api/modules/frontend-fallback/routes');

function makeDeps({ html = '<html>app</html>', mtimeMs = 1000, failStat = false } = {}) {
  const state = { html, mtimeMs, failStat };
  const calls = { stat: 0, readFile: 0, warn: 0 };
  const fs = {
    promises: {
      stat: async () => {
        calls.stat++;
        if (state.failStat) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
        return { isFile: () => true, mtimeMs: state.mtimeMs };
      },
      readFile: async () => {
        calls.readFile++;
        return state.html;
      },
    },
  };
  const logger = {
    debug: () => {},
    info: () => {},
    warn: () => { calls.warn++; },
    error: () => {},
  };
  return { deps: { fs, path, logger }, calls, state };
}

function runRequest(router) {
  return new Promise((resolve) => {
    const req = {
      originalUrl: '/app/dashboard',
      url: '/app/dashboard',
      method: 'GET',
      headers: { accept: 'application/json' },
    };
    const res = {
      statusCode: null,
      body: null,
      writeHead(code) { this.statusCode = code; },
      end(body) { this.body = body; resolve({ served: true, res }); },
    };
    router.handle(req, res, () => resolve({ served: false, res }));
  });
}

describe('frontend-fallback - cache de index.html', () => {
  beforeEach(() => {
    _internal.clearIndexHtmlCache();
  });

  test('lê o arquivo do disco apenas no primeiro acesso', async () => {
    const { deps, calls } = makeDeps();
    const router = createFrontendFallbackRoutes({ buildDeps: () => deps });

    const r1 = await runRequest(router);
    const r2 = await runRequest(router);

    expect(r1.served).toBe(true);
    expect(r2.served).toBe(true);
    expect(r1.res.body).toBe('<html>app</html>');
    expect(r2.res.body).toBe('<html>app</html>');
    expect(calls.readFile).toBe(1);
    // Dentro do TTL, nem o stat é repetido
    expect(calls.stat).toBe(1);
  });

  test('recarrega quando o mtime muda após o TTL do stat', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    try {
      const { deps, calls, state } = makeDeps();
      const router = createFrontendFallbackRoutes({ buildDeps: () => deps });

      await runRequest(router);
      expect(calls.readFile).toBe(1);

      // Avança além do TTL do stat e altera o arquivo (mtime + conteúdo)
      jest.setSystemTime(Date.now() + 6 * 1000);
      state.mtimeMs = 2000;
      state.html = '<html>app-v2</html>';

      const r2 = await runRequest(router);
      expect(r2.res.body).toBe('<html>app-v2</html>');
      expect(calls.stat).toBe(2);
      expect(calls.readFile).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('mantém comportamento quando o arquivo não existe (warn + next)', async () => {
    const { deps, calls } = makeDeps({ failStat: true });
    const router = createFrontendFallbackRoutes({ buildDeps: () => deps });

    const r = await runRequest(router);

    expect(r.served).toBe(false);
    expect(calls.warn).toBe(1);
    expect(calls.readFile).toBe(0);
  });
});
