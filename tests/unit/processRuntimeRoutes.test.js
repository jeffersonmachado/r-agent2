'use strict';

jest.mock('../../api/services/durableProcessService', () => ({
  getProcessAnalytics: jest.fn(async () => ({ ok: true, analytics: { process: { totalExecutions: 1 } } })),
  simulateProcessDefinition: jest.fn(async () => ({ ok: true, simulation: { complexityScore: 10 } })),
  getProcessIntelligence: jest.fn(async () => ({ ok: true, intelligence: { recommendations: [] } })),
  getProcessInstanceHistory: jest.fn(async () => ({ ok: true, history: [] })),
}));

const service = require('../../api/services/durableProcessService');
const { handleProcessRuntimeRoutes } = require('../../api/serverHandlers/processRuntimeRoutes');

function createDeps() {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => 'tenant-1'),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({ processId: 'flow-1' })),
    logger: { error: jest.fn() },
  };
}

describe('process runtime routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    service.getProcessAnalytics.mockResolvedValue({ ok: true, analytics: { process: { totalExecutions: 1 } } });
    service.simulateProcessDefinition.mockResolvedValue({ ok: true, simulation: { complexityScore: 10 } });
    service.getProcessIntelligence.mockResolvedValue({ ok: true, intelligence: { recommendations: [] } });
    service.getProcessInstanceHistory.mockResolvedValue({ ok: true, history: [] });
  });

  test('GET /api/process-runtime/analytics expõe analytics', async () => {
    const deps = createDeps();
    const handled = await handleProcessRuntimeRoutes({
      req: { url: '/api/process-runtime/analytics?processId=flow-1' },
      res: {},
      method: 'GET',
      pathname: '/api/process-runtime/analytics',
      deps,
    });

    expect(handled).toBe(true);
    expect(service.getProcessAnalytics).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      processId: 'flow-1',
      limit: 500,
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.any(Object));
  });

  test('POST /api/process-runtime/simulate expõe simulation', async () => {
    const deps = createDeps();
    const handled = await handleProcessRuntimeRoutes({
      req: { url: '/api/process-runtime/simulate' },
      res: {},
      method: 'POST',
      pathname: '/api/process-runtime/simulate',
      deps,
    });

    expect(handled).toBe(true);
    expect(service.simulateProcessDefinition).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      processId: 'flow-1',
      processDefinition: null,
      processVersion: null,
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.any(Object));
  });

  test('POST /api/process-runtime/intelligence expõe intelligence', async () => {
    const deps = createDeps();
    const handled = await handleProcessRuntimeRoutes({
      req: { url: '/api/process-runtime/intelligence' },
      res: {},
      method: 'POST',
      pathname: '/api/process-runtime/intelligence',
      deps,
    });

    expect(handled).toBe(true);
    expect(service.getProcessIntelligence).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      processId: 'flow-1',
      processDefinition: null,
      processVersion: null,
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.any(Object));
  });

  test('GET /api/process-instances/:id/history expõe filtros de histórico', async () => {
    const deps = createDeps();
    const handled = await handleProcessRuntimeRoutes({
      req: { url: '/api/process-instances/exec-1/history?eventType=NODE_WAITING&nodeId=human-approval&limit=10' },
      res: {},
      method: 'GET',
      pathname: '/api/process-instances/exec-1/history',
      deps,
    });

    expect(handled).toBe(true);
    expect(service.getProcessInstanceHistory).toHaveBeenCalledWith('exec-1', 'tenant-1', {
      eventType: 'NODE_WAITING',
      nodeId: 'human-approval',
      limit: 10,
    });
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, { ok: true, history: [] });
  });
});
