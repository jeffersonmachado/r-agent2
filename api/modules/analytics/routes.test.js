'use strict';

const http = require('http');
const express = require('express');

const mockGetFunnelMetrics = jest.fn();

jest.mock('../../services/roiService', () => ({
  getFunnelMetrics: (...args) => mockGetFunnelMetrics(...args),
}));

const { createAnalyticsRoutes } = require('./routes');

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

describe('analytics routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /analytics/funnel forwards locationId and returns locationScope coverage', async () => {
    mockGetFunnelMetrics.mockResolvedValue({
      ok: true,
      windowDays: 30,
      locationId: 'loja-centro',
      locationScope: {
        requested: true,
        mode: 'strict_column',
        field: 'location_id',
        coverage: {
          leads: { total: 10, withLocation: 6, withoutLocation: 4, rate: 0.6 },
          submissions: { total: 5, withLocation: 3, withoutLocation: 2, rate: 0.6 },
        },
      },
      totals: { leads: 6, formSubmissions: 3, formSubmissionLeads: 2, orders: 2, revenue: 150 },
      stages: [{ stage: 'lead', total: 6 }],
      conversionRates: { visitorToLead: 0.4, leadToCustomer: 0.25 },
      channels: [],
      orderSources: [],
      totalChannelCost: 0,
      operationalCosts: { perOrder: 0, voice: { estimatedCost: 0 } },
    });

    const app = express();
    app.use((req, _res, next) => {
      req.tenantId = 'tenant-analytics';
      next();
    });
    app.use(createAnalyticsRoutes({
      buildDeps: () => ({
        requireAuth: () => ({ valid: true }),
        requirePermission: (_req, resource, action) => ({ allowed: resource === 'reports' && action === 'read' }),
        requireTenant: () => 'tenant-unused-here',
        sendJson: (res, status, payload) => res.status(status).json(payload),
        getAllMetrics: jest.fn(),
        getGeneralMetrics: jest.fn(),
        getAgentMetrics: jest.fn(),
        getDepartmentMetrics: jest.fn(),
        getQueueMetrics: jest.fn(),
        getTrendMetrics: jest.fn(),
        logger: { error: jest.fn(), warn: jest.fn() },
      }),
    }));

    const server = await listen(app);
    const response = await fetch(`http://127.0.0.1:${server.address().port}/analytics/funnel?windowDays=30&locationId=loja-centro`);
    const payload = await response.json();
    server.close();

    expect(response.status).toBe(200);
    expect(mockGetFunnelMetrics).toHaveBeenCalledWith({
      tenantId: 'tenant-analytics',
      windowDays: 30,
      locationId: 'loja-centro',
    });
    expect(payload.locationScope).toEqual({
      requested: true,
      mode: 'strict_column',
      field: 'location_id',
      coverage: {
        leads: { total: 10, withLocation: 6, withoutLocation: 4, rate: 0.6 },
        submissions: { total: 5, withLocation: 3, withoutLocation: 2, rate: 0.6 },
      },
    });
    expect(payload.totals).toEqual(expect.objectContaining({ orders: 2, revenue: 150 }));
  });
});