'use strict';

const http = require('http');
const express = require('express');

const mockListEntities = jest.fn().mockResolvedValue({ items: [], total: 0 });

jest.mock('./workspace.service', () => ({
  createWorkspaceService: () => ({
    listEntities: mockListEntities,
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
});
