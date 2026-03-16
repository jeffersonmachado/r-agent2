const { beforeEach, describe, expect, it } = require('@jest/globals');

jest.mock('../../services/durableProcessService', () => ({
  getProcessAnalytics: jest.fn(),
  simulateProcessDefinition: jest.fn(),
  getProcessIntelligence: jest.fn(),
}));

const service = require('../../services/durableProcessService');
const { handleProcessRuntimeRoutes } = require('../processRuntimeRoutes');

function createContext({
  method = 'GET',
  url = '/api/process-runtime/analytics?processId=proc-1&limit=123',
  pathname = '/api/process-runtime/analytics',
  body = null,
  authValid = true,
  permissionAllowed = true,
  tenantId = 'tenant-1',
  hasJsonContentType = true,
} = {}) {
  const req = {
    method,
    url,
    headers: {},
    agent: { id: 'agent-1' },
  };
  const res = {};

  const deps = {
    requireAuth: jest.fn(() => (authValid ? { valid: true } : { valid: false, error: 'unauthorized' })),
    requirePermission: jest.fn(() => (permissionAllowed ? { allowed: true } : { allowed: false, error: 'forbidden' })),
    requireTenant: jest.fn(() => tenantId),
    sendJson: jest.fn(),
    badRequest: jest.fn((response, message) => {
      deps.sendJson(response, 400, { error: 'bad_request', message });
    }),
    hasJsonContentType: jest.fn(() => hasJsonContentType),
    parseJsonBody: jest.fn(async () => body),
    logger: {
      error: jest.fn(),
    },
  };

  return {
    req,
    res,
    deps,
    ctx: {
      req,
      res,
      method,
      pathname,
      deps,
    },
  };
}

describe('handleProcessRuntimeRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retorna analytics do processo com processId e limit da querystring', async () => {
    const out = { ok: true, summary: { totalInstances: 10 } };
    service.getProcessAnalytics.mockResolvedValue(out);
    const { ctx, deps, res } = createContext();

    const handled = await handleProcessRuntimeRoutes(ctx);

    expect(handled).toBe(true);
    expect(deps.requirePermission).toHaveBeenCalledWith(ctx.req, 'analytics', 'read');
    expect(service.getProcessAnalytics).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      processId: 'proc-1',
      limit: 123,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, out);
  });

  it('retorna 400 quando analytics é chamado sem processId', async () => {
    const { ctx, deps, res } = createContext({
      url: '/api/process-runtime/analytics',
      pathname: '/api/process-runtime/analytics',
    });

    const handled = await handleProcessRuntimeRoutes(ctx);

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'processId é obrigatório');
    expect(service.getProcessAnalytics).not.toHaveBeenCalled();
  });

  it('simula processo usando aliases flowId e definition no corpo', async () => {
    const out = { ok: true, simulation: { pathCount: 3 } };
    service.simulateProcessDefinition.mockResolvedValue(out);
    const { ctx, deps, res } = createContext({
      method: 'POST',
      url: '/api/process-runtime/simulate',
      pathname: '/api/process-runtime/simulate',
      body: {
        flowId: 'flow-1',
        definition: { nodes: [{ id: 'n1' }] },
        processVersion: 2,
      },
    });

    const handled = await handleProcessRuntimeRoutes(ctx);

    expect(handled).toBe(true);
    expect(deps.parseJsonBody).toHaveBeenCalledWith(ctx.req);
    expect(service.simulateProcessDefinition).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      processId: 'flow-1',
      processDefinition: { nodes: [{ id: 'n1' }] },
      processVersion: 2,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, out);
  });

  it('retorna 400 quando a simulação falha no serviço', async () => {
    service.simulateProcessDefinition.mockResolvedValue({ ok: false, error: 'simulation_failed' });
    const { ctx, deps, res } = createContext({
      method: 'POST',
      url: '/api/process-runtime/simulate',
      pathname: '/api/process-runtime/simulate',
      body: { processId: 'proc-9' },
    });

    const handled = await handleProcessRuntimeRoutes(ctx);

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 400, {
      error: 'simulation_failed',
      message: 'simulation_failed',
    });
  });

  it('retorna intelligence do processo via POST json', async () => {
    const out = { ok: true, recommendations: [{ id: 'rec-1' }] };
    service.getProcessIntelligence.mockResolvedValue(out);
    const { ctx, deps, res } = createContext({
      method: 'POST',
      url: '/api/process-runtime/intelligence',
      pathname: '/api/process-runtime/intelligence',
      body: {
        processId: 'proc-77',
        processDefinition: { nodes: [{ id: 'start-1' }] },
        processVersion: 4,
      },
    });

    const handled = await handleProcessRuntimeRoutes(ctx);

    expect(handled).toBe(true);
    expect(service.getProcessIntelligence).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      processId: 'proc-77',
      processDefinition: { nodes: [{ id: 'start-1' }] },
      processVersion: 4,
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, out);
  });
});