'use strict';

const mockFindOne = jest.fn();
const mockFindAll = jest.fn();
const mockSubFindOne = jest.fn();
const mockSubFindAll = jest.fn();
const mockGetSequelize = jest.fn(() => ({}));

const mockTxRow = {
  id: 'bt-1',
  tenant_key: 'tenant-1',
  provider: 'asaas',
  external_transaction_id: 'ext-1',
  vertical: 'fitness',
  membership_id: 'm-1',
  status: 'pending',
  metadata: {},
  paid_at: null,
  update: jest.fn(async function update(values) {
    Object.assign(this, values);
    return this;
  }),
  toJSON() { return this; },
};

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: (...args) => mockGetSequelize(...args),
}));

jest.mock('../../api/db/models', () => ({
  BillingTransaction: () => ({
    findOne: (...args) => mockFindOne(...args),
    findAll: (...args) => mockFindAll(...args),
  }),
  BillingSubscription: () => ({
    findOne: (...args) => mockSubFindOne(...args),
    findAll: (...args) => mockSubFindAll(...args),
  }),
  VerticalSessionBundle: () => ({ findOne: jest.fn(), findAll: jest.fn() }),
}));

const mockNormalizeProvider = jest.fn((p) => p || 'asaas');
const mockVerifyWebhookSignature = jest.fn(() => true);
const mockNormalizeWebhook = jest.fn();
const mockFetchTransactionStatus = jest.fn();
const mockFetchSubscriptionStatus = jest.fn();

jest.mock('../../api/integrations/paymentProvider', () => ({
  normalizeProvider: (...args) => mockNormalizeProvider(...args),
  verifyWebhookSignature: (...args) => mockVerifyWebhookSignature(...args),
  normalizeWebhook: (...args) => mockNormalizeWebhook(...args),
  fetchTransactionStatus: (...args) => mockFetchTransactionStatus(...args),
  fetchSubscriptionStatus: (...args) => mockFetchSubscriptionStatus(...args),
}));

const mockUpdateBillingStatus = jest.fn();
const mockReactivateMembership = jest.fn();
const mockBlockMembership = jest.fn();

jest.mock('../../api/services/vertical/billingOrchestrationService', () => ({
  updateBillingStatus: (...args) => mockUpdateBillingStatus(...args),
  reactivateMembership: (...args) => mockReactivateMembership(...args),
  blockMembership: (...args) => mockBlockMembership(...args),
}));

const billingService = require('../../api/services/billingService');

