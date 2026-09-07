'use strict';

/**
 * Clinic Vertical End-to-End Integration Test
 *
 * Tests the complete clinic patient journey without a real DB:
 * 1. Confirmation → tick dispatches 24h reminder
 * 2. Near-time reminder (1h)
 * 3. No-show scan: missed consultation → no_show_detected + rescheduling_offered
 * 4. Check-in prevents no-show detection
 * 5. Consultation completed → service_completed + follow-up + ledger
 * 6. Recall scan: old patient → return_campaign_sent; cooldown respected
 * 7. Recall recommendation via engagement signal
 * 8. Idempotency: duplicate confirmation returns existing event
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

// ── Load services after mocks ────────────────────────────────────────────────

const clinicJourneyService = require('../../api/services/vertical/clinicJourneyService');
const { handleClinicJourneyTick, handleClinicNoShowScan, handleClinicRecallScan } = require('../../api/services/vertical/verticalJourneyJobHandler');
const { clinicRecallSuggestion } = require('../../api/services/vertical/verticalRecommendationService');

const TENANT = 'tenant-clinic-e2e';
const SUBJECT = 'subject-clinic-001';
const SCHEDULE = 'sched-clinic-001';

function makeJourneyRow(overrides = {}) {
  return {
    id: 'vje-1',
    tenant_key: TENANT,
    vertical: 'clinic',
    subject_id: SUBJECT,
    customer_id: 'cust-1',
    schedule_id: SCHEDULE,
    event_type: 'confirmation_sent',
    channel: 'whatsapp',
    payload: {},
    metadata: {},
    occurred_at: new Date().toISOString(),
    toJSON() { return this; },
    ...overrides,
  };
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600000).toISOString();
}

// Query-aware mock wiring: distinguishes journey events vs attendance by where clause
function wireQueryMocks({ confirmations = [], resolvedEvent = null, oldAttendanceSubjects = [], recentAttendanceSubjects = [], recentRecall = null, lastAttendance = null } = {}) {
  mockFindAll.mockImplementation(async (options = {}) => {
    const { where } = options;
    if (where?.event_type === 'confirmation_sent') return confirmations;
    if (where?.checked_in_at) {
      // attendance queries: the "old" (recall window) query uses group by subject_id
      if (options.group) return oldAttendanceSubjects.map((sid) => ({ subject_id: sid, toJSON() { return this; } }));
      return recentAttendanceSubjects.map((sid) => ({ subject_id: sid, toJSON() { return this; } }));
    }
    return [];
  });

  mockFindOne.mockImplementation(async ({ where } = {}) => {
    if (where?.idempotency_key) return null; // idempotency check → not found
    if (where?.event_type === 'return_campaign_sent') return recentRecall;
    if (where?.event_type) return resolvedEvent; // resolved event check (checkin/completed/noshow)
    if (where?.subject_id && where?.vertical === 'clinic') return lastAttendance; // last attendance lookup
    return null;
  });

  mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
}

// ────────────────────────────────────────────────────────────────────────────

describe('Clinic Vertical — End-to-End Journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
    mockAppendEventV1.mockResolvedValue({ id: 'evt-1' });
  });

  // ── 1. Confirmation → 24h reminder dispatch ─────────────────────────────

  describe('1. Tick dispatches 24h reminder', () => {
    test('sends reminder_24h for consultation ~20h away', async () => {
      wireQueryMocks({
        confirmations: [makeJourneyRow({ payload: { scheduled_at: hoursFromNow(20) } })],
      });

      await handleClinicJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const reminders = created.filter((e) => e.event_type === 'reminder_24h');
      expect(reminders.length).toBe(1);
      expect(reminders[0].vertical).toBe('clinic');
      expect(reminders[0].schedule_id).toBe(SCHEDULE);
    });

    test('does not duplicate reminder when reminder_24h already exists', async () => {
      wireQueryMocks({
        confirmations: [makeJourneyRow({ payload: { scheduled_at: hoursFromNow(20) } })],
        resolvedEvent: makeJourneyRow({ event_type: 'reminder_24h' }),
      });

      await handleClinicJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'reminder_24h').length).toBe(0);
    });
  });

  // ── 2. Near-time reminder ────────────────────────────────────────────────

  describe('2. Near-time reminder', () => {
    test('sends reminder_1h for consultation ~1h away', async () => {
      wireQueryMocks({
        confirmations: [makeJourneyRow({ payload: { scheduled_at: hoursFromNow(1) } })],
      });

      await handleClinicJourneyTick({ payload: { tenantId: TENANT } });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'reminder_1h').length).toBe(1);
    });
  });

  // ── 3. No-show scan ──────────────────────────────────────────────────────

  describe('3. No-show detection', () => {
    test('detects no-show for consultation 3h past with no check-in', async () => {
      wireQueryMocks({
        confirmations: [makeJourneyRow({ payload: { scheduled_at: hoursFromNow(-3) } })],
        resolvedEvent: null,
      });

      await handleClinicNoShowScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const types = created.map((e) => e.event_type);
      expect(types).toContain('no_show_detected');
      expect(types).toContain('rescheduling_offered'); // reoferta de encaixe automática
    });

    test('skips no-show when patient checked in', async () => {
      wireQueryMocks({
        confirmations: [makeJourneyRow({ payload: { scheduled_at: hoursFromNow(-3) } })],
        resolvedEvent: makeJourneyRow({ event_type: 'checkin_recorded' }),
      });

      await handleClinicNoShowScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'no_show_detected').length).toBe(0);
    });

    test('skips future consultations', async () => {
      wireQueryMocks({
        confirmations: [makeJourneyRow({ payload: { scheduled_at: hoursFromNow(5) } })],
        resolvedEvent: null,
      });

      await handleClinicNoShowScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'no_show_detected').length).toBe(0);
    });
  });

  // ── 4. Consultation completion ───────────────────────────────────────────

  describe('4. Consultation completion', () => {
    test('emits service_completed + follow_up + ledger', async () => {
      wireQueryMocks({});

      await clinicJourneyService.recordConsultationCompleted({
        tenantId: TENANT, subjectId: SUBJECT, scheduleId: SCHEDULE,
      });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const types = created.map((e) => e.event_type);
      expect(types).toContain('service_completed');
      expect(types).toContain('follow_up_sent');
      expect(mockAppendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ClinicConsultationCompleted' }),
      );
    });
  });

  // ── 5. Recall scan ───────────────────────────────────────────────────────

  describe('5. Recall scan', () => {
    test('sends recall to patient overdue for return', async () => {
      wireQueryMocks({
        oldAttendanceSubjects: [SUBJECT],
        recentAttendanceSubjects: [],
        recentRecall: null,
      });

      await handleClinicRecallScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      const recalls = created.filter((e) => e.event_type === 'return_campaign_sent');
      expect(recalls.length).toBe(1);
      expect(recalls[0].subject_id).toBe(SUBJECT);
    });

    test('respects 90d recall cooldown', async () => {
      wireQueryMocks({
        oldAttendanceSubjects: [SUBJECT],
        recentAttendanceSubjects: [],
        recentRecall: makeJourneyRow({ event_type: 'return_campaign_sent' }),
      });

      await handleClinicRecallScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'return_campaign_sent').length).toBe(0);
    });

    test('skips patients with recent attendance', async () => {
      wireQueryMocks({
        oldAttendanceSubjects: [SUBJECT],
        recentAttendanceSubjects: [SUBJECT],
        recentRecall: null,
      });

      await handleClinicRecallScan({ tenantId: TENANT });

      const created = mockCreate.mock.calls.map((c) => c[0]);
      expect(created.filter((e) => e.event_type === 'return_campaign_sent').length).toBe(0);
    });
  });

  // ── 6. Recall recommendation ─────────────────────────────────────────────

  describe('6. Recall recommendation', () => {
    test('suggests send_recall for patient 200d without consultation', async () => {
      const lastAt = new Date(Date.now() - 200 * 86400000).toISOString();
      wireQueryMocks({
        lastAttendance: { subject_id: SUBJECT, checked_in_at: lastAt, toJSON() { return this; } },
      });

      const result = await clinicRecallSuggestion({ tenantId: TENANT, subjectId: SUBJECT });

      expect(result.suggestion).toBe('send_recall');
      expect(result.reason).toContain('200');
      expect(result.vertical).toBe('clinic');
    });

    test('suggests none for recently seen patient', async () => {
      const lastAt = new Date(Date.now() - 10 * 86400000).toISOString();
      wireQueryMocks({
        recentAttendanceSubjects: [],
        lastAttendance: { subject_id: SUBJECT, checked_in_at: lastAt, toJSON() { return this; } },
      });
      // recent attendance window query must return the recent row
      mockFindAll.mockImplementation(async ({ where } = {}) => {
        if (where?.checked_in_at) {
          return [{ subject_id: SUBJECT, checked_in_at: lastAt, status: 'completed', toJSON() { return this; } }];
        }
        return [];
      });

      const result = await clinicRecallSuggestion({ tenantId: TENANT, subjectId: SUBJECT });

      expect(result.suggestion).toBe('none');
    });
  });

  // ── 7. Idempotency ───────────────────────────────────────────────────────

  describe('7. Idempotency', () => {
    test('duplicate confirmation returns existing event without create', async () => {
      const existing = makeJourneyRow({ id: 'vje-existing' });
      mockFindOne.mockImplementation(async ({ where } = {}) => {
        if (where?.idempotency_key) return existing;
        return null;
      });
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      const result = await clinicJourneyService.sendConfirmation({
        tenantId: TENANT, subjectId: SUBJECT, scheduleId: SCHEDULE,
      });

      expect(mockCreate).not.toHaveBeenCalled();
      expect(result.id).toBe('vje-existing');
    });
  });
});
