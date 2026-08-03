'use strict';

/**
 * Regressão de hardening (falha observada em 2026-08-03): POST /flows em
 * STRICT_TENANT_MODE respondia 400 (Content-Type/validação estrutural) antes
 * de rejeitar o anônimo com 401. Além de revelar comportamento de validação a
 * quem não tem credencial, isso impedia a API Surface Wave de comprovar o
 * enforcement de autenticação (probe anônimo com '{}' recebia 400 em vez de
 * 401 e a rota não podia ser VALIDATED).
 *
 * Comportamento correto: em modo estrito, a rejeição 401 do anônimo precede
 * qualquer validação de entrada. O caminho autenticado e o modo não-estrito
 * (DEV/compatibilidade com tenantId explícito) permanecem inalterados.
 */

const { handleFlowCrudRoutes } = require('../../api/modules/domain-flow/handleFlowCrudRoutes');

function makeRes() {
  return { statusCode: null, body: null };
}

function deps(overrides = {}) {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa', tenantId: 't1' } }),
    requireTenant: () => 't1',
    sendJson: (res, status, payload) => { res.statusCode = status; res.body = payload; },
    badRequest: (res, message) => { res.statusCode = 400; res.body = { error: 'bad_request', message }; },
    hasJsonContentType: () => true,
    parseJsonBody: async () => ({}),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    validateFlowStructure: () => ({ valid: false, error: 'estrutura inválida' }),
    validateFlow: () => ({ valid: true, errors: [] }),
    ensureFlowHasMeta: (flow) => flow,
    persistFlowBestEffort: async () => {},
    flows: new Map(),
    triggerWebhooks: () => {},
    emitEvent: () => {},
    isSuperAdmin: () => false,
    STRICT_TENANT_MODE: true,
    ...overrides,
  };
}

describe('handleFlowCrudRoutes — POST /flows rejeita anônimo antes de validar entrada (modo estrito)', () => {
  test('anônimo com body inválido recebe 401 (não 400) em STRICT_TENANT_MODE', async () => {
    const ctx = {
      req: { headers: {} },
      res: makeRes(),
      method: 'POST',
      pathname: '/flows',
      deps: deps({ requireAuth: () => ({ valid: false, error: 'token ausente' }) }),
    };

    const handled = await handleFlowCrudRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(401);
    expect(ctx.res.body.error).toBe('unauthorized');
  });

  test('autenticado com body inválido continua recebendo 400 (ordem só muda para anônimo)', async () => {
    const ctx = {
      req: { headers: {} },
      res: makeRes(),
      method: 'POST',
      pathname: '/flows',
      deps: deps(),
    };

    const handled = await handleFlowCrudRoutes(ctx);

    expect(handled).toBe(true);
    expect(ctx.res.statusCode).toBe(400);
  });
});
