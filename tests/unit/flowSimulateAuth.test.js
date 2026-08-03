'use strict';

/**
 * Regressão de segurança (falha observada em 2026-08-03): POST /flows/simulate
 * carregava um fluxo persistido (flows.get(flowId)) e executava a simulação
 * SEM autenticação — anônimo com um flowId válido obtinha o comportamento do
 * fluxo de um tenant. /flows/preview tinha o mesmo problema com baseFlowId
 * (corrigido em flowPreviewAuth.test.js).
 *
 * Comportamento correto: 401 para anônimo e o store nunca é consultado antes
 * da autenticação.
 */

const { handleFlowExecutionRoutes } = require('../../api/modules/domain-flow/handleFlowExecutionRoutes');

function makeRes() {
  return { statusCode: null, body: null };
}

function deps(overrides = {}) {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa', tenantId: 't1' } }),
    sendJson: (res, status, payload) => { res.statusCode = status; res.body = payload; },
    badRequest: (res, message) => { res.statusCode = 400; res.body = { error: 'bad_request', message }; },
    hasJsonContentType: () => true,
    parseJsonBody: async () => overrides.__body || {},
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    validateFlow: () => ({ valid: true, errors: [] }),
    flows: new Map([['flow-secreto', { id: 'flow-secreto', tenantId: 't1', nodes: [] }]]),
    ...overrides,
  };
}

describe('handleFlowExecutionRoutes — /flows/simulate exige autenticação', () => {
  test('anônimo recebe 401 e o store de fluxos NÃO é consultado', async () => {
    let storeAccessed = false;
    const ctx = {
      req: { headers: {} },
      res: makeRes(),
      method: 'POST',
      pathname: '/flows/simulate',
      deps: deps({
        requireAuth: () => ({ valid: false, error: 'token ausente' }),
        flows: { get: () => { storeAccessed = true; return undefined; } },
        __body: { flowId: 'flow-secreto' },
      }),
    };

    const handled = await handleFlowExecutionRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body.error).toBe('unauthorized');
    expect(storeAccessed).toBe(false);
  });

  test('autenticado com flowId inexistente recebe 404 (ordem pós-auth preservada)', async () => {
    const ctx = {
      req: { headers: {} },
      res: makeRes(),
      method: 'POST',
      pathname: '/flows/simulate',
      deps: deps({ __body: { flowId: 'nao-existe' } }),
    };

    const handled = await handleFlowExecutionRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(404);
  });
});
