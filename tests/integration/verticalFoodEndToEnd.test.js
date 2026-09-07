'use strict';

/**
 * Food Vertical End-to-End Integration Test
 *
 * Tests the complete food customer journey without a real DB:
 * 1. Order delivered → tick sends review request (idempotent per order)
 * 2. Review not duplicated on second tick
 * 3. Orders without customer context are skipped
 * 4. Reorder scan: inactive customer (>21d) → reorder campaign sent
 * 5. Reorder cooldown respected (14d)
 * 6. Recently active customer skipped
 * 7. Payment confirmation hook: markOrderPaymentStatus(paid) → journey event
 * 8. Full chain: order_placed → payment → delivered → review on customer timeline
 *
 * Boundary: mocks DB calls but uses real service logic.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFindAll = jest.fn();
const mockFindAndCountAll = jest.fn();
const mockUpdate = jest.fn();
const mockAppendEventV1 = jest.fn(async () => ({ id: 'evt-1' }));
const mockGetSequelize = jest.fn(() => ({}));
const mockQuery = jest.fn(async () => [[]]);

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

jest.mock('../../api/db/models', () => {
  function makeModel() {
    return {
      create: (...args) => mockCreate(...args),
      findOne: (...args) => mockFindOne(...args),
      findAll: (...args) => mockFindAll(...args),
      findAndCountAll: (...args) => mockFindAndCountAll(...args),
      update: (...args) => mockUpdate(...args),
      count: jest.fn(async () => 0),
    };
  }
  return {
    VerticalJourneyEvent: () => makeModel(),
    VerticalAttendance: () => makeModel(),
    VerticalSessionBundle: () => makeModel(),
    VerticalEngagementSignal: () => makeModel(),
    AccessMembership: () => makeModel(),
    EventLedger: () => makeModel(),
    BillingTransaction: () => makeModel(),
    Order: () => makeModel(),
  };
});

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
  queueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
}));

// ── Load services after mocks ────────────────────────────────────────────────

const foodJourneyService = require('../../api/services/vertical/foodJourneyService');
const { handleFoodJourneyTick, handleFoodReorderScan } = require('../../api/services/vertical/verticalJourneyJobHandler');
const orderService = require('../../api/services/orderService');
const notificationService = require('../../api/services/notificationService');

const TENANT = 'tenant-food-e2e';
const SUBJECT = 'subject-food-001';
const CUSTOMER = 'cust-food-001';
const ORDER_ID = 'order-food-001';

function daysAgoISO(d) {
  return new Date(Date.now() - d * 86400000).toISOString();
}

function makeOrderRow(overrides = {}) {
  const data = {
    id: ORDER_ID,
    tenant_key: TENANT,
    order_number: 100,
    status: 'delivered',
    source: 'whatsapp',
    delivered_at: daysAgoISO(1),
    context: { customerId: CUSTOMER, customerSubjectId: SUBJECT, correlationId: 'corr-1' },
    ...overrides,
  };
  return {
    ...data,
    toJSON() { return { ...data }; },
    update: jest.fn(async function (patch) { Object.assign(data, patch); return this; }),
    previous: () => 'dispatched',
  };
}

// Query-aware wiring
function wireQueryMocks({ deliveredOrders = [], reviewExists = null, recentCampaign = null, existingJourneyEvent = null } = {}) {
  mockFindAll.mockImplementation(async (options = {}) => {
    const { where } = options;
    if (where?.status === 'delivered') return deliveredOrders;
    return [];
  });

  mockFindOne.mockImplementation(async ({ where } = {}) => {
    if (where?.idempotency_key) {
      if (where.idempotency_key.startsWith('food_review:') && reviewExists) return reviewExists;
      return existingJourneyEvent;
    }
    if (where?.event_type === 'return_campaign_sent') return recentCampaign;
    return null;
  });

  mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
}

// ────────────────────────────────────────────────────────────────────────────

describe('Food Vertical — End-to-End Journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({ query: mockQuery });
    mockAppendEventV1.mockResolvedValue({ id: 'evt-1' });
    mockQuery.mockResolvedValue([[]]);
    mockFindAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    // resetMocks: true — rearmar implementações
    notificationService.enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
  });

  // ── 1. Post-delivery review scan ─────────────────────────────────────────

  describe('1. Post-delivery review', () => {
    test('tick sends review request for recently delivered order', async () => {
      wireQueryMocks({ deliveredOrders: [makeOrderRow()] });

      await handleFoodJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const reviews = created.filter((e) => e.event_type === 'review_requested');
      expect(reviews.length).toBe(1);
      expect(reviews[0].vertical).toBe('food');
      expect(reviews[0].customer_id).toBe(CUSTOMER);
      expect(reviews[0].payload.orderId).toBe(ORDER_ID);
    });

    test('does not duplicate review on second tick', async () => {
      wireQueryMocks({
        deliveredOrders: [makeOrderRow()],
        reviewExists: { id: 'vje-existing', event_type: 'review_requested', toJSON() { return this; } },
      });

      await handleFoodJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'review_requested').length).toBe(0);
    });

    test('skips orders without customer context', async () => {
      wireQueryMocks({ deliveredOrders: [makeOrderRow({ context: {} })] });

      await handleFoodJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'review_requested').length).toBe(0);
    });
  });

  // ── 2. Reorder scan ──────────────────────────────────────────────────────

  describe('2. Reorder campaign', () => {
    test('sends reorder campaign to customer inactive for 30 days', async () => {
      wireQueryMocks({
        deliveredOrders: [makeOrderRow({ delivered_at: daysAgoISO(30) })],
        recentCampaign: null,
      });

      await handleFoodReorderScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const campaigns = created.filter((e) => e.event_type === 'return_campaign_sent');
      expect(campaigns.length).toBe(1);
      expect(campaigns[0].customer_id).toBe(CUSTOMER);
      expect(campaigns[0].payload.daysSinceLastOrder).toBe(30);
    });

    test('respects 14d campaign cooldown', async () => {
      wireQueryMocks({
        deliveredOrders: [makeOrderRow({ delivered_at: daysAgoISO(30) })],
        recentCampaign: { id: 'vje-camp', event_type: 'return_campaign_sent', toJSON() { return this; } },
      });

      await handleFoodReorderScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'return_campaign_sent').length).toBe(0);
    });

    test('skips recently active customers', async () => {
      wireQueryMocks({
        deliveredOrders: [makeOrderRow({ delivered_at: daysAgoISO(5) })],
        recentCampaign: null,
      });

      await handleFoodReorderScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'return_campaign_sent').length).toBe(0);
    });
  });

  // ── 3. Payment confirmation hook ─────────────────────────────────────────

  describe('3. Payment confirmation on journey', () => {
    test('markOrderPaymentStatus(paid) records payment on customer journey', async () => {
      const orderRow = makeOrderRow({ context: { customerId: CUSTOMER, customerSubjectId: SUBJECT, correlationId: 'corr-1', payment: { status: 'pending' } } });
      mockFindOne.mockImplementation(async ({ where } = {}) => {
        if (where?.id === ORDER_ID) return orderRow;
        return null;
      });
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      const result = await orderService.markOrderPaymentStatus({ tenantId: TENANT, orderId: ORDER_ID, status: 'paid', transactionId: 'tx-1', amount: 59.9 });

      expect(result.idempotent).toBe(false);
      const created = mockCreate.mock.calls.map((c) => c[0]);
      const paymentEvents = created.filter((e) => e.event_type === 'confirmation_received' && e.payload?.context === 'order_payment');
      expect(paymentEvents.length).toBe(1);
      expect(paymentEvents[0].payload.orderId).toBe(ORDER_ID);
      expect(paymentEvents[0].payload.amount).toBe(59.9);
      expect(mockAppendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'OrderPaymentConfirmed' }),
      );
    });

    test('same payment status + transaction is idempotent (no journey event)', async () => {
      const orderRow = makeOrderRow({ context: { customerId: CUSTOMER, payment: { status: 'paid', transactionId: 'tx-1' } } });
      mockFindOne.mockImplementation(async ({ where } = {}) => {
        if (where?.id === ORDER_ID) return orderRow;
        return null;
      });

      const result = await orderService.markOrderPaymentStatus({ tenantId: TENANT, orderId: ORDER_ID, status: 'paid', transactionId: 'tx-1' });

      expect(result.idempotent).toBe(true);
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  // ── 4. Full chain on customer timeline ───────────────────────────────────

  describe('4. Full journey chain', () => {
    test('payment + review events are emittable on the same customer timeline', async () => {
      wireQueryMocks({});

      await foodJourneyService.recordPaymentConfirmed({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, orderId: ORDER_ID, amount: 59.9 });
      await foodJourneyService.requestReview({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, orderId: ORDER_ID });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const types = created.map((e) => e.event_type);
      expect(types).toContain('confirmation_received');
      expect(types).toContain('review_requested');
      for (const evt of created) {
        expect(evt.tenant_key).toBe(TENANT);
        expect(evt.vertical).toBe('food');
      }
    });
  });
});
