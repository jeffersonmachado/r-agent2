'use strict';

/**
 * Regressão de segurança (falha observada em 2026-08-03): POST /flows/preview
 * aceitava baseFlowId e lia o fluxo persistido (flows.get) SEM autenticação —
 * um chamador anônimo que soubesse/chutasse um flowId recebia a estrutura do
 * fluxo armazenado (ids de nós e edges via diff), vazando dados do tenant.
 *
 * Comportamento correto: /flows/preview exige autenticação (401 anônimo) e
 * nunca toca no store antes da autenticação. /flows/validate permanece
 * público por design (função pura, sem acesso a dados).
 */

const { handleFlowValidationRoutes } = require('../../api/modules/domain-flow/flow-execution/flowValidationRoutes');

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
    validateFlowStructure: () => ({ valid: true }),
    addUiMessage: (e) => e,
    flows: new Map([['flow-secreto', { id: 'flow-secreto', tenantId: 't1', nodes: [{ id: 'n1', type: 'start' }] }]]),
    ...overrides,
  };
}

function ctxFor(body, depOverrides = {}) {
  return {
    req: { headers: {} },
    res: makeRes(),
    method: 'POST',
    pathname: '/flows/preview',
    deps: deps({ ...depOverrides, __body: body }),
  };
}

const FLOW = { id: 'candidato', kind: 'chat', nodes: [{ id: 'n1', type: 'start' }] };

describe('handleFlowValidationRoutes — /flows/preview exige autenticação', () => {
  test('anônimo recebe 401 e o store de fluxos NÃO é consultado', async () => {
    let storeAccessed = false;
    const trackingFlows = {
      get: () => { storeAccessed = true; return undefined; },
    };
    const ctx = ctxFor(
      { flow: FLOW, baseFlowId: 'flow-secreto' },
      {
        requireAuth: () => ({ valid: false, error: 'token ausente' }),
        flows: trackingFlows,
      },
    );

    const handled = await handleFlowValidationRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body.error).toBe('unauthorized');
    expect(storeAccessed).toBe(false);
  });

  test('autenticado segue o fluxo normal (200 com summary)', async () => {
    const ctx = ctxFor({ flow: FLOW, baseFlowId: 'flow-secreto' });

    const handled = await handleFlowValidationRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(200);
    expect(ctx.res.body.ok).toBe(true);
  });
});
