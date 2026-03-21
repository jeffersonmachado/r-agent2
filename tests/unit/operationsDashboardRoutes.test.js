'use strict';

jest.mock('../../api/services/operationsDashboardService', () => ({
  computeSummary: jest.fn(async () => ({ summary: { beauty: {}, fitness: {}, system: {} } })),
  listTimeline: jest.fn(async () => ({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } })),
  listJobs: jest.fn(async () => ({ summary: {}, items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } })),
  listNotifications: jest.fn(async () => ({ summary: {}, items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } })),
  listInsights: jest.fn(async () => ({ summary: {}, items: [] })),
}));

jest.mock('../../api/services/superAdminService', () => ({
  isSuperAdmin: jest.fn(() => false),
}));

const {
  computeSummary,
  listTimeline,
  listJobs,
  listNotifications,
  listInsights,
} = require('../../api/services/operationsDashboardService');
const { isSuperAdmin } = require('../../api/services/superAdminService');
const { handleOperationsDashboardRoutes } = require('../../api/modules/operations-dashboard/handleOperationsDashboardRoutes');

function buildCtx(method, pathname, { tenantId = 'tenant-a', query = '', agent = null } = {}) {
  const reqAgent = agent || { id: 'agent-1', role: 'admin', tenantId };
  const req = {
    method,
    url: `http://localhost${pathname}${query}`,
    tenantId,
    agent: reqAgent,
    headers: { 'content-type': 'application/json' },
  };

  const res = {
    statusCode: null,
    body: null,
    setHeader: jest.fn(),
    writeHead: jest.fn((status) => { res.statusCode = status; }),
    end: jest.fn((data) => { res.body = data; }),
  };

  const deps = {
    requireAuth: jest.fn(() => ({ valid: true, agent: reqAgent })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn(() => tenantId),
    sendJson: jest.fn((r, status, body) => {
      r.statusCode = status;
      r.body = JSON.stringify(body);
    }),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  };

  return { req, res, method, pathname, deps };
}

describe('operationsDashboardRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    computeSummary.mockResolvedValue({ summary: { beauty: {}, fitness: {}, system: {} } });
    listTimeline.mockResolvedValue({ items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } });
    listJobs.mockResolvedValue({ summary: {}, items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } });
    listNotifications.mockResolvedValue({ summary: {}, items: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } });
    listInsights.mockResolvedValue({ summary: {}, items: [] });
    isSuperAdmin.mockReturnValue(false);
  });

  it('GET /summary chama service com filtros e tenant padrão', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/summary', {
      query: '?vertical=fitness&startDate=2026-03-01&endDate=2026-03-19',
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(computeSummary).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      vertical: 'fitness',
      startDate: '2026-03-01',
      endDate: '2026-03-19',
    }));
    expect(ctx.res.statusCode).toBe(200);
  });

  it('GET /timeline suporta filtros subject/customer/membership/status/paginação', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/timeline', {
      query: '?subjectId=sub-1&customerId=c-1&membershipId=m-1&status=failed&page=2&limit=15',
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(listTimeline).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      subjectId: 'sub-1',
      customerId: 'c-1',
      membershipId: 'm-1',
      status: 'failed',
      page: '2',
      limit: '15',
    }));
    expect(ctx.res.statusCode).toBe(200);
  });

  it('GET /jobs chama service e repassa filtros', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/jobs', {
      query: '?vertical=beauty&status=success&startDate=2026-03-10&endDate=2026-03-19',
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(listJobs).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      vertical: 'beauty',
      status: 'success',
      startDate: '2026-03-10',
      endDate: '2026-03-19',
    }));
    expect(ctx.res.statusCode).toBe(200);
  });

  it('GET /notifications chama service e repassa filtros', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/notifications', {
      query: '?channel=whatsapp&status=provider-dependent&limit=20&page=3',
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(listNotifications).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      channel: 'whatsapp',
      status: 'provider-dependent',
      limit: '20',
      page: '3',
    }));
    expect(ctx.res.statusCode).toBe(200);
  });

  it('GET /insights chama service com tenant/período/vertical', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/insights', {
      query: '?vertical=all&startDate=2026-03-01&endDate=2026-03-19&limit=40',
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(listInsights).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      vertical: 'all',
      startDate: '2026-03-01',
      endDate: '2026-03-19',
      limit: '40',
    }));
    expect(ctx.res.statusCode).toBe(200);
  });

  it('bloqueia override tenantId para usuário não super-admin', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/summary', {
      tenantId: 'tenant-a',
      query: '?tenantId=tenant-b',
      agent: { id: 'a1', tenantId: 'tenant-a', role: 'admin' },
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(computeSummary).not.toHaveBeenCalled();
    expect(ctx.res.statusCode).toBe(403);
  });

  it('permite override tenantId para super-admin', async () => {
    isSuperAdmin.mockReturnValue(true);

    const ctx = buildCtx('GET', '/api/operations-dashboard/summary', {
      tenantId: 'system',
      query: '?tenantId=tenant-z',
      agent: { id: 'sa-1', tenantId: 'system', role: 'super_admin' },
    });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(computeSummary).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-z' }));
    expect(ctx.res.statusCode).toBe(200);
  });

  it('retorna 403 sem permissão analytics:read', async () => {
    const ctx = buildCtx('GET', '/api/operations-dashboard/summary');
    ctx.deps.requirePermission.mockReturnValueOnce({ allowed: false, error: 'forbidden' });

    const handled = await handleOperationsDashboardRoutes(ctx);

    expect(handled).toBe(true);
    expect(computeSummary).not.toHaveBeenCalled();
    expect(ctx.res.statusCode).toBe(403);
  });

  it('retorna false para paths fora do namespace', async () => {
    const ctx = buildCtx('GET', '/api/fitness/metrics');
    const handled = await handleOperationsDashboardRoutes(ctx);
    expect(handled).toBe(false);
  });
});
