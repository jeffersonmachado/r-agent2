'use strict';

/**
 * Regressão: GET /replay/:sessionId não exigia autenticação.
 *
 * Falha observada (inspeção 2026-07-27): o branch de replay em
 * flowExecutionRoutes.js respondia 200/404 para qualquer chamador anônimo,
 * expondo os eventos da sessão de conversa simulada (mensagens trocadas no
 * simulador do editor de fluxos). Todos os branches irmãos
 * (resolve-dependencies, preview-rpa, generate-rpa) já chamam requireAuth;
 * o replay era o único desprotegido.
 *
 * Comportamento correto: anônimo → 401 unauthorized; autenticado → replay.
 */

const {
  handleFlowExecutionRoutes,
} = require('../../api/modules/domain-flow/flow-execution/flowExecutionRoutes');

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
    parseJsonBody: async () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    requireAuth: () => ({ valid: false, error: 'Token de autenticação ausente' }),
    sessionEvents: new Map([['sess-1', [{ type: 'message', text: 'oi' }]]]),
    sessionTenants: new Map([['sess-1', 'tenant-qa']]),
    buildConversationReplay: (events) => ({ events }),
    ...overrides,
  };
}

function ctxFor(pathname, deps) {
  return {
    req: { headers: {} },
    res: makeRes(),
    method: 'GET',
    pathname,
    deps,
  };
}

describe('GET /replay/:sessionId — autenticação obrigatória', () => {
  it('retorna 401 para chamador anônimo mesmo com sessão existente', async () => {
    const ctx = ctxFor('/replay/sess-1', baseDeps());
    const handled = await handleFlowExecutionRoutes(ctx);
    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body).toEqual(expect.objectContaining({ error: 'unauthorized' }));
  });

  it('retorna 401 para anônimo mesmo com sessão inexistente (não vaza existência)', async () => {
    const ctx = ctxFor('/replay/nao-existe', baseDeps());
    const handled = await handleFlowExecutionRoutes(ctx);
    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
  });

  it('retorna o replay para chamador autenticado no tenant da sessão', async () => {
    const ctx = ctxFor('/replay/sess-1', baseDeps({
      requireAuth: (req) => {
        req.tenantId = 'tenant-qa';
        return { valid: true, userId: 'u1', role: 'admin' };
      },
    }));
    const handled = await handleFlowExecutionRoutes(ctx);
    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(200);
    expect(ctx.res.body).toEqual({ events: [{ type: 'message', text: 'oi' }] });
  });

  it('retorna 404 session_not_found para autenticado com sessão inexistente', async () => {
    const ctx = ctxFor('/replay/nao-existe', baseDeps({
      requireAuth: () => ({ valid: true, userId: 'u1', role: 'admin' }),
    }));
    const handled = await handleFlowExecutionRoutes(ctx);
    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(404);
    expect(ctx.res.body).toEqual(expect.objectContaining({ error: 'session_not_found' }));
  });
});
