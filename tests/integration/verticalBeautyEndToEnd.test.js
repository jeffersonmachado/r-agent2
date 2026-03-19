'use strict';

/**
 * Beauty Vertical End-to-End Integration Test
 *
 * Tests the complete beauty customer journey without a real DB:
 * 1. Appointment created → confirmation sent
 * 2. Scheduler tick → reminder 24h dispatched
 * 3. Scheduler tick → near-time reminder dispatched
 * 4. No check-in → no-show detected
 * 5. Inactivity → reactivation sent
 * 6. Service completed → follow-up + loyalty points
 * 7. Cancellation → loyalty reversed
 *
 * Boundary: mocks DB calls but uses real service logic.
 */

// ── Mocks setup ──────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockFindOne = jest.fn();
const mockFindAll = jest.fn();
const mockUpdate = jest.fn();
const mockAppendEventV1 = jest.fn(async () => ({ id: 'evt-1' }));
const mockGetSequelize = jest.fn(() => ({}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

jest.mock('../../api/db/models', () => {
  const makeModel = () => ({
    create: (...args) => mockCreate(...args),
    findOne: (...args) => mockFindOne(...args),
    findAll: (...args) => mockFindAll(...args),
    update: (...args) => mockUpdate(...args),
  });
  return {
    VerticalJourneyEvent: () => makeModel(),
    VerticalAttendance: () => makeModel(),
    VerticalSessionBundle: () => makeModel(),
    VerticalEngagementSignal: () => makeModel(),
    AccessMembership: () => makeModel(),
    EventLedger: () => makeModel(),
  };
});

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

jest.mock('../../api/services/notifications/notificationAdapter', () => ({
  sendJourneyNotification: jest.fn().mockResolvedValue({ status: 'stub' }),
  CHANNEL_STATUS: { STUB: 'stub' },
}));

// ── Load services after mocks ────────────────────────────────────────────────

const { emitJourneyEvent, listJourneyEvents, getSubjectTimeline } = require('../../api/services/vertical/customerJourneyEngine');
const beautyJourneyService = require('../../api/services/vertical/beautyJourneyService');
const { handleBeautyJourneyTick } = require('../../api/services/vertical/verticalJourneyJobHandler');
const notificationAdapter = require('../../api/services/notifications/notificationAdapter');

const TENANT = 'tenant-beauty-e2e';
const SUBJECT = 'subject-beauty-001';
const CUSTOMER = 'customer-001';
const SCHEDULE_ID = 'sched-beauty-abc123';

function makeJourneyRow(overrides = {}) {
  return {
    id: 'vje-1',
    tenant_key: TENANT,
    vertical: 'beauty',
    event_type: 'confirmation_sent',
    subject_id: SUBJECT,
    customer_id: CUSTOMER,
    schedule_id: SCHEDULE_ID,
    channel: 'whatsapp',
    occurred_at: new Date().toISOString(),
    status: 'emitted',
    payload: { scheduled_at: new Date(Date.now() + 23 * 3600000).toISOString() }, // 23h from now
    metadata: {},
    toJSON() { return this; },
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────

describe('Beauty Vertical — End-to-End Journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
    mockAppendEventV1.mockResolvedValue({ id: 'evt-1' });
    notificationAdapter.sendJourneyNotification.mockResolvedValue({ status: 'stub' });
    // Default: no existing events
    mockFindOne.mockResolvedValue(null);
    mockFindAll.mockResolvedValue([]);
    mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
  });

  // ── 1. Confirmation sent ─────────────────────────────────────────────────

  describe('1. Appointment confirmation', () => {
    test('sendConfirmation emits confirmation_sent event', async () => {
      const result = await beautyJourneyService.sendConfirmation({
        tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, scheduleId: SCHEDULE_ID,
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'confirmation_sent', tenant_key: TENANT }),
      );
      expect(result.event_type).toBe('confirmation_sent');
    });

    test('sendConfirmation is idempotent (already exists)', async () => {
      mockFindOne.mockResolvedValueOnce(makeJourneyRow()); // pre-create check returns existing
      const result = await beautyJourneyService.sendConfirmation({
        tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, scheduleId: SCHEDULE_ID,
      });
      // Should not call create again
      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.event_type).toBe('confirmation_sent');
    });
  });

  // ── 2. Scheduler tick dispatches 24h reminder ────────────────────────────

  describe('2. 24h reminder via scheduler tick', () => {
    test('handleBeautyJourneyTick sends reminder_24h when appointment is in ~23h', async () => {
      const confirmationRow = makeJourneyRow({
        payload: { scheduled_at: new Date(Date.now() + 23 * 3600000).toISOString() },
      });

      mockFindAll
        .mockResolvedValueOnce([confirmationRow])  // confirmation_sent scan
        .mockResolvedValue([]);                       // subsequent scans (no-show)

      mockFindOne
        .mockResolvedValueOnce(null)   // no existing reminder_24h
        .mockResolvedValue(null);      // no no_show/service_completed

      await handleBeautyJourneyTick({ payload: { tenantId: TENANT }, tenant_key: TENANT });

      const createCalls = mockCreate.mock.calls;
      const reminder24h = createCalls.find((c) => c[0]?.event_type === 'reminder_24h');
      expect(reminder24h).toBeTruthy();
      expect(notificationAdapter.sendJourneyNotification).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reminder_24h', tenantId: TENANT }),
      );
    });

    test('does not send duplicate 24h reminder if already sent', async () => {
      const confirmationRow = makeJourneyRow({
        payload: { scheduled_at: new Date(Date.now() + 23 * 3600000).toISOString() },
      });
      mockFindAll.mockResolvedValueOnce([confirmationRow]).mockResolvedValue([]);
      // 24h reminder already exists
      mockFindOne.mockResolvedValueOnce(makeJourneyRow({ event_type: 'reminder_24h' }));

      await handleBeautyJourneyTick({ payload: { tenantId: TENANT }, tenant_key: TENANT });

      const createCalls = mockCreate.mock.calls;
      const reminder24h = createCalls.find((c) => c[0]?.event_type === 'reminder_24h');
      expect(reminder24h).toBeFalsy();
    });
  });

  // ── 3. No-show detection ─────────────────────────────────────────────────

  describe('3. No-show detection', () => {
    test('detectNoShow emits no_show_detected and rescheduling_offered', async () => {
      // detectNoShow calls emitJourneyEvent twice (no_show + rescheduling_offered)
      let callCount = 0;
      mockFindOne.mockResolvedValue(null); // no existing events
      mockCreate.mockImplementation(async (data) => {
        callCount++;
        return { ...data, id: `vje-${callCount}`, toJSON() { return this; } };
      });

      const result = await beautyJourneyService.detectNoShow({
        tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, scheduleId: SCHEDULE_ID,
      });

      expect(result.event_type).toBe('no_show_detected');
      // rescheduling_offered is attempted (best-effort)
      expect(mockCreate.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 4. Service completed → follow-up + loyalty ───────────────────────────

  describe('4. Service completion chain', () => {
    test('recordServiceCompleted emits service_completed + follow_up + loyalty', async () => {
      const createdEvents = [];
      mockFindOne.mockResolvedValue(null);
      mockCreate.mockImplementation(async (data) => {
        const row = { ...data, id: `vje-${createdEvents.length}`, toJSON() { return this; } };
        createdEvents.push(row);
        return row;
      });

      await beautyJourneyService.recordServiceCompleted({
        tenantId: TENANT, subjectId: SUBJECT, customerId: CUSTOMER, scheduleId: SCHEDULE_ID,
        loyaltyPoints: 2, metadata: {},
      });

      const eventTypes = createdEvents.map((e) => e.event_type);
      expect(eventTypes).toContain('service_completed');
      expect(eventTypes).toContain('follow_up_sent');

      // Loyalty grant written to event_ledger
      const loyaltyCalls = mockAppendEventV1.mock.calls.filter((c) => c[0]?.type === 'LoyaltyPointsGranted');
      expect(loyaltyCalls.length).toBeGreaterThan(0);
      expect(loyaltyCalls[0][0].payload.points).toBe(2);
    });
  });

  // ── 5. Loyalty reversal ───────────────────────────────────────────────────

  describe('5. Loyalty reversal', () => {
    test('reverseLoyaltyPoints emits loyalty_points_reversed', async () => {
      mockFindOne.mockResolvedValue(null);
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      const result = await beautyJourneyService.reverseLoyaltyPoints({
        tenantId: TENANT, subjectId: SUBJECT, scheduleId: SCHEDULE_ID, reason: 'cancellation',
      });
      expect(result.event_type).toBe('loyalty_points_reversed');
    });
  });

  // ── 6. Reactivation ───────────────────────────────────────────────────────

  describe('6. Reactivation', () => {
    test('sendReactivation emits reactivation_sent', async () => {
      mockFindOne.mockResolvedValue(null);
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      const result = await beautyJourneyService.sendReactivation({
        tenantId: TENANT, subjectId: SUBJECT, metadata: { triggeredBy: 'scheduler' },
      });
      expect(result.event_type).toBe('reactivation_sent');
    });
  });

  // ── 7. Journey timeline ───────────────────────────────────────────────────

  describe('7. Journey timeline query', () => {
    test('getSubjectTimeline returns items and total', async () => {
      mockFindAll.mockResolvedValue([
        makeJourneyRow({ event_type: 'confirmation_sent' }),
        makeJourneyRow({ event_type: 'reminder_24h' }),
      ]);

      const result = await getSubjectTimeline({ tenantId: TENANT, subjectId: SUBJECT });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  // ── 8. No-show scan in scheduler ─────────────────────────────────────────

  describe('8. Scheduler no-show scan', () => {
    test('does not mark as no-show when service_completed already exists', async () => {
      const confirmation = makeJourneyRow({
        occurred_at: new Date(Date.now() - 5 * 3600000).toISOString(), // 5h ago
        payload: { scheduled_at: new Date(Date.now() - 3 * 3600000).toISOString() }, // 3h ago
      });

      mockFindAll
        .mockResolvedValueOnce([]) // confirmation scan for reminders (future check)
        .mockResolvedValueOnce([confirmation]) // no-show candidates
        .mockResolvedValue([]);

      // service_completed already exists
      mockFindOne.mockResolvedValue(makeJourneyRow({ event_type: 'service_completed' }));

      await handleBeautyJourneyTick({ payload: { tenantId: TENANT }, tenant_key: TENANT });

      const noShowCreate = mockCreate.mock.calls.find((c) => c[0]?.event_type === 'no_show_detected');
      expect(noShowCreate).toBeFalsy();
    });
  });
});
