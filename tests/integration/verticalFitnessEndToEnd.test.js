'use strict';

/**
 * Fitness Vertical End-to-End Integration Test
 *
 * Tests the complete fitness customer journey without a real DB:
 * 1. Check-in recorded (with duplicate prevention)
 * 2. Check-out closes attendance
 * 3. Membership grace period → block on expiry
 * 4. Inactivity detected → alert sent
 * 5. Churn risk → return campaign sent
 * 6. Attendance history + frequency computation
 * 7. Access status based on billing
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
    };
  }
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

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
  queueNotification: jest.fn().mockResolvedValue({ queued: true, item: { id: 'notif-1' } }),
}));

// ── Load services after mocks ────────────────────────────────────────────────

const fitnessAttendanceService = require('../../api/services/vertical/fitnessAttendanceService');
const fitnessMembershipService = require('../../api/services/vertical/fitnessMembershipService');
const { handleFitnessJourneyTick, handleFitnessGraceExpiryScan, handleFitnessInactivityScan } = require('../../api/services/vertical/verticalJourneyJobHandler');
const notificationService = require('../../api/services/notificationService');

const TENANT = 'tenant-fitness-e2e';
const SUBJECT = 'subject-fitness-001';
const MEMBERSHIP_ID = 'membership-001';

function makeAttendanceRow(overrides = {}) {
  return {
    id: 'va-1',
    tenant_key: TENANT,
    vertical: 'fitness',
    subject_id: SUBJECT,
    membership_id: MEMBERSHIP_ID,
    status: 'open',
    checked_in_at: new Date().toISOString(),
    toJSON() { return this; },
    update: jest.fn(async function(data) { Object.assign(this, data); return this; }),
    ...overrides,
  };
}

function makeMembershipRow(overrides = {}) {
  return {
    id: MEMBERSHIP_ID,
    tenant_key: TENANT,
    vertical: 'fitness',
    subject_id: SUBJECT,
    billing_status: 'active',
    grace_until: null,
    toJSON() { return this; },
    update: jest.fn(async function(data) { Object.assign(this, data); return this; }),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────────

describe('Fitness Vertical — End-to-End Journey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSequelize.mockReturnValue({});
    mockAppendEventV1.mockResolvedValue({ id: 'evt-1' });
    notificationService.enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
    mockFindOne.mockResolvedValue(null);
    mockFindAll.mockResolvedValue([]);
    mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
  });

  // ── 1. Check-in with duplicate prevention ────────────────────────────────

  describe('1. Check-in recording', () => {
    test('records check-in successfully', async () => {
      const att = await fitnessAttendanceService.recordCheckIn({
        tenantId: TENANT, subjectId: SUBJECT, membershipId: MEMBERSHIP_ID,
      });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ tenant_key: TENANT, subject_id: SUBJECT, status: 'open' }),
      );
      expect(att.status).toBe('open');
    });

    test('duplicate check-in returns existing open attendance', async () => {
      const existing = makeAttendanceRow();
      mockFindOne.mockResolvedValueOnce(existing); // existing open found

      const att = await fitnessAttendanceService.recordCheckIn({
        tenantId: TENANT, subjectId: SUBJECT, membershipId: MEMBERSHIP_ID,
      });
      // Should NOT have called create
      expect(mockCreate).not.toHaveBeenCalled();
      expect(att.id).toBe('va-1');
    });
  });

  // ── 2. Check-out ─────────────────────────────────────────────────────────

  describe('2. Check-out', () => {
    test('closes open attendance with duration', async () => {
      const checkedInAt = new Date(Date.now() - 45 * 60000); // 45 min ago
      const openAtt = makeAttendanceRow({ checked_in_at: checkedInAt.toISOString() });
      mockFindOne.mockResolvedValueOnce(openAtt);

      const result = await fitnessAttendanceService.recordCheckOut({
        tenantId: TENANT, subjectId: SUBJECT,
      });
      expect(openAtt.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(result.status).toBe('completed');
    });

    test('returns null when no open attendance exists', async () => {
      mockFindOne.mockResolvedValueOnce(null);
      const result = await fitnessAttendanceService.recordCheckOut({
        tenantId: TENANT, subjectId: SUBJECT,
      });
      expect(result).toBeNull();
    });
  });

  // ── 3. Stale attendance auto-close ───────────────────────────────────────

  describe('3. Stale attendance auto-close', () => {
    test('closes open attendances older than maxOpenHours', async () => {
      const staleAt = new Date(Date.now() - 10 * 3600000).toISOString(); // 10h ago
      const staleAtt = makeAttendanceRow({ checked_in_at: staleAt, status: 'open' });
      mockFindAll.mockResolvedValueOnce([staleAtt]);

      const result = await fitnessAttendanceService.closeStaleOpenAttendances({
        tenantId: TENANT, maxOpenHours: 8,
      });
      expect(result.closed).toBe(1);
      expect(staleAtt.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'absent',
          metadata: expect.objectContaining({ auto_closed: true }),
        }),
      );
    });
  });

  // ── 4. Grace period → block on expiry ────────────────────────────────────

  describe('4. Grace period expiry → block', () => {
    test('handleFitnessGraceExpiryScan blocks expired grace memberships', async () => {
      const expiredMembership = makeMembershipRow({
        billing_status: 'delinquent',
        grace_until: new Date(Date.now() - 3600000).toISOString(), // 1h ago (expired)
      });
      // scan finds expired grace membership
      mockFindAll.mockResolvedValueOnce([expiredMembership]);

      // updateBillingStatus will find the membership
      mockFindOne.mockResolvedValueOnce(makeMembershipRow({
        billing_status: 'delinquent',
        update: jest.fn(async (data) => data),
      }));

      const result = await handleFitnessGraceExpiryScan({ tenantId: TENANT });

      expect(mockFindOne).toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ scanned: 1, blocked: 1 }));
      // expectation: blockMembership was called (which uses updateBillingStatus internally)
      expect(mockAppendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MembershipBillingStatusChanged' }),
      );
    });
  });

  // ── 5. Attendance history + frequency ────────────────────────────────────

  describe('5. Attendance history', () => {
    test('getAttendanceHistory computes frequency correctly', async () => {
      const now = Date.now();
      const d15 = new Date(now - 15 * 86400000).toISOString(); // 15 days ago (within 30d)
      const d5 = new Date(now - 5 * 86400000).toISOString();   // 5 days ago
      const attendances = [
        { subject_id: SUBJECT, status: 'completed', checked_in_at: d5, toJSON() { return this; } },
        { subject_id: SUBJECT, status: 'completed', checked_in_at: d15, toJSON() { return this; } },
      ];
      mockFindAll.mockResolvedValueOnce(attendances);

      const result = await fitnessAttendanceService.getAttendanceHistory({
        tenantId: TENANT, subjectId: SUBJECT, windowDays: 90,
      });

      expect(result.total).toBe(2);
      expect(result.frequency30d).toBe(2);
      expect(result.frequency7d).toBe(1); // only d5 is within 7 days
    });
  });

  // ── 6. Access status based on billing ────────────────────────────────────

  describe('6. Membership access status', () => {
    test('allows access for active membership', async () => {
      const membership = makeMembershipRow({ billing_status: 'active' });
      mockFindOne.mockResolvedValueOnce(membership);

      const result = await fitnessMembershipService.getMembershipAccessStatus({
        tenantId: TENANT, subjectId: SUBJECT,
      });

      expect(result.allowed).toBe(true);
      expect(result.reasonCode).toBe('allowed');
    });

    test('denies access for blocked membership', async () => {
      const membership = makeMembershipRow({ billing_status: 'blocked' });
      mockFindOne.mockResolvedValueOnce(membership);

      const result = await fitnessMembershipService.getMembershipAccessStatus({
        tenantId: TENANT, subjectId: SUBJECT,
      });

      expect(result.allowed).toBe(false);
      expect(result.reasonCode).toContain('deny_billing_blocked');
    });

    test('allows access during grace period (delinquent + grace_until in future)', async () => {
      const graceUntil = new Date(Date.now() + 2 * 86400000).toISOString(); // 2 days from now
      const membership = makeMembershipRow({ billing_status: 'delinquent', grace_until: graceUntil });
      mockFindOne.mockResolvedValueOnce(membership);

      const result = await fitnessMembershipService.getMembershipAccessStatus({
        tenantId: TENANT, subjectId: SUBJECT,
      });

      expect(result.allowed).toBe(true);
      expect(result.effectiveBillingStatus).toBe('grace_period');
    });
  });

  // ── 7. Inactivity scan sends alerts ──────────────────────────────────────

  describe('7. Fitness inactivity scan', () => {
    test('sends frequency_alert for low-frequency subject', async () => {
      const membership = makeMembershipRow();
      // 1 visit 10 days ago → score 0.25 → low_frequency (not churn_risk)
      const oneRecentVisit = [{
        id: 'va-recent',
        checked_in_at: new Date(Date.now() - 10 * 86400000).toISOString(),
        status: 'completed',
      }];
      mockFindAll
        .mockResolvedValueOnce([membership]) // memberships
        .mockResolvedValueOnce(oneRecentVisit) // attendances for engagement signal
        .mockResolvedValue([]);               // subsequent calls

      // No recent frequency_alert
      mockFindOne.mockResolvedValue(null);

      // engagementSignal create
      mockCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));

      await handleFitnessInactivityScan({ tenantId: TENANT });

      // Should have emitted a journey event for frequency_alert_sent
      const createdEvents = mockCreate.mock.calls.map((c) => c[0]);
      // engagementSignal + frequency_alert_sent journey event
      const alertEvents = createdEvents.filter((e) => e.event_type === 'frequency_alert_sent');
      expect(alertEvents.length).toBeGreaterThan(0);
    });
  });

  // ── 8. Regression: accessDecisionService boundary ────────────────────────

  describe('8. Regression — billing status machine', () => {
    test('blocks membership correctly: active → blocked (via delinquent)', async () => {
      const { updateBillingStatus, blockMembership } = require('../../api/services/vertical/billingOrchestrationService');

      const delinquentMembership = {
        id: MEMBERSHIP_ID,
        billing_status: 'delinquent',
        toJSON() { return this; },
        update: jest.fn(async function(data) { Object.assign(this, data); return this; }),
      };
      mockFindOne.mockResolvedValueOnce(delinquentMembership);

      const result = await blockMembership({ tenantId: TENANT, membershipId: MEMBERSHIP_ID });
      expect(result.billing_status).toBe('blocked');
      expect(mockAppendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MembershipBillingStatusChanged', payload: expect.objectContaining({ toStatus: 'blocked' }) }),
      );
    });

    test('invalid billing transition throws invalid_billing_transition', async () => {
      const { updateBillingStatus } = require('../../api/services/vertical/billingOrchestrationService');
      const blockedMembership = {
        id: MEMBERSHIP_ID,
        billing_status: 'blocked',
        toJSON() { return this; },
        update: jest.fn(),
      };
      mockFindOne.mockResolvedValueOnce(blockedMembership);

      await expect(
        updateBillingStatus({ tenantId: TENANT, membershipId: MEMBERSHIP_ID, toStatus: 'grace_period' }),
      ).rejects.toMatchObject({ code: 'invalid_billing_transition' });
    });

    test('reactivates from blocked → active', async () => {
      const { reactivateMembership } = require('../../api/services/vertical/billingOrchestrationService');
      const blockedMembership = {
        id: MEMBERSHIP_ID,
        billing_status: 'blocked',
        toJSON() { return this; },
        update: jest.fn(async function(data) { Object.assign(this, data); return this; }),
      };
      mockFindOne.mockResolvedValueOnce(blockedMembership);

      const result = await reactivateMembership({ tenantId: TENANT, membershipId: MEMBERSHIP_ID, reason: 'payment' });
      expect(result.billing_status).toBe('active');
    });
  });
});
