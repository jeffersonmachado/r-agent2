'use strict';

/**
 * Regressão: POST /rpa-tests era uma rota morta e sem autenticação.
 *
 * Falha observada (sondagem 2026-07-27):
 * 1. O guard `pathname.startsWith('/flows/')` tornava o branch `/rpa-tests`
 *    inalcançável — o endpoint sempre caía em 404, apesar de o frontend
 *    (frontend/src/api/flows.js) chamá-lo.
 * 2. O branch não verificava autenticação antes de gravar arquivo em disco
 *    (seeds RPA) — escrita arbitrária não autenticada.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleRpaTestGenerationRoutes,
} = require('../../api/modules/domain-flow/flow-execution/rpaTestGenerationRoutes');

function makeReq(body) {
  const stream = require('stream');
  const payload = JSON.stringify(body || {});
  const req = new stream.Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  req.headers = { 'content-type': 'application/json' };
  req.method = 'POST';
  req.url = '/rpa-tests';
  req.originalUrl = '/rpa-tests';
  return req;
}

function makeRes() {
  return { statusCode: null, body: null, writableEnded: false };
}

function baseDeps(overrides) {
  return {
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.body = payload;
      res.writableEnded = true;
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.body = { error: 'bad_request', message };
      res.writableEnded = true;
    },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => {
      let data = '';
      for await (const chunk of req) data += chunk;
      return JSON.parse(data || '{}');
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    flows: new Map(),
    requireAuth: () => ({ valid: true, agent: { id: 'qa-agent' } }),
    requireTenant: () => 'system',
    STRICT_TENANT_MODE: true,
    ...overrides,
  };
}

function validRpaPlan(id) {
  return {
    id,
    version: '1.0',
    type: 'rpa_test_plan',
    context: { application: 'rap', mode: 'test-only' },
    steps: [{ action: 'navigate', target: 'https://example.com' }],
    assertions: [{ type: 'url_contains', value: 'example.com' }],
  };
}

describe('POST /rpa-tests — rota alcançável e autenticada', () => {
  let runtimeRoot;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-tests-route-'));
    process.env.RUNTIME_ROOT = runtimeRoot;
  });

  afterEach(() => {
    delete process.env.RUNTIME_ROOT;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('requisição anônima retorna 401 e não grava arquivo', async () => {
    const deps = baseDeps({
      requireAuth: () => ({ valid: false, error: 'missing token' }),
    });
    const res = makeRes();
    const handled = await handleRpaTestGenerationRoutes({
      req: makeReq({ rpaTest: validRpaPlan('rpa-anon-blocked') }),
      res,
      method: 'POST',
      pathname: '/rpa-tests',
      deps,
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(res.body).toHaveProperty('error', 'unauthorized');
    expect(fs.existsSync(path.join(runtimeRoot, 'rpa', 'seeds', 'rpa-anon-blocked.json'))).toBe(false);
  });

  test('plano inválido retorna 400 (rota alcançável de ponta a ponta)', async () => {
    const res = makeRes();
    const handled = await handleRpaTestGenerationRoutes({
      req: makeReq({ rpaTest: { id: 'rpa-invalid', type: 'rpa_test_plan' } }),
      res,
      method: 'POST',
      pathname: '/rpa-tests',
      deps: baseDeps(),
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
  });

  test('plano válido autenticado retorna 200 e grava o seed', async () => {
    const res = makeRes();
    const handled = await handleRpaTestGenerationRoutes({
      req: makeReq({ rpaTest: validRpaPlan('rpa-qa-route-ok') }),
      res,
      method: 'POST',
      pathname: '/rpa-tests',
      deps: baseDeps(),
    });
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('testId', 'rpa-qa-route-ok');
    expect(fs.existsSync(path.join(runtimeRoot, 'rpa', 'seeds', 'rpa-qa-route-ok.json'))).toBe(true);
  });

  test('branch /flows/:id/generate-rpa-test continua roteável', async () => {
    const res = makeRes();
    const handled = await handleRpaTestGenerationRoutes({
      req: makeReq({}),
      res,
      method: 'POST',
      pathname: '/flows/flow-x/generate-rpa-test',
      deps: baseDeps(),
    });
    // Fluxo inexistente deve responder 404 tratado (não cair para next())
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
  });
});