describe('billingService webhook + reconciliation hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
    mockVerifyWebhookSignature.mockReturnValue(true);
    mockNormalizeProvider.mockImplementation((p) => p || 'asaas');
    Object.assign(mockTxRow, {
      id: 'bt-1',
      tenant_key: 'tenant-1',
      provider: 'asaas',
      external_transaction_id: 'ext-1',
      vertical: 'fitness',
      membership_id: 'm-1',
      status: 'pending',
      metadata: {},
      paid_at: null,
    });
  });

  test('processWebhook is idempotent for same event/status dedupe key', async () => {
    mockNormalizeWebhook.mockReturnValue({
      eventId: 'evt-1',
      externalTransactionId: 'ext-1',
      externalSubscriptionId: null,
      status: 'pending',
      raw: { foo: 'bar' },
    });

    mockFindOne.mockResolvedValueOnce({
      ...mockTxRow,
      metadata: { webhookHistory: ['evt-1:pending'] },
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    });

    const out = await billingService.processWebhook({
      provider: 'asaas',
      body: { id: 'evt-1' },
      headers: { 'x-webhook-token': 'ok' },
    });

    expect(out.ok).toBe(true);
    expect(out.idempotent).toBe(true);
  });

  test('processWebhook ignores out-of-order transition confirmed -> pending', async () => {
    const row = {
      ...mockTxRow,
      status: 'confirmed',
      metadata: { webhookHistory: [] },
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockNormalizeWebhook.mockReturnValue({
      eventId: 'evt-2',
      externalTransactionId: 'ext-1',
      externalSubscriptionId: null,
      status: 'pending',
      raw: { foo: 'bar' },
    });
    mockFindOne.mockResolvedValueOnce(row);

    const out = await billingService.processWebhook({
      provider: 'asaas',
      body: { id: 'evt-2' },
      headers: { 'x-webhook-token': 'ok' },
    });

    expect(out.ok).toBe(true);
    expect(out.ignored).toBe(true);
    expect(out.reason).toBe('webhook_out_of_order_ignored');
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ webhookIgnoredOutOfOrder: true }),
    }));
    expect(mockReactivateMembership).not.toHaveBeenCalled();
    expect(mockBlockMembership).not.toHaveBeenCalled();
  });

  test('processWebhook resolves by externalSubscriptionId and applies cancelled rule', async () => {
    const row = {
      ...mockTxRow,
      external_transaction_id: null,
      external_subscription_id: 'sub-ext-1',
      status: 'confirmed',
      metadata: { webhookHistory: [] },
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockNormalizeWebhook.mockReturnValue({
      eventId: 'evt-sub-1',
      externalTransactionId: null,
      externalSubscriptionId: 'sub-ext-1',
      status: 'cancelled',
      raw: { foo: 'subscription-cancel' },
    });
    mockFindOne.mockResolvedValueOnce(row);
    mockUpdateBillingStatus.mockResolvedValueOnce({ ok: true });

    const out = await billingService.processWebhook({
      provider: 'asaas',
      body: { id: 'evt-sub-1' },
      headers: { 'x-webhook-token': 'ok' },
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe('cancelled');
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(mockUpdateBillingStatus).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'm-1',
      toStatus: 'cancelled',
    }));
  });

  test('processWebhook maps refunded as explicit terminal outcome with cancellation side effect', async () => {
    const row = {
      ...mockTxRow,
      status: 'confirmed',
      metadata: { webhookHistory: [] },
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockNormalizeWebhook.mockReturnValue({
      eventId: 'evt-ref-1',
      externalTransactionId: 'ext-1',
      externalSubscriptionId: null,
      status: 'refunded',
      raw: { foo: 'refund' },
    });
    mockFindOne.mockResolvedValueOnce(row);
    mockUpdateBillingStatus.mockResolvedValueOnce({ ok: true });

    const out = await billingService.processWebhook({
      provider: 'asaas',
      body: { id: 'evt-ref-1' },
      headers: { 'x-webhook-token': 'ok' },
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe('refunded');
    expect(mockUpdateBillingStatus).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'cancelled',
      reason: 'payment_refunded',
    }));
  });

  test('processWebhook maps chargeback as explicit terminal outcome with cancellation side effect', async () => {
    const row = {
      ...mockTxRow,
      status: 'confirmed',
      metadata: { webhookHistory: [] },
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockNormalizeWebhook.mockReturnValue({
      eventId: 'evt-cb-1',
      externalTransactionId: 'ext-1',
      externalSubscriptionId: null,
      status: 'chargeback',
      raw: { foo: 'chargeback' },
    });
    mockFindOne.mockResolvedValueOnce(row);
    mockUpdateBillingStatus.mockResolvedValueOnce({ ok: true });

    const out = await billingService.processWebhook({
      provider: 'asaas',
      body: { id: 'evt-cb-1' },
      headers: { 'x-webhook-token': 'ok' },
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe('chargeback');
    expect(mockUpdateBillingStatus).toHaveBeenCalledWith(expect.objectContaining({
      toStatus: 'cancelled',
      reason: 'payment_chargeback',
    }));
  });

  test('processWebhook keeps cancelled as terminal and ignores cancelled -> pending', async () => {
    const row = {
      ...mockTxRow,
      status: 'cancelled',
      metadata: { webhookHistory: [] },
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockNormalizeWebhook.mockReturnValue({
      eventId: 'evt-3',
      externalTransactionId: 'ext-1',
      externalSubscriptionId: null,
      status: 'pending',
      raw: { foo: 'bar' },
    });
    mockFindOne.mockResolvedValueOnce(row);

    const out = await billingService.processWebhook({
      provider: 'asaas',
      body: { id: 'evt-3' },
      headers: { 'x-webhook-token': 'ok' },
    });

    expect(out.ok).toBe(true);
    expect(out.ignored).toBe(true);
    expect(out.reason).toBe('webhook_out_of_order_ignored');
    expect(mockReactivateMembership).not.toHaveBeenCalled();
    expect(mockBlockMembership).not.toHaveBeenCalled();
    expect(mockUpdateBillingStatus).not.toHaveBeenCalled();
  });

  test('reconcileTransactions updates pending -> confirmed from provider pull', async () => {
    const row = {
      ...mockTxRow,
      status: 'pending',
      metadata: {},
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockFindAll.mockResolvedValueOnce([row]);
    mockFetchTransactionStatus.mockResolvedValueOnce({ status: 'confirmed', providerStatus: 'RECEIVED' });
    mockReactivateMembership.mockResolvedValueOnce({ ok: true });

    const out = await billingService.reconcileTransactions({ tenantId: 'tenant-1', limit: 50 });

    expect(out.ok).toBe(true);
    expect(out.scanned).toBe(1);
    expect(out.updated).toBe(1);
    expect(out.failed).toBe(0);
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
    expect(mockReactivateMembership).toHaveBeenCalledTimes(1);
  });

  test('shouldApplyWebhookTransition helper enforces terminal and monotonic behavior', () => {
    expect(billingService.shouldApplyWebhookTransition('pending', 'confirmed')).toBe(true);
    expect(billingService.shouldApplyWebhookTransition('confirmed', 'pending')).toBe(false);
    expect(billingService.shouldApplyWebhookTransition('cancelled', 'pending')).toBe(false);
    expect(billingService.shouldApplyWebhookTransition('confirmed', 'refunded')).toBe(true);
    expect(billingService.shouldApplyWebhookTransition('confirmed', 'chargeback')).toBe(true);
    expect(billingService.shouldApplyWebhookTransition('refunded', 'confirmed')).toBe(false);
    expect(billingService.shouldApplyWebhookTransition('overdue', 'confirmed')).toBe(true);
  });

  test('reconcileSubscriptions updates subscription status and applies membership rule', async () => {
    const row = {
      id: 'bs-1',
      tenant_key: 'tenant-1',
      provider: 'asaas',
      external_subscription_id: 'sub-ext-1',
      vertical: 'fitness',
      membership_id: 'm-1',
      status: 'pending',
      metadata: {},
      cancelled_at: null,
      update: jest.fn(async function update(values) {
        Object.assign(this, values);
        return this;
      }),
      toJSON() { return this; },
    };

    mockSubFindAll.mockResolvedValueOnce([row]);
    mockFetchSubscriptionStatus.mockResolvedValueOnce({ status: 'confirmed', providerStatus: 'ACTIVE' });
    mockReactivateMembership.mockResolvedValueOnce({ ok: true });

    const out = await billingService.reconcileSubscriptions({ tenantId: 'tenant-1', limit: 10 });

    expect(out.ok).toBe(true);
    expect(out.scanned).toBe(1);
    expect(out.updated).toBe(1);
    expect(row.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }));
    expect(mockReactivateMembership).toHaveBeenCalledWith(expect.objectContaining({
      membershipId: 'm-1',
      reason: 'subscription_confirmed',
    }));
  });
});
