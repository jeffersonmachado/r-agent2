'use strict';

/**
 * Services Vertical End-to-End Integration Test
 *
 * Tests the complete services journey without a real DB:
 * 1. Quote sent → approved → charge issued (billing record + journey event)
 * 2. Quote approved is idempotent per quote (billing idempotency key)
 * 3. Follow-up scan: unanswered quote > 3d → quote_follow_up_sent
 * 4. Follow-up not duplicated inside the window
 * 5. Expiry scan: quote > validDays without decision → quote_expired
 * 6. Decided quotes are untouched by the scheduler
 * 7. Service scheduled → delivered → follow-up + ledger
 * 8. Quote pipeline aggregation (dashboard): pending/approved/rate/decision time
 *
 * Boundary: mocks DB calls but uses real service logic.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFindAll = jest.fn();
const mockUpdate = jest.fn();
const mockAppendEventV1 = jest.fn(async () => ({ id: 'evt-1' }));
const mockGetSequelize = jest.fn(() => ({}));
const mockCreateCharge = jest.fn(async () => ({ id: 'tx-1', status: 'pending' }));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

jest.mock('../../api/db/models', () => {
  function makeModel() {
    return {
      create: (...args) => mockCreate(...args),
      findOne: (...args) => mockFindOne(...args),
      findAll: (...args) => mockFindAll(...args),
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
  };
});

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
  queueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
}));

jest.mock('../../api/services/billingService', () => ({
  createCharge: (...args) => mockCreateCharge(...args),
}));

// ── Load services after mocks ────────────────────────────────────────────────

const servicesJourneyService = require('../../api/services/vertical/servicesJourneyService');
const { handleServicesJourneyTick } = require('../../api/services/vertical/verticalJourneyJobHandler');
const { computeQuotePipeline } = require('../../api/modules/vertical/handleServicesRoutes');
const notificationService = require('../../api/services/notificationService');

const TENANT = 'tenant-services-e2e';
const SUBJECT = 'subject-svc-001';
const CUSTOMER = 'cust-svc-001';
const QUOTE = 'quote-svc-001';

function daysAgoISO(d) {
  return new Date(Date.now() - d * 86400000).toISOString();
}

function makeQuoteSent(overrides = {}) {
  const data = {
    id: 'vje-quote-1',
    tenant_key: TENANT,
    vertical: 'services',
    subject_id: SUBJECT,
    customer_id: CUSTOMER,
    event_type: 'quote_sent',
    channel: 'whatsapp',
    payload: { quoteId: QUOTE, amount: 1500, validDays: 15 },
    occurred_at: daysAgoISO(1),
    ...overrides,
  };
  return { ...data, toJSON() { return { ...data }; } };
}

// Query-aware wiring for the scheduler (3 parallel findAll queries)
function wireSchedulerMocks({ quotes = [], decisions = [], followUps = [] } = {}) {
  mockFindAll.mockImplementation(async ({ where } = {}) => {
    if (where?.event_type === 'quote_sent') return quotes;
    if (where?.event_type === 'quote_follow_up_sent') return followUps;
    if (where?.event_type) return decisions; // Op.in decisions
    return [];
  });
  mockFindOne.mockImplementation(async () => null); // idempotency checks → not found
  mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
}

// ────────────────────────────────────────────────────────────────────────────

describe('Services Vertical — End-to-End Journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
    mockAppendEventV1.mockResolvedValue({ id: 'evt-1' });
    mockCreateCharge.mockResolvedValue({ id: 'tx-1', status: 'pending' });
    notificationService.enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
  });

  // ── 1. Quote → approval → charge ─────────────────────────────────────────

  describe('1. Quote approval chain', () => {
    test('quote sent → approved → charge issued with billing record', async () => {
      mockFindOne.mockImplementation(async () => null);
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      await servicesJourneyService.sendQuote({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, quoteId: QUOTE, amount: 1500 });
      await servicesJourneyService.recordQuoteApproved({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, quoteId: QUOTE, amount: 1500, dueDate: '2026-09-20' });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const types = created.map((e) => e.event_type);
      expect(types).toContain('quote_sent');
      expect(types).toContain('quote_approved');
      expect(types).toContain('charge_issued');
      expect(mockCreateCharge).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'services', amount: 1500, idempotencyKey: `services_charge:${TENANT}:${QUOTE}` }),
      );
    });

    test('approval without amount does not charge', async () => {
      mockFindOne.mockImplementation(async () => null);
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      await servicesJourneyService.recordQuoteApproved({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, quoteId: QUOTE, amount: null });

      expect(mockCreateCharge).not.toHaveBeenCalled();
      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'charge_issued').length).toBe(0);
    });
  });

  // ── 2. Follow-up scan ────────────────────────────────────────────────────

  describe('2. Quote follow-up', () => {
    test('sends follow-up for quote unanswered for 5 days', async () => {
      wireSchedulerMocks({ quotes: [makeQuoteSent({ occurred_at: daysAgoISO(5) })] });

      await handleServicesJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const followUps = created.filter((e) => e.event_type === 'quote_follow_up_sent');
      expect(followUps.length).toBe(1);
      expect(followUps[0].payload.quoteId).toBe(QUOTE);
    });

    test('does not duplicate follow-up inside the window', async () => {
      wireSchedulerMocks({
        quotes: [makeQuoteSent({ occurred_at: daysAgoISO(5) })],
        followUps: [{ payload: { quoteId: QUOTE }, toJSON() { return this; } }],
      });

      await handleServicesJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'quote_follow_up_sent').length).toBe(0);
    });

    test('skips fresh quotes (< 3d)', async () => {
      wireSchedulerMocks({ quotes: [makeQuoteSent({ occurred_at: daysAgoISO(1) })] });

      await handleServicesJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'quote_follow_up_sent').length).toBe(0);
    });
  });

  // ── 3. Expiry scan ───────────────────────────────────────────────────────

  describe('3. Quote expiry', () => {
    test('expires quote past validDays without decision', async () => {
      wireSchedulerMocks({ quotes: [makeQuoteSent({ occurred_at: daysAgoISO(20) })] });

      await handleServicesJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const expired = created.filter((e) => e.event_type === 'quote_expired');
      expect(expired.length).toBe(1);
      expect(expired[0].payload.quoteId).toBe(QUOTE);
      // expiry is terminal: no follow-up for the same quote
      expect(created.filter((e) => e.event_type === 'quote_follow_up_sent').length).toBe(0);
    });

    test('respects per-quote validDays', async () => {
      wireSchedulerMocks({ quotes: [makeQuoteSent({ occurred_at: daysAgoISO(10), payload: { quoteId: QUOTE, amount: 1500, validDays: 30 } })] });

      await handleServicesJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'quote_expired').length).toBe(0);
      // but follow-up applies (> 3d)
      expect(created.filter((e) => e.event_type === 'quote_follow_up_sent').length).toBe(1);
    });
  });

  // ── 4. Decided quotes untouched ──────────────────────────────────────────

  describe('4. Decided quotes are terminal', () => {
    test('approved quote gets no follow-up and no expiry', async () => {
      wireSchedulerMocks({
        quotes: [makeQuoteSent({ occurred_at: daysAgoISO(20) })],
        decisions: [{ payload: { quoteId: QUOTE }, event_type: 'quote_approved', toJSON() { return this; } }],
      });

      await handleServicesJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'quote_follow_up_sent').length).toBe(0);
      expect(created.filter((e) => e.event_type === 'quote_expired').length).toBe(0);
    });
  });

  // ── 5. Service delivery ──────────────────────────────────────────────────

  describe('5. Service delivery', () => {
    test('scheduled → delivered → follow-up + ledger', async () => {
      mockFindOne.mockImplementation(async () => null);
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      await servicesJourneyService.recordServiceScheduled({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, quoteId: QUOTE, scheduleId: 'sched-1', scheduledAt: '2026-09-10T14:00:00Z' });
      await servicesJourneyService.recordServiceDelivered({ tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, quoteId: QUOTE, scheduleId: 'sched-1' });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const types = created.map((e) => e.event_type);
      expect(types).toContain('pre_service');
      expect(types).toContain('service_completed');
      expect(types).toContain('follow_up_sent');
      expect(mockAppendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ServicesJobDelivered' }),
      );
    });
  });

  // ── 6. Quote pipeline aggregation ────────────────────────────────────────

  describe('6. Quote pipeline (dashboard)', () => {
    test('aggregates states, approval rate and decision time', async () => {
      const events = [
        { event_type: 'quote_sent', payload: { quoteId: 'q1', amount: 1000 }, occurred_at: daysAgoISO(10), toJSON() { return this; } },
        { event_type: 'quote_approved', payload: { quoteId: 'q1' }, occurred_at: daysAgoISO(8), toJSON() { return this; } },
        { event_type: 'quote_sent', payload: { quoteId: 'q2', amount: 500 }, occurred_at: daysAgoISO(6), toJSON() { return this; } },
        { event_type: 'quote_declined', payload: { quoteId: 'q2' }, occurred_at: daysAgoISO(4), toJSON() { return this; } },
        { event_type: 'quote_sent', payload: { quoteId: 'q3', amount: 800 }, occurred_at: daysAgoISO(2), toJSON() { return this; } },
        { event_type: 'quote_sent', payload: { quoteId: 'q4', amount: 300 }, occurred_at: daysAgoISO(30), toJSON() { return this; } },
        { event_type: 'quote_expired', payload: { quoteId: 'q4' }, occurred_at: daysAgoISO(16), toJSON() { return this; } },
      ];
      mockFindAll.mockImplementation(async () => events);

      const pipeline = await computeQuotePipeline({ tenantId: TENANT, windowDays: 45 });

      expect(pipeline.total).toBe(4);
      expect(pipeline.approved).toBe(1);
      expect(pipeline.declined).toBe(1);
      expect(pipeline.expired).toBe(1);
      expect(pipeline.pending).toBe(1);
      expect(pipeline.approvalRate).toBe(0.25);
      expect(pipeline.approvedAmount).toBe(1000);
      // decisões: q1 em 2d, q2 em 2d, q4 em 14d → média (2+2+14)/3 = 6
      expect(pipeline.avgDecisionDays).toBe(6);
    });
  });
});
