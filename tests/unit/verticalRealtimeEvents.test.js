'use strict';

/**
 * Testes dos eventos WebSocket verticais (`vertical.*`) emitidos nos writes
 * dos serviços de attendance, billing/bundles, memberships e schedule.
 *
 * Garante: evento emitido com payload mínimo { tenantId, entityId, action }
 * e sempre direcionado ao tenant via options { tenantId }.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  VerticalAttendance: jest.fn(() => mockVerticalAttendance),
  AccessMembership: jest.fn(() => mockAccessMembership),
  VerticalSessionBundle: jest.fn(() => mockSessionBundle),
  AccessSubject: jest.fn(() => ({})),
  EventLedger: jest.fn(() => ({})),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

jest.mock('../../api/services/vertical/customerJourneyEngine', () => {
  const actual = jest.requireActual('../../api/services/vertical/customerJourneyEngine');
  return {
    ...actual,
    emitJourneyEvent: jest.fn(async () => ({ id: 'vje-1' })),
  };
});

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn(async () => ({ id: 'notif-1' })),
}));

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: jest.fn(),
}));

jest.mock('../../api/modules/access-control/accessControlRepository', () => ({
  findMembership: jest.fn(async () => null),
  createMembership: jest.fn(async (payload) => ({ ...payload })),
}));

const mockVerticalAttendance = {
  create: jest.fn(),
  findOne: jest.fn(),
  findAll: jest.fn(),
};

const mockAccessMembership = {
  findOne: jest.fn(),
  findAll: jest.fn(),
};

const mockSessionBundle = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
};

const { emitEvent } = require('../../api/services/websocketService');
const { getSequelize } = require('../../api/db/sequelize');
const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { enqueueNotification } = require('../../api/services/notificationService');
const models = require('../../api/db/models');
const repository = require('../../api/modules/access-control/accessControlRepository');

const attendanceService = require('../../api/services/vertical/fitnessAttendanceService');
const billingService = require('../../api/services/vertical/billingOrchestrationService');
const membershipService = require('../../api/services/vertical/fitnessMembershipService');
const accessControlService = require('../../api/modules/access-control/accessControlService');
const scheduleService = require('../../api/services/scheduleService');

function callsFor(eventName) {
  return emitEvent.mock.calls.filter(([event]) => event === eventName);
}

function expectTenantDirected(eventName) {
  const calls = callsFor(eventName);
  expect(calls.length).toBeGreaterThan(0);
  for (const [, payload, options] of calls) {
    expect(payload.tenantId).toBe('tenant-a');
    expect(options).toEqual({ tenantId: 'tenant-a' });
  }
}

describe('eventos WebSocket verticais', () => {
  beforeEach(() => {
    // resetMocks: true — restaura implementações a cada teste
    getSequelize.mockReturnValue({});
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
    emitJourneyEvent.mockResolvedValue({ id: 'vje-1' });
    enqueueNotification.mockResolvedValue({ id: 'notif-1' });
    models.VerticalAttendance.mockReturnValue(mockVerticalAttendance);
    models.AccessMembership.mockReturnValue(mockAccessMembership);
    models.VerticalSessionBundle.mockReturnValue(mockSessionBundle);
    repository.findMembership.mockResolvedValue(null);
    repository.createMembership.mockImplementation(async (payload) => ({ ...payload }));
    mockVerticalAttendance.create.mockImplementation(async (data) => ({ ...data }));
    mockVerticalAttendance.findOne.mockResolvedValue(null);
    mockVerticalAttendance.findAll.mockResolvedValue([]);
  });

  describe('vertical.attendance.updated (fitnessAttendanceService)', () => {
    it('recordCheckIn emite action checkin', async () => {
      const row = await attendanceService.recordCheckIn({
        tenantId: 'tenant-a',
        subjectId: 'sub-1',
        accessDecisionId: 'dec-1',
      });

      const calls = callsFor('vertical.attendance.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: row.id,
        action: 'checkin',
      }));
      expectTenantDirected('vertical.attendance.updated');
    });

    it('recordCheckOut emite action checkout', async () => {
      const rowMock = {
        id: 'va-1',
        checked_in_at: new Date(Date.now() - 30 * 60000),
        access_decision_id: 'dec-2',
        metadata: {},
        update: jest.fn(async () => {}),
        toJSON() {
          return { id: 'va-1', access_decision_id: 'dec-2', membership_id: null };
        },
      };
      mockVerticalAttendance.findOne.mockResolvedValue(rowMock);

      await attendanceService.recordCheckOut({ tenantId: 'tenant-a', subjectId: 'sub-1' });

      const calls = callsFor('vertical.attendance.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: 'va-1',
        action: 'checkout',
      }));
    });

    it('recordCheckOut sem registro aberto não emite', async () => {
      mockVerticalAttendance.findOne.mockResolvedValue(null);

      await attendanceService.recordCheckOut({ tenantId: 'tenant-a', subjectId: 'sub-1' });

      expect(callsFor('vertical.attendance.updated').length).toBe(0);
    });
  });

  describe('vertical.bundles.updated (billingOrchestrationService)', () => {
    it('createSessionBundle emite action sold', async () => {
      mockSessionBundle.create.mockImplementation(async (data) => ({ ...data }));

      const bundle = await billingService.createSessionBundle({
        tenantId: 'tenant-a',
        vertical: 'beauty',
        subjectId: 'sub-1',
        totalSessions: 10,
      });

      const calls = callsFor('vertical.bundles.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: bundle.id,
        action: 'sold',
        vertical: 'beauty',
      }));
      expectTenantDirected('vertical.bundles.updated');
    });

    it('consumeSession emite action used', async () => {
      const rowMock = {
        update: jest.fn(async () => {}),
        toJSON() {
          return {
            id: 'vsb-1',
            vertical: 'beauty',
            used_sessions: 2,
            total_sessions: 10,
            status: 'active',
            end_at: null,
          };
        },
      };
      mockSessionBundle.findOne.mockResolvedValue(rowMock);

      await billingService.consumeSession({ tenantId: 'tenant-a', bundleId: 'vsb-1' });

      const calls = callsFor('vertical.bundles.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: 'vsb-1',
        action: 'used',
        usedSessions: 3,
        totalSessions: 10,
        status: 'active',
      }));
    });
  });

  describe('vertical.memberships.updated', () => {
    it('updateBillingStatus emite billing_status_changed (billingOrchestrationService)', async () => {
      const rowMock = {
        billing_status: 'active',
        update: jest.fn(async () => {}),
        toJSON() {
          return { id: 'mem-1', billing_status: 'blocked' };
        },
      };
      mockAccessMembership.findOne.mockResolvedValue(rowMock);

      await billingService.updateBillingStatus({
        tenantId: 'tenant-a',
        membershipId: 'mem-1',
        toStatus: 'blocked',
        reason: 'delinquency',
      });

      const calls = callsFor('vertical.memberships.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: 'mem-1',
        action: 'billing_status_changed',
        fromStatus: 'active',
        toStatus: 'blocked',
      }));
      expectTenantDirected('vertical.memberships.updated');
    });

    it('updateMembershipDetails emite action updated (fitnessMembershipService)', async () => {
      const rowMock = {
        update: jest.fn(async () => {}),
        toJSON() {
          return { id: 'mem-1' };
        },
      };
      mockAccessMembership.findOne.mockResolvedValue(rowMock);

      await membershipService.updateMembershipDetails({
        tenantId: 'tenant-a',
        membershipId: 'mem-1',
        fields: { plan_name: 'Black' },
      });

      const calls = callsFor('vertical.memberships.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: 'mem-1',
        action: 'updated',
      }));
    });

    it('upsertMembership emite action created apenas na criação (accessControlService)', async () => {
      await accessControlService.upsertMembership({
        tenantId: 'tenant-a',
        subjectId: 'sub-1',
        membershipId: 'mem-1',
        vertical: 'fitness',
      });

      let calls = callsFor('vertical.memberships.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: 'mem-1',
        action: 'created',
        vertical: 'fitness',
      }));

      // Membership já existente: não emite novamente
      emitEvent.mockClear();
      repository.findMembership.mockResolvedValue({ id: 'mem-1' });
      await accessControlService.upsertMembership({
        tenantId: 'tenant-a',
        subjectId: 'sub-1',
        membershipId: 'mem-1',
        vertical: 'fitness',
      });
      calls = callsFor('vertical.memberships.updated');
      expect(calls.length).toBe(0);
    });
  });

  describe('vertical.schedule.updated (scheduleService)', () => {
    it('createSchedule emite action created', () => {
      const schedule = scheduleService.createSchedule({
        tenantId: 'tenant-a',
        payload: {
          contextType: 'beauty_appointment',
          contextId: 'cust-1',
          metadata: { vertical: 'beauty' },
        },
      });

      const calls = callsFor('vertical.schedule.updated');
      expect(calls.length).toBe(1);
      expect(calls[0][1]).toEqual(expect.objectContaining({
        tenantId: 'tenant-a',
        entityId: schedule.id,
        action: 'created',
        contextType: 'beauty_appointment',
        vertical: 'beauty',
      }));
      expectTenantDirected('vertical.schedule.updated');
    });

    it('updateScheduleStatus emite action de reschedule e cancel', () => {
      const schedule = scheduleService.createSchedule({
        tenantId: 'tenant-a',
        payload: { contextType: 'beauty_appointment', contextId: 'cust-1' },
      });
      emitEvent.mockClear();

      scheduleService.updateScheduleStatus({
        tenantId: 'tenant-a',
        scheduleId: schedule.id,
        action: 'reschedule',
        payload: { startAt: new Date().toISOString() },
      });
      scheduleService.updateScheduleStatus({
        tenantId: 'tenant-a',
        scheduleId: schedule.id,
        action: 'cancel',
      });

      const actions = callsFor('vertical.schedule.updated').map(([, payload]) => payload.action);
      expect(actions).toEqual(['reschedule', 'cancel']);
    });
  });
});
