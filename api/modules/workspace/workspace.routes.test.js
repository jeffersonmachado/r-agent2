'use strict';

const http = require('http');
const express = require('express');

const mockListEntities = jest.fn();
const mockGetInsights = jest.fn();
const mockGetActions = jest.fn();
const mockExecuteSuggestedActions = jest.fn();
const mockGetTimeline = jest.fn();
const mockGetAutoCorrections = jest.fn();

jest.mock('./workspace.service', () => ({
  createWorkspaceService: () => ({
    listEntities: mockListEntities,
    getInsights: mockGetInsights,
    getActions: mockGetActions,
    executeSuggestedActions: mockExecuteSuggestedActions,
    getTimeline: mockGetTimeline,
    getAutoCorrections: mockGetAutoCorrections,
  }),
}));

const { createWorkspaceRoutes, WORKSPACE_ROUTE_CLASSIFICATIONS } = require('./workspace.routes');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('workspace routes', () => {
  beforeEach(() => {
    mockListEntities.mockResolvedValue({ items: [], total: 0 });
    mockGetInsights.mockResolvedValue({ items: [], persisted: [], total: 0 });
    mockGetActions.mockResolvedValue({ items: [], suggestion: null });
    mockExecuteSuggestedActions.mockResolvedValue({ items: [] });
    mockGetTimeline.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0, hasMore: false, links: 0 });
    mockGetAutoCorrections.mockResolvedValue({ items: [{ id: 'run-1', diagnosis: 'Falha no fluxo', rootCause: 'selector quebrado', sourceId: 'ev-1', evidenceId: 'ev-1', runId: 'run-1', proposed_patch: { diff: '...', filesToChange: ['a.js'] } }] });
  });

  it('serves authenticated tenant-scoped entity listing', async () => {
    const app = express();
    app.use(createWorkspaceRoutes({
      buildDeps: () => ({
        requireAuth: () => ({ valid: true }),
        requirePermission: (_req, resource, action) => ({ allowed: resource === 'workspace' && action === 'read' }),
        requireTenant: () => 'tenant-1',
        sendJson: (res, status, payload) => res.status(status).json(payload),
        parseJsonBody: async (req) => req.body || {},
        hasJsonContentType: () => true,
        badRequest: (res, message) => res.status(400).json({ message }),
        logger: { error: jest.fn(), warn: jest.fn() },
      }),
    }));
    const server = await listen(app);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/workspace/entities?q=ana&limit=10`);
    const payload = await response.json();
    server.close();

    expect(response.status).toBe(200);
    expect(payload).toEqual(expect.objectContaining({ ok: true }));
    expect(mockListEntities).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ q: 'ana', limit: '10' }));
  });

  async function requestWithAgent(agent, method, path) {
    const app = express();
    app.use(createWorkspaceRoutes({
      buildDeps: () => ({
        requireAuth: (req) => { if (agent) req.agent = agent; return { valid: true }; },
        requirePermission: () => ({ allowed: true }),
        requireTenant: () => 'tenant-1',
        sendJson: (res, status, payload) => res.status(status).json(payload),
        parseJsonBody: async (req) => req.body || {},
        hasJsonContentType: () => true,
        badRequest: (res, message) => res.status(400).json({ message }),
        logger: { error: jest.fn(), warn: jest.fn() },
      }),
    }));
    const server = await listen(app);
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
    const payload = await response.json();
    server.close();
    return { response, payload };
  }

  it('threads DEVELOPMENT classification into the insights read path', async () => {
    mockGetInsights.mockClear();
    const { response } = await requestWithAgent({ platformRole: 'qa_engineer', tenantId: 'tenant-1' }, 'GET', '/workspace/entities/entity-1/insights');
    expect(response.status).toBe(200);
    expect(mockGetInsights).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'DEVELOPMENT' });
  });

  it('threads SUPPORT classification into the actions read path', async () => {
    mockGetActions.mockClear();
    const { response } = await requestWithAgent({ platformRole: 'support_n1', tenantId: 'tenant-1' }, 'GET', '/workspace/entities/entity-1/actions');
    expect(response.status).toBe(200);
    expect(mockGetActions).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'SUPPORT' });
  });

  it('fails closed to PRODUCTION when classification is unknown', async () => {
    mockGetInsights.mockClear();
    mockExecuteSuggestedActions.mockClear();
    const { response } = await requestWithAgent(null, 'GET', '/workspace/entities/entity-1/insights');
    expect(response.status).toBe(200);
    expect(mockGetInsights).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'PRODUCTION' });

    const { response: postResponse } = await requestWithAgent({ role: 'auditor', tenantId: 'tenant-1' }, 'POST', '/workspace/entities/entity-1/actions/auto');
    expect(postResponse.status).toBe(201);
    expect(mockExecuteSuggestedActions).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'PRODUCTION' });
  });

  it('exposes route classification metadata for the autocorrections surface', () => {
    expect(WORKSPACE_ROUTE_CLASSIFICATIONS).toEqual({
      'GET /workspace/entities/:id/autocorrections': 'DEVELOPMENT',
    });
  });

  it('threads classification into the timeline read path', async () => {
    mockGetTimeline.mockClear();
    const { response } = await requestWithAgent({ platformRole: 'support_n2', tenantId: 'tenant-1' }, 'GET', '/workspace/entities/entity-1/timeline');
    expect(response.status).toBe(200);
    expect(mockGetTimeline).toHaveBeenCalledWith('tenant-1', 'entity-1', expect.any(Object), { classification: 'SUPPORT' });

    mockGetTimeline.mockClear();
    const { response: prodResponse } = await requestWithAgent({ role: 'manager', tenantId: 'tenant-1' }, 'GET', '/workspace/entities/entity-1/timeline');
    expect(prodResponse.status).toBe(200);
    expect(mockGetTimeline).toHaveBeenCalledWith('tenant-1', 'entity-1', expect.any(Object), { classification: 'PRODUCTION' });
  });

  describe('autocorrections classification gate', () => {
    const productionAgents = [
      ['operator', { role: 'operator', tenantId: 'tenant-1' }],
      ['manager', { role: 'manager', tenantId: 'tenant-1' }],
      ['tenant admin', { role: 'admin', tenantId: 'tenant-1' }],
      ['auditor without platformRole', { role: 'auditor', platformRole: null, tenantId: 'tenant-1' }],
    ];
    const supportAgents = [
      ['support_n1', { platformRole: 'support_n1', tenantId: 'tenant-1' }],
      ['support_n2', { platformRole: 'support_n2', tenantId: 'tenant-1' }],
      ['support_n3', { platformRole: 'support_n3', tenantId: 'tenant-1' }],
      ['platform_support', { platformRole: 'platform_support', tenantId: 'tenant-1' }],
    ];
    const developmentAgents = [
      ['qa_engineer', { platformRole: 'qa_engineer', tenantId: 'tenant-1' }],
      ['engineer', { platformRole: 'engineer', tenantId: 'tenant-1' }],
      ['developer', { platformRole: 'developer', tenantId: 'tenant-1' }],
    ];

    it.each([...productionAgents, ...supportAgents])('denies %s with a leak-free 403', async (_label, agent) => {
      mockGetAutoCorrections.mockClear();
      const { response, payload } = await requestWithAgent(agent, 'GET', '/workspace/entities/entity-1/autocorrections');
      expect(response.status).toBe(403);
      expect(payload).toEqual({ error: 'classification_forbidden' });
      const raw = JSON.stringify(payload);
      ['diagnosis', 'sourceId', 'evidenceId', 'runId', 'patch', 'files'].forEach((token) => expect(raw).not.toContain(token));
      expect(mockGetAutoCorrections).not.toHaveBeenCalled();
    });

    it.each(developmentAgents)('allows %s with full engineering data', async (_label, agent) => {
      mockGetAutoCorrections.mockClear();
      const { response, payload } = await requestWithAgent(agent, 'GET', '/workspace/entities/entity-1/autocorrections');
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.items[0]).toEqual(expect.objectContaining({ id: 'run-1', diagnosis: 'Falha no fluxo' }));
      expect(mockGetAutoCorrections).toHaveBeenCalledWith('tenant-1', 'entity-1');
    });
  });
});
