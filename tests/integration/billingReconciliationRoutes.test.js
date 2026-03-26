'use strict';

const mockSendJson = jest.fn();
const mockRequireAuth = jest.fn(() => ({ valid: true }));
const mockRequireTenant = jest.fn(() => 'tenant-int');
const mockReconcileTransactions = jest.fn(async () => ({ ok: true, scanned: 5, updated: 2, unchanged: 3, failed: 0 }));
const mockReconcileSubscriptions = jest.fn(async () => ({ ok: true, scanned: 3, updated: 1, unchanged: 2, failed: 0 }));
const mockAppendEventV1 = jest.fn(async () => ({}));

jest.mock('../../api/services/billingService', () => ({
  reconcileTransactions: (...args) => mockReconcileTransactions(...args),
  reconcileSubscriptions: (...args) => mockReconcileSubscriptions(...args),
  createCharge: jest.fn(),
  processWebhook: jest.fn(),
}));

jest.mock('../../api/middleware/auth', () => ({
  requireAuth: (...args) => mockRequireAuth(...args),
}));

jest.mock('../../api/composition/shared/requireTenant', () => ({
  requireTenant: (...args) => mockRequireTenant(...args),
}));

jest.mock('../../api/express/httpHelpers', () => ({
  sendJson: (...args) => mockSendJson(...args),
  badRequest: jest.fn(),
  hasJsonContentType: jest.fn(() => false),
  parseJsonBody: jest.fn(async () => ({})),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

const { handleBillingRoutes } = require('../../api/modules/billing/handleBillingRoutes');

describe('Billing reconcile route integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockImplementation(() => ({ valid: true }));
    mockRequireTenant.mockImplementation(() => 'tenant-int');
    mockReconcileTransactions.mockImplementation(async () => ({ ok: true, scanned: 5, updated: 2, unchanged: 3, failed: 0 }));
    mockReconcileSubscriptions.mockImplementation(async () => ({ ok: true, scanned: 3, updated: 1, unchanged: 2, failed: 0 }));
    mockAppendEventV1.mockImplementation(async () => ({}));
  });

  test('POST /billing/reconcile returns transactions + subscriptions and appends snapshot event', async () => {
    const req = {
      method: 'POST',
      tenantId: 'tenant-int',
      agent: { id: 'agent-1' },
      headers: {},
    };
    const res = {};

    const handled = await handleBillingRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/billing/reconcile',
    });

    expect(handled).toBe(true);
    expect(mockReconcileTransactions).toHaveBeenCalledWith({ tenantId: 'tenant-int', limit: 100 });
    expect(mockReconcileSubscriptions).toHaveBeenCalledWith({ tenantId: 'tenant-int', limit: 100 });
    expect(mockSendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      transactions: expect.objectContaining({ updated: 2 }),
      subscriptions: expect.objectContaining({ updated: 1 }),
    }));
    expect(mockAppendEventV1).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-int',
      source: 'billing.reconciliation.manual',
    }));
  });
});
