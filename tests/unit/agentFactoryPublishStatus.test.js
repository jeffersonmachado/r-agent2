'use strict';

/**
 * Regressão: POST /api/agent-factory/publish com agente inexistente deve
 * retornar 404, não 400 genérico.
 *
 * Falha observada (sondagem 2026-07-27): o serviço retorna
 * { ok: false, error: 'Agent not found', code: 'NOT_FOUND' } mas a rota só
 * conhecia o campo `reason`, respondendo 400 publish_blocked com mensagem
 * genérica para um recurso que simplesmente não existe.
 */

jest.mock('../../api/modules/agent-registry/service', () => ({}));

const mockValidateAndPublish = jest.fn();
jest.mock('../../api/modules/agent-os/services/agent-hardening-service', () => ({
  validateAndPublishAgent: (...args) => mockValidateAndPublish(...args),
}));

const {
  handleAgentFactoryRoutes,
} = require('../../api/modules/agent-os/routes/agent-factory');

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
  req.url = '/';
  req.originalUrl = '/';
  req.query = {};
  return req;
}

function baseDeps() {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa-agent' } }),
    requirePermission: () => ({ allowed: true }),
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
    logAction: async () => {},
  };
}

describe('POST /api/agent-factory/publish — status codes corretos', () => {
  beforeEach(() => jest.clearAllMocks());

  test('agente inexistente retorna 404 agent_not_found', async () => {
    mockValidateAndPublish.mockResolvedValue({
      ok: false,
      error: 'Agent not found',
      code: 'NOT_FOUND',
    });
    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ id: 'agente-que-nao-existe' }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/publish',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error', 'agent_not_found');
  });

  test('bloqueio de governança (NO_GO) continua 400 publish_blocked', async () => {
    mockValidateAndPublish.mockResolvedValue({
      ok: false,
      status: 'NO_GO',
      reason: 'QA Wave validation failed',
    });
    const res = {};
    await handleAgentFactoryRoutes({
      req: makeReq({ id: 'agent-1' }),
      res,
      method: 'POST',
      pathname: '/api/agent-factory/publish',
      deps: baseDeps(),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error', 'publish_blocked');
  });
});
