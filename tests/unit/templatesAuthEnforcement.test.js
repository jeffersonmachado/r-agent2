'use strict';

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');

/**
 * Regressão de segurança (falha observada em 2026-08-03): as rotas de
 * /templates em handleTemplatesRoutes destruturavam requireAuth/requirePermission
 * dos deps mas NUNCA os chamavam. Prova ao vivo antes da correção:
 *
 *   curl -X DELETE http://localhost:3001/templates/qa-auth-probe
 *   → 200 {"success":true} — arquivo de runtime REMOVIDO sem credencial.
 *
 * Comportamento correto (mesmo padrão de handleFlowTemplateMarketplaceRoutes):
 * - qualquer rota /templates exige autenticação (401 sem token válido);
 * - leitura exige flows:read; escrita (POST/DELETE) exige flows:update (403);
 * - nenhum efeito colateral (arquivo criado/removido) antes da autorização.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleTemplatesRoutes } = require('../../api/modules/platform-content/handleTemplatesRoutes');

let runtimeRoot;

function makeRes() {
  return { statusCode: null, body: null };
}

function deps(overrides = {}) {
  return {
    requireAuth: () => ({ valid: true }),
    requirePermission: () => ({ allowed: true }),
    sendJson: (res, status, payload) => { res.statusCode = status; res.body = payload; },
    badRequest: (res, message) => { res.statusCode = 400; res.body = { error: 'bad_request', message }; },
    hasJsonContentType: () => true,
    parseJsonBody: async () => overrides.__body || {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    validateFlow: () => ({ valid: true, errors: [] }),
    validateVoiceFlow: () => ({ valid: true, errors: [] }),
    ...overrides,
  };
}

function ctxFor(method, pathname, depOverrides = {}) {
  return {
    req: { headers: {} },
    res: makeRes(),
    method,
    pathname,
    deps: deps(depOverrides),
  };
}

const ANON = {
  requireAuth: () => ({ valid: false, error: 'token ausente ou inválido' }),
};

const SAMPLE = {
  id: 'template-auth-probe',
  name: 'Template probe de auth',
  flow: { kind: 'chat', nodes: [{ id: 'n1' }] },
};

beforeAll(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-auth-'));
  configureRuntimeRoot(runtimeRoot);
});

afterAll(() => {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
});

describe('handleTemplatesRoutes — enforcement de autenticação e autorização', () => {
  test('DELETE anônimo é rejeitado com 401 e NÃO remove o arquivo', async () => {
    const templatesDir = path.join(runtimeRoot, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const target = path.join(templatesDir, 'template-auth-probe.json');
    fs.writeFileSync(target, JSON.stringify(SAMPLE), 'utf8');

    const ctx = ctxFor('DELETE', '/templates/template-auth-probe', ANON);
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body.error).toBe('unauthorized');
    expect(fs.existsSync(target)).toBe(true); // efeito colateral NÃO pode ocorrer
  });

  test('POST anônimo é rejeitado com 401 e NÃO grava arquivo', async () => {
    const ctx = ctxFor('POST', '/templates', { ...ANON, __body: { ...SAMPLE, id: 'template-auth-probe-post' } });
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(fs.existsSync(path.join(runtimeRoot, 'templates', 'template-auth-probe-post.json'))).toBe(false);
  });

  test('GET /templates anônimo é rejeitado com 401', async () => {
    const ctx = ctxFor('GET', '/templates', ANON);
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
  });

  test('GET /templates/:id anônimo é rejeitado com 401', async () => {
    const ctx = ctxFor('GET', '/templates/qualquer', ANON);
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
  });

  test('autenticado sem permissão flows:update não faz DELETE (403)', async () => {
    const ctx = ctxFor('DELETE', '/templates/template-auth-probe', {
      requirePermission: () => ({ allowed: false, error: 'flows:update necessário' }),
    });
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(403);
  });

  test('autenticado sem permissão flows:read não lista (403)', async () => {
    const ctx = ctxFor('GET', '/templates', {
      requirePermission: () => ({ allowed: false, error: 'flows:read necessário' }),
    });
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(403);
  });
});
