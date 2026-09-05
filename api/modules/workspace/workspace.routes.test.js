'use strict';

const http = require('http');
const express = require('express');

const mockListEntities = jest.fn();
const mockGetInsights = jest.fn();
const mockGetActions = jest.fn();
const mockExecuteSuggestedActions = jest.fn();

jest.mock('./workspace.service', () => ({
  createWorkspaceService: () => ({
    listEntities: mockListEntities,
    getInsights: mockGetInsights,
    getActions: mockGetActions,
    executeSuggestedActions: mockExecuteSuggestedActions,
  }),
}));

const { createWorkspaceRoutes } = require('./workspace.routes');

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
    await response.json();
    server.close();
    return response;
  }

  it('threads DEVELOPMENT classification into the insights read path', async () => {
    mockGetInsights.mockClear();
    const response = await requestWithAgent({ platformRole: 'qa_engineer', tenantId: 'tenant-1' }, 'GET', '/workspace/entities/entity-1/insights');
    expect(response.status).toBe(200);
    expect(mockGetInsights).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'DEVELOPMENT' });
  });

  it('threads SUPPORT classification into the actions read path', async () => {
    mockGetActions.mockClear();
    const response = await requestWithAgent({ platformRole: 'support_n1', tenantId: 'tenant-1' }, 'GET', '/workspace/entities/entity-1/actions');
    expect(response.status).toBe(200);
    expect(mockGetActions).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'SUPPORT' });
  });

  it('fails closed to PRODUCTION when classification is unknown', async () => {
    mockGetInsights.mockClear();
    mockExecuteSuggestedActions.mockClear();
    const response = await requestWithAgent(null, 'GET', '/workspace/entities/entity-1/insights');
    expect(response.status).toBe(200);
    expect(mockGetInsights).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'PRODUCTION' });

    const postResponse = await requestWithAgent({ role: 'auditor', tenantId: 'tenant-1' }, 'POST', '/workspace/entities/entity-1/actions/auto');
    expect(postResponse.status).toBe(201);
    expect(mockExecuteSuggestedActions).toHaveBeenCalledWith('tenant-1', 'entity-1', { classification: 'PRODUCTION' });
  });
});
