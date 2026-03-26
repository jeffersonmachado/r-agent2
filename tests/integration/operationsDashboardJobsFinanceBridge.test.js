'use strict';

const mockGetSequelize = jest.fn(() => ({}));
const mockFindAll = jest.fn();
const mockFindOne = jest.fn();

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: (...args) => mockGetSequelize(...args),
}));

jest.mock('../../api/db/models', () => ({
  VerticalJourneyEvent: () => ({ findAll: jest.fn(async () => []) }),
  VerticalAttendance: () => ({ findAll: jest.fn(async () => []) }),
  VerticalEngagementSignal: () => ({ findAll: jest.fn(async () => []) }),
  AccessMembership: () => ({ findAll: jest.fn(async () => []) }),
  EventLedger: () => ({ findAll: (...args) => mockFindAll(...args), findOne: (...args) => mockFindOne(...args) }),
  ExecutionJob: () => ({ findAll: (...args) => mockFindAll(...args) }),
  BillingTransaction: () => ({ findAll: (...args) => mockFindAll(...args) }),
}));

jest.mock('../../api/services/vertical/verticalMetricsEngine', () => ({
  computeVerticalMetrics: jest.fn(async () => ({})),
}));

jest.mock('../../api/services/billingOpsMetricsService', () => ({
  getBillingOpsMetrics: jest.fn(async () => ({ ok: true, metrics: {} })),
}));

const { listJobs, listFinancialTransactions } = require('../../api/services/operationsDashboardService');

describe('Operations dashboard jobs <-> finance bridge integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
  });

  test('listJobs filters billing job by jobId and finance snapshot exposes same jobId', async () => {
    mockFindAll
      .mockResolvedValueOnce([
        {
          id: 'job-123',
          kind: 'billing_reconciliation',
          tenant_key: 'tenant-bridge',
          status: 'done',
          attempts: 0,
          processing_at: '2026-03-26T10:00:00.000Z',
          updated_at: '2026-03-26T10:00:05.000Z',
          created_at: '2026-03-26T10:00:00.000Z',
          toJSON() { return this; },
        },
      ])
      .mockResolvedValueOnce([]);

    mockFindOne.mockResolvedValueOnce({
      occurred_at: '2026-03-26T10:00:10.000Z',
      source: 'billing.reconciliation.scheduler',
      correlation_id: 'job-123',
      actor_type: 'system',
      actor_id: 'execution_queue',
      payload: {
        kind: 'billing_reconciliation_scheduled',
        jobId: 'job-123',
        transactions: { scanned: 1, updated: 1, unchanged: 0, failed: 0 },
        subscriptions: { scanned: 0, updated: 0, unchanged: 0, failed: 0 },
      },
      toJSON() { return this; },
    });

    const jobsOut = await listJobs({
      tenantId: 'tenant-bridge',
      jobId: 'job-123',
      limit: 20,
      page: 1,
    });

    const financeOut = await listFinancialTransactions({
      tenantId: 'tenant-bridge',
      problemOnly: true,
      limit: 20,
      page: 1,
    });

    expect(jobsOut.items).toHaveLength(1);
    expect(jobsOut.items[0].id).toBe('job-123');
    expect(financeOut.meta.lastReconciliation).toEqual(expect.objectContaining({
      mode: 'scheduler',
      jobId: 'job-123',
    }));
  });
});
