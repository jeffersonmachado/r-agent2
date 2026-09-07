'use strict';

/**
 * Market Vertical End-to-End Integration Test
 *
 * Tests the complete market journey without a real DB:
 * 1. Purchase completed → journey event (idempotent per order)
 * 2. Review tick: delivered order <48h → review_requested (not duplicated)
 * 3. Restock scan: last purchase ≥30d → restock_reminder_sent
 * 4. Win-back scan: last purchase ≥60d → loyalty_campaign_sent
 * 5. Fresh purchase (<30d) → no campaign
 * 6. Cooldown: recent campaign suppresses new ones
 * 7. computeRepeatPurchase: repeat rate aggregation (dashboard)
 *
 * Boundary: mocks DB calls but uses real service logic.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFindAll = jest.fn();
const mockOrderFindAll = jest.fn();
const mockGetSequelize = jest.fn(() => ({}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

jest.mock('../../api/db/models', () => {
  function makeModel() {
    return {
      create: (...args) => mockCreate(...args),
      findOne: (...args) => mockFindOne(...args),
      findAll: (...args) => mockFindAll(...args),
      update: jest.fn(async () => [1]),
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
    Order: () => ({
      findAll: (...args) => mockOrderFindAll(...args),
      findOne: (...args) => mockFindOne(...args),
    }),
  };
});

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'evt-1' })),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
  queueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
}));

// ── Load services after mocks ────────────────────────────────────────────────

const eventLedgerService = require('../../api/services/eventLedgerService');
const marketJourneyService = require('../../api/services/vertical/marketJourneyService');
const { handleMarketJourneyTick, handleMarketRestockScan } = require('../../api/services/vertical/verticalJourneyJobHandler');
const { computeRepeatPurchase } = require('../../api/modules/vertical/handleMarketRoutes');

const TENANT = 'tenant-market-e2e';

function daysAgoISO(d) {
  return new Date(Date.now() - d * 86400000).toISOString();
}

function deliveredOrder(id, customerId, deliveredDaysAgo) {
  return {
    id,
    order_number: `P-${id}`,
    source: 'whatsapp',
    status: 'delivered',
    delivered_at: daysAgoISO(deliveredDaysAgo),
    context: { customerId, customerSubjectId: `subj-${customerId}` },
    toJSON() { const { toJSON, ...rest } = this; return rest; },
  };
}

describe('Market Vertical — End-to-End Journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
    eventLedgerService.appendEventV1.mockResolvedValue({ id: 'evt-1' });
    mockFindOne.mockImplementation(async () => null);
    mockFindAll.mockImplementation(async () => []);
    mockOrderFindAll.mockImplementation(async () => []);
    mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
  });

  // ── 1. Purchase completed ────────────────────────────────────────────────
  describe('1. Purchase completed', () => {
    test('registra purchase_completed idempotente por pedido', async () => {
      await marketJourneyService.recordPurchaseCompleted({ tenantId: TENANT, customerId: 'cust-1', orderId: 'o1', amount: 199.9 });
      const call = mockCreate.mock.calls.find((c) => c[0].event_type === 'purchase_completed');
      expect(call).toBeTruthy();
      expect(call[0].idempotency_key).toBe(`market_purchase:${TENANT}:o1`);
      expect(call[0].payload.amount).toBe(199.9);
    });
  });

  // ── 2. Review tick ───────────────────────────────────────────────────────
  describe('2. Review tick pós-entrega', () => {
    test('pedido entregue <48h gera review_requested; segundo tick não duplica', async () => {
      mockOrderFindAll.mockImplementation(async () => [deliveredOrder('o2', 'cust-2', 1)]);

      await handleMarketJourneyTick({ payload: { tenantId: TENANT } });
      let reviews = mockCreate.mock.calls.filter((c) => c[0].event_type === 'review_requested');
      expect(reviews.length).toBe(1);
      expect(reviews[0][0].idempotency_key).toBe(`market_review:${TENANT}:o2`);

      // Segundo tick: o evento já existe → findOne retorna existente
      mockFindOne.mockImplementation(async () => ({ id: 'vje-existing' }));
      await handleMarketJourneyTick({ payload: { tenantId: TENANT } });
      reviews = mockCreate.mock.calls.filter((c) => c[0].event_type === 'review_requested');
      expect(reviews.length).toBe(1);
    });

    test('pedido sem cliente é ignorado', async () => {
      mockOrderFindAll.mockImplementation(async () => [{
        id: 'o3', status: 'delivered', delivered_at: daysAgoISO(1), context: {},
        toJSON() { const { toJSON, ...rest } = this; return rest; },
      }]);
      await handleMarketJourneyTick({ payload: { tenantId: TENANT } });
      expect(mockCreate.mock.calls.filter((c) => c[0].event_type === 'review_requested').length).toBe(0);
    });
  });

  // ── 3. Restock scan ──────────────────────────────────────────────────────
  describe('3. Restock scan (reposição)', () => {
    test('última compra ≥30d → restock_reminder_sent', async () => {
      mockOrderFindAll.mockImplementation(async () => [deliveredOrder('o4', 'cust-4', 35)]);
      await handleMarketRestockScan({ tenantId: TENANT });
      const restock = mockCreate.mock.calls.filter((c) => c[0].event_type === 'restock_reminder_sent');
      expect(restock.length).toBe(1);
      expect(restock[0][0].payload.daysSinceLastPurchase).toBe(35);
      expect(mockCreate.mock.calls.filter((c) => c[0].event_type === 'loyalty_campaign_sent').length).toBe(0);
    });

    test('compra fresca (<30d) não gera campanha', async () => {
      mockOrderFindAll.mockImplementation(async () => [deliveredOrder('o5', 'cust-5', 5)]);
      await handleMarketRestockScan({ tenantId: TENANT });
      expect(mockCreate.mock.calls.filter((c) => ['restock_reminder_sent', 'loyalty_campaign_sent'].includes(c[0].event_type)).length).toBe(0);
    });
  });

  // ── 4. Win-back ──────────────────────────────────────────────────────────
  describe('4. Win-back (fidelização)', () => {
    test('última compra ≥60d → loyalty_campaign_sent', async () => {
      mockOrderFindAll.mockImplementation(async () => [deliveredOrder('o6', 'cust-6', 75)]);
      await handleMarketRestockScan({ tenantId: TENANT });
      const loyalty = mockCreate.mock.calls.filter((c) => c[0].event_type === 'loyalty_campaign_sent');
      expect(loyalty.length).toBe(1);
      expect(loyalty[0][0].payload.reason).toBe('win_back');
      expect(mockCreate.mock.calls.filter((c) => c[0].event_type === 'restock_reminder_sent').length).toBe(0);
    });

    test('cooldown: campanha recente suprime nova', async () => {
      mockOrderFindAll.mockImplementation(async () => [deliveredOrder('o7', 'cust-7', 40)]);
      // findOne → já existe campanha dentro do cooldown
      mockFindOne.mockImplementation(async () => ({ id: 'vje-campaign-recent' }));
      await handleMarketRestockScan({ tenantId: TENANT });
      expect(mockCreate.mock.calls.filter((c) => ['restock_reminder_sent', 'loyalty_campaign_sent'].includes(c[0].event_type)).length).toBe(0);
    });
  });

  // ── 5. computeRepeatPurchase (dashboard) ─────────────────────────────────
  describe('5. computeRepeatPurchase', () => {
    test('agrega clientes e taxa de recompra', async () => {
      mockOrderFindAll.mockImplementation(async () => [
        deliveredOrder('a1', 'cust-a', 2),
        deliveredOrder('a2', 'cust-a', 10),
        deliveredOrder('b1', 'cust-b', 3),
        deliveredOrder('c1', 'cust-c', 4),
        deliveredOrder('c2', 'cust-c', 12),
        deliveredOrder('c3', 'cust-c', 20),
      ]);
      const repeat = await computeRepeatPurchase({ tenantId: TENANT, windowDays: 30 });
      expect(repeat.customers).toBe(3);
      expect(repeat.repeatCustomers).toBe(2);
      expect(repeat.repeatRate).toBe(0.667);
    });

    test('sem pedidos → taxa zero', async () => {
      mockOrderFindAll.mockImplementation(async () => []);
      const repeat = await computeRepeatPurchase({ tenantId: TENANT, windowDays: 30 });
      expect(repeat).toEqual({ customers: 0, repeatCustomers: 0, repeatRate: 0 });
    });
  });
});
