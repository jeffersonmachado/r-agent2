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

// TEMP-DISABLED require

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

  test('erro de validação de fluxo (FLOW_DISCONNECTED) retorna 400 (não 500)', async () => {
    // Falha observada (QA Mesh 2026-07-27, business-core-biz-flows-editor /
    // CORE-BIZ-FLOWS-EDITOR): "500 Internal Server Error: Existem nós não
    // alcançáveis a partir do start." — o flowPreValidator lança FLOW_* e a
    // rota mascarava como falha interna.
    const deps = baseDeps({
      orchestrateGeneration: async () => {
        throw Object.assign(new Error('Existem nós não alcançáveis a partir do start.'), { code: 'FLOW_DISCONNECTED' });
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
    expect(res.body.message).toContain('não alcançáveis');
  });
});

describe('POST /flows/generate/dry-run — mapeamento de erros', () => {
  test('erro de validação de fluxo (FLOW_DISCONNECTED) retorna 400 (não 500)', async () => {
    const deps = baseDeps({
      orchestrateGeneration: async () => {
        throw Object.assign(new Error('Existem nós não alcançáveis a partir do start.'), { code: 'FLOW_DISCONNECTED' });
      },
    });
    const res = {};
    await handleFlowGenerationRoutes({
      req: makeReq({ name: 'x', description: 'y' }, '/flows/generate/dry-run'),
      res,
      method: 'POST',
      pathname: '/flows/generate/dry-run',
      deps,
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'bad_request');
    expect(res.body.message).toContain('não alcançáveis');
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

  test('erro de validação de fluxo (FLOW_FALLBACK_FANIN) retorna 400 (não 500)', async () => {
    // Falha observada (QA Mesh 2026-07-27, execução mesh-2026-07-27T19-25-46,
    // CORE-BIZ-FLOWS-EDITOR): "500 Internal Server Error: Fallback não pode
    // receber múltiplas entradas diretas. Use merge antes." — o catch da rota
    // mapeava apenas BAD_REQUEST/VALIDATION_ERROR e vazava FLOW_* como 500.
    require('../../api/services/generationOrchestrator').orchestrateGeneration.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Fallback não pode receber múltiplas entradas diretas. Use merge antes.'), { code: 'FLOW_FALLBACK_FANIN' });
    });
    const res = {};
    await handleAiChatbotOrchestratorRoutes({
      req: makeReq({ userInput: 'Plano RPA simples de boas-vindas' }, '/ai/rpa/generate'),
      res,
      method: 'POST',
      pathname: '/ai/rpa/generate',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'bad_request');
    expect(res.body.message).toContain('Fallback');
  });
});

describe('POST /ai/chatbot/generate — mapeamento de erros', () => {
  test('erro de validação de fluxo (FLOW_DISCONNECTED) retorna 400 (não 500)', async () => {
    // Falha observada (Business QA Wave 2026-07-27, CORE-BIZ-AI-TOOLS):
    // "500 Internal Server Error: Existem nós não alcançáveis a partir do
    // start." — erro de validação do fluxo gerado mascarado como falha interna.
    require('../../api/services/generationOrchestrator').orchestrateGeneration.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Existem nós não alcançáveis a partir do start.'), { code: 'FLOW_DISCONNECTED' });
    });
    const res = {};
    await handleAiChatbotOrchestratorRoutes({
      req: makeReq({ userInput: 'Fluxo simples de boas-vindas' }, '/ai/chatbot/generate'),
      res,
      method: 'POST',
      pathname: '/ai/chatbot/generate',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'bad_request');
    expect(res.body.message).toContain('não alcançáveis');
  });
});
