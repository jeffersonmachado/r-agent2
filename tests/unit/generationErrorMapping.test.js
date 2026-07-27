'use strict';

/**
 * Regressão: erros de contrato/validação na geração por IA devem retornar
 * 400, não 500.
 *
 * Falha observada (sondagem 2026-07-27): POST /flows/generate e
 * POST /ai/rpa/generate respondiam 500 internal_error quando a orquestração
 * lançava erro de validação do payload (code BAD_REQUEST) — erro do cliente
 * mascarado como falha interna.
 */

const {
  handleFlowGenerationRoutes,
} = require('../../api/modules/domain-flow/flow-execution/flowGenerationRoutes');

jest.mock('../../api/services/generationOrchestrator', () => ({
  orchestrateGeneration: jest.fn(async () => {
    throw Object.assign(new Error('payload de geração inválido'), { code: 'BAD_REQUEST' });
  }),
}));

const {
  handleAiChatbotOrchestratorRoutes,
} = require('../../api/modules/platform-content/handleAiChatbotOrchestratorRoutes');

function makeReq(body, url) {
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
  req.url = url;
  req.originalUrl = url;
  return req;
}

function baseDeps(overrides) {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa-agent' } }),
    requireTenant: () => 'system',
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
    registerGeneration: async () => 'audit-1',
    generateAuditReport: async () => ({ reportId: 'rep-1' }),
    STRICT_TENANT_MODE: true,
    ...overrides,
  };
}

describe('POST /flows/generate — mapeamento de erros', () => {
  test('erro BAD_REQUEST da orquestração retorna 400 (não 500)', async () => {
    const deps = baseDeps({
      orchestrateGeneration: async () => {
        throw Object.assign(new Error('payload de geração inválido'), { code: 'BAD_REQUEST' });
      },
    });
    const res = {};
    await handleFlowGenerationRoutes({
      req: makeReq({ name: 'x', description: 'y' }, '/flows/generate'),
      res,
      method: 'POST',
      pathname: '/flows/generate',
      deps,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'bad_request');
  });

  test('erro sem código de cliente continua 500 internal_error', async () => {
    const deps = baseDeps({
      orchestrateGeneration: async () => {
        throw new Error('provider explodiu');
      },
    });
    const res = {};
    await handleFlowGenerationRoutes({
      req: makeReq({ name: 'x', description: 'y' }, '/flows/generate'),
      res,
      method: 'POST',
      pathname: '/flows/generate',
      deps,
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toHaveProperty('error', 'internal_error');
  });
});

describe('POST /ai/rpa/generate — mapeamento de erros', () => {
  test('erro BAD_REQUEST da orquestração retorna 400 (não 500)', async () => {
    const res = {};
    await handleAiChatbotOrchestratorRoutes({
      req: makeReq({ userInput: 'gere um teste' }, '/ai/rpa/generate'),
      res,
      method: 'POST',
      pathname: '/ai/rpa/generate',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'bad_request');
  });
});
