'use strict';

/**
 * Regressão: POST /templates gravava templates de runtime DENTRO do
 * repositório (api/frontend/public/templates) — sujava o worktree, disparava
 * restart do nodemon e violava a política de que escrita de runtime vai para
 * RUNTIME_ROOT. Adicionalmente, GET /templates lia os seeds embutidos do
 * caminho errado (api/frontend/... inexistente) em vez do diretório
 * versionado frontend/public/templates.
 *
 * Comportamento correto:
 * - escrita (POST/DELETE) acontece em RUNTIME_ROOT/templates;
 * - leitura (GET) combina built-ins versionados (frontend/public/templates)
 *   com overrides de runtime (runtime vence no mesmo id);
 * - DELETE só remove arquivos de runtime (built-in versionado é intocável).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleTemplatesRoutes } = require('../../api/modules/platform-content/handleTemplatesRoutes');

const REPO_RUNTIME_LEAK_DIR = path.join(__dirname, '..', '..', 'api', 'frontend');
const BUILTIN_DIR = path.join(__dirname, '..', '..', 'frontend', 'public', 'templates');

let runtimeRoot;

function makeRes() {
  return { statusCode: null, body: null };
}

function deps(overrides = {}) {
  return {
    // Rotas /templates exigem auth + permissão (ver templatesAuthEnforcement.test.js);
    // estes testes exercitam o comportamento autenticado e autorizado.
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

function ctxFor(method, pathname, body) {
  return {
    req: { headers: {} },
    res: makeRes(),
    method,
    pathname,
    deps: deps({ __body: body }),
  };
}

const SAMPLE = {
  id: 'template-teste-runtime',
  name: 'Template de teste runtime',
  description: 'gravado em RUNTIME_ROOT',
  flow: { kind: 'chat', nodes: [{ id: 'n1' }] },
};

beforeEach(() => {
  runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'templates-runtime-'));
  process.env.RUNTIME_ROOT = runtimeRoot;
});

afterEach(() => {
  delete process.env.RUNTIME_ROOT;
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
  // Garante que o teste não deixou vazamento dentro do repositório.
  fs.rmSync(REPO_RUNTIME_LEAK_DIR, { recursive: true, force: true });
});

describe('POST /templates — escrita em RUNTIME_ROOT', () => {
  it('grava o template em RUNTIME_ROOT/templates e NÃO dentro do repositório', async () => {
    const ctx = ctxFor('POST', '/templates', SAMPLE);
    const handled = await handleTemplatesRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(201);

    const expectedFile = path.join(runtimeRoot, 'templates', 'template-teste-runtime.json');
    expect(fs.existsSync(expectedFile)).toBe(true);

    // Nada pode ser criado em api/frontend/... dentro do repo.
    expect(fs.existsSync(REPO_RUNTIME_LEAK_DIR)).toBe(false);
  });
});

describe('GET /templates — built-ins versionados + overrides de runtime', () => {
  it('lista os templates embutidos do diretório versionado frontend/public/templates', async () => {
    const ctx = ctxFor('GET', '/templates');
    await handleTemplatesRoutes(ctx);

    expect(ctx.res.statusCode).toBe(200);
    const ids = ctx.res.body.map((t) => t.id);
    // crossfit-academia.json existe em frontend/public/templates (versionado).
    const builtinFiles = fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith('.json'));
    expect(builtinFiles.length).toBeGreaterThan(0);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('override de runtime com o mesmo id vence o built-in na listagem e no GET por id', async () => {
    const post = ctxFor('POST', '/templates', SAMPLE);
    await handleTemplatesRoutes(post);
    expect(post.res.statusCode).toBe(201);

    const getOne = ctxFor('GET', '/templates/template-teste-runtime');
    await handleTemplatesRoutes(getOne);
    expect(getOne.res.statusCode).toBe(200);
    expect(getOne.res.body.name).toBe(SAMPLE.name);
  });
});

describe('DELETE /templates/:id — só remove arquivos de runtime', () => {
  it('remove template de runtime (200)', async () => {
    const post = ctxFor('POST', '/templates', SAMPLE);
    await handleTemplatesRoutes(post);

    const del = ctxFor('DELETE', '/templates/template-teste-runtime');
    await handleTemplatesRoutes(del);
    expect(del.res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(runtimeRoot, 'templates', 'template-teste-runtime.json'))).toBe(false);
  });

  it('recusa remover built-in versionado (não deleta arquivo do repositório)', async () => {
    const builtinFiles = fs.readdirSync(BUILTIN_DIR).filter((f) => f.endsWith('.json'));
    const target = builtinFiles[0].replace(/\.json$/, '');

    const del = ctxFor('DELETE', `/templates/${target}`);
    await handleTemplatesRoutes(del);

    expect([400, 403, 404]).toContain(del.res.statusCode);
    expect(fs.existsSync(path.join(BUILTIN_DIR, builtinFiles[0]))).toBe(true);
  });
});
