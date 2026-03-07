'use strict';

jest.mock('../../db/models', () => ({
  FitnessClass: jest.fn(),
  FitnessClassSchedule: jest.fn(),
  FitnessMembership: jest.fn(),
  FitnessAttendance: jest.fn(),
  FitnessCheckin: jest.fn(),
  FitnessMemberGoal: jest.fn(),
  FitnessProfessional: jest.fn(),
  FitnessResource: jest.fn(),
  FitnessActivityProfessional: jest.fn(),
  FitnessActivityResource: jest.fn(),
  FitnessScheduleProfessional: jest.fn(),
  FitnessScheduleResource: jest.fn(),
  CrmContact: jest.fn(),
  OperationalSchedule: jest.fn(),
  AutonomousWaitingList: jest.fn(),
}));

jest.mock('../../core/autonomous-scheduling/VerticalTemplateRegistry', () => ({
  getPreset: jest.fn(),
}));

jest.mock('../../core/autonomous-scheduling/PredictiveInsightsService', () => ({
  getInsights: jest.fn(),
}));

jest.mock('../../channels/kiosk/KioskService', () => ({
  checkin: jest.fn(),
}));

jest.mock('../../core/autonomous-scheduling', () => ({
  waitingListService: {
    addWaitingEntry: jest.fn(),
  },
}));

jest.mock('../schedulingService', () => ({
  createSchedule: jest.fn(),
  rescheduleSchedule: jest.fn(),
}));

jest.mock('../operationalAvailabilityService', () => ({
  resolveOperationalAvailability: jest.fn(),
}));

const models = require('../../db/models');
const { getPreset } = require('../../core/autonomous-scheduling/VerticalTemplateRegistry');
const { getInsights } = require('../../core/autonomous-scheduling/PredictiveInsightsService');
const kioskService = require('../../channels/kiosk/KioskService');
const { waitingListService } = require('../../core/autonomous-scheduling');
const schedulingService = require('../schedulingService');
const { resolveOperationalAvailability } = require('../operationalAvailabilityService');
const fitnessService = require('../fitnessService');

describe('fitnessService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getInsights.mockResolvedValue({ ok: true, insights: { noShowRisk: 'low', fillProbability: 0.8 } });
    models.FitnessProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    });
    models.FitnessResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    });
    models.FitnessActivityProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    });
    models.FitnessActivityResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    });
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      destroy: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      destroy: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    schedulingService.createSchedule.mockResolvedValue({ schedule: { id: 'ops-new' } });
    schedulingService.rescheduleSchedule.mockResolvedValue({ schedule: { id: 'ops-existing' } });
    resolveOperationalAvailability.mockResolvedValue({
      ok: true,
      available: true,
      reasons: [],
      professionalConflicts: [],
      resourceConflicts: [],
      centralAvailability: { available: true, reasons: [] },
    });
  });

  test('recordCheckin integra kiosk e atualiza attendance', async () => {
    const attendanceFindAll = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const attendanceCreate = jest.fn().mockResolvedValue({
      toJSON: () => ({
        id: 'att-1',
        tenant_key: 'tenant-1',
        class_schedule_id: 'sch-1',
        member_id: 'member-1',
        status: 'checked_in',
        checkin_time: new Date('2026-03-07T10:00:00.000Z').toISOString(),
        booking_time: new Date('2026-03-07T09:00:00.000Z').toISOString(),
        metadata: { source: 'kiosk' },
      }),
    });
    models.FitnessAttendance.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: attendanceFindAll,
      create: attendanceCreate,
    });
    models.FitnessClassSchedule.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'sch-1',
          tenant_key: 'tenant-1',
          class_id: 'class-1',
          start_at: '2026-03-07T10:00:00.000Z',
          end_at: '2026-03-07T11:00:00.000Z',
          capacity: 10,
          status: 'scheduled',
          metadata: {},
        }),
      }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-1',
          tenant_key: 'tenant-1',
          name: 'Yoga',
          category: 'mind',
          duration_minutes: 60,
          default_capacity: 10,
          active: true,
          metadata: {},
        }),
      }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'mem-1',
            tenant_key: 'tenant-1',
            member_id: 'member-1',
            plan_name: 'Gold',
            start_date: '2026-01-01',
            end_date: null,
            allowed_classes: ['class-1'],
            allowed_weekly_frequency: 3,
            active: true,
            metadata: {},
          }),
        },
      ]),
    });
    models.FitnessCheckin.mockReturnValue({
      create: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'check-1',
          tenant_key: 'tenant-1',
          member_id: 'member-1',
          class_schedule_id: 'sch-1',
          source: 'kiosk',
          kiosk_session_id: 'kiosk-1',
          checked_in_at: new Date('2026-03-07T10:00:00.000Z').toISOString(),
          metadata: {},
        }),
      }),
    });
    kioskService.checkin.mockResolvedValue({
      session: { id: 'kiosk-1' },
      queueTicket: { id: 'ticket-1' },
    });

    const out = await fitnessService.recordCheckin({
      tenantId: 'tenant-1',
      memberId: 'member-1',
      classScheduleId: 'sch-1',
      source: 'kiosk',
      kioskCode: 'gym-1',
      payload: {},
    });

    expect(kioskService.checkin).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      kioskCode: 'gym-1',
      contactId: 'member-1',
    }));
    expect(attendanceCreate).toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.item).toEqual(expect.objectContaining({
      memberId: 'member-1',
      source: 'kiosk',
      kioskSessionId: 'kiosk-1',
    }));
  });

  test('saveAttendance bloqueia booking sem membership elegível', async () => {
    models.FitnessAttendance.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    });
    models.FitnessClassSchedule.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'sch-1',
          tenant_key: 'tenant-1',
          class_id: 'class-1',
          start_at: '2026-03-07T10:00:00.000Z',
          end_at: '2026-03-07T11:00:00.000Z',
          capacity: 10,
          status: 'scheduled',
          metadata: {},
        }),
      }),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-1',
          tenant_key: 'tenant-1',
          name: 'Yoga',
          category: 'mind',
          duration_minutes: 60,
          default_capacity: 10,
          active: true,
          metadata: {},
        }),
      }),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });

    await expect(fitnessService.saveAttendance({
      tenantId: 'tenant-1',
      classScheduleId: 'sch-1',
      memberId: 'member-1',
      payload: { status: 'booked' },
    })).rejects.toThrow('membership_missing');
  });

  test('resolveBookingEligibility bloqueia turma lotada', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'sch-1',
          tenant_key: 'tenant-1',
          class_id: 'class-1',
          start_at: '2026-03-07T10:00:00.000Z',
          end_at: '2026-03-07T11:00:00.000Z',
          capacity: 1,
          status: 'scheduled',
          metadata: {},
        }),
      }),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'mem-1',
            tenant_key: 'tenant-1',
            member_id: 'member-2',
            plan_name: 'Gold',
            start_date: '2026-01-01',
            end_date: null,
            allowed_classes: ['class-1'],
            allowed_weekly_frequency: 3,
            active: true,
            metadata: {},
          }),
        },
      ]),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-1',
          tenant_key: 'tenant-1',
          name: 'Yoga',
          category: 'mind',
          duration_minutes: 60,
          default_capacity: 1,
          active: true,
          metadata: {},
        }),
      }),
    });
    models.FitnessAttendance.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'att-1',
            tenant_key: 'tenant-1',
            class_schedule_id: 'sch-1',
            member_id: 'member-1',
            status: 'booked',
            booking_time: '2026-03-06T09:00:00.000Z',
            metadata: {},
          }),
        },
      ]),
    });

    const out = await fitnessService.resolveBookingEligibility({
      tenantId: 'tenant-1',
      classScheduleId: 'sch-1',
      memberId: 'member-2',
      requestedStatus: 'booked',
    });

    expect(out.eligible).toBe(false);
    expect(out.reasons).toContain('schedule_full');
  });

  test('resolveScheduleAvailability detecta conflito de profissional e recurso', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    });
    models.FitnessActivityProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessActivityResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-2',
          tenant_key: 'tenant-1',
          name: 'Pilates',
          category: 'pilates',
          operation_mode: 'individual_session',
          duration_minutes: 50,
          default_capacity: 1,
          active: true,
          metadata: {},
        }),
      }),
    });
    resolveOperationalAvailability.mockResolvedValue({
      ok: true,
      available: false,
      reasons: ['professional_conflict', 'resource_conflict'],
      professionalConflicts: [{ professionalId: 'pro-1', conflicts: [{ id: 'sch-1' }] }],
      resourceConflicts: [{ resourceId: 'res-1', conflicts: [{ id: 'sch-1' }] }],
      centralAvailability: { available: true, reasons: [] },
    });

    const out = await fitnessService.resolveScheduleAvailability({
      tenantId: 'tenant-1',
      classId: 'class-2',
      startAt: new Date('2026-03-07T10:15:00.000Z'),
      endAt: new Date('2026-03-07T11:15:00.000Z'),
      professionalIds: ['pro-1'],
      resourceIds: ['res-1'],
    });

    expect(out.available).toBe(false);
    expect(out.reasons).toEqual(expect.arrayContaining(['professional_conflict', 'resource_conflict']));
  });

  test('resolveBookingEligibility bloqueia limite semanal do plano', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'sch-1',
          tenant_key: 'tenant-1',
          class_id: 'class-1',
          start_at: '2026-03-07T10:00:00.000Z',
          end_at: '2026-03-07T11:00:00.000Z',
          capacity: 10,
          status: 'scheduled',
          metadata: {},
        }),
      }),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'mem-1',
            tenant_key: 'tenant-1',
            member_id: 'member-1',
            plan_name: 'Gold',
            start_date: '2026-01-01',
            end_date: null,
            allowed_classes: ['class-1'],
            allowed_weekly_frequency: 1,
            active: true,
            metadata: {},
          }),
        },
      ]),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-1',
          tenant_key: 'tenant-1',
          name: 'Yoga',
          category: 'mind',
          duration_minutes: 60,
          default_capacity: 10,
          active: true,
          metadata: {},
        }),
      }),
    });
    const attendanceFindAll = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          toJSON: () => ({
            id: 'att-1',
            tenant_key: 'tenant-1',
            class_schedule_id: 'sch-x',
            member_id: 'member-1',
            status: 'booked',
            booking_time: '2026-03-06T09:00:00.000Z',
            metadata: {},
          }),
        },
      ]);
    models.FitnessAttendance.mockReturnValue({
      findAll: attendanceFindAll,
    });

    const out = await fitnessService.resolveBookingEligibility({
      tenantId: 'tenant-1',
      classScheduleId: 'sch-1',
      memberId: 'member-1',
      requestedStatus: 'booked',
    });

    expect(out.eligible).toBe(false);
    expect(out.reasons).toContain('membership_weekly_limit_reached');
  });

  test('resolveBookingEligibility bloqueia categoria não permitida pelo plano', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'sch-1',
          tenant_key: 'tenant-1',
          class_id: 'class-1',
          start_at: '2026-03-07T10:00:00.000Z',
          end_at: '2026-03-07T11:00:00.000Z',
          capacity: 10,
          status: 'scheduled',
          metadata: {},
        }),
      }),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-1',
          tenant_key: 'tenant-1',
          name: 'Crossfit',
          category: 'crossfit',
          duration_minutes: 60,
          default_capacity: 10,
          active: true,
          metadata: {},
        }),
      }),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'mem-1',
            tenant_key: 'tenant-1',
            member_id: 'member-1',
            plan_name: 'Studio',
            start_date: '2026-01-01',
            end_date: null,
            allowed_classes: [],
            allowed_weekly_frequency: 3,
            active: true,
            metadata: { allowedCategories: ['yoga', 'pilates'] },
          }),
        },
      ]),
    });
    models.FitnessAttendance.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });

    const out = await fitnessService.resolveBookingEligibility({
      tenantId: 'tenant-1',
      classScheduleId: 'sch-1',
      memberId: 'member-1',
      requestedStatus: 'booked',
    });

    expect(out.eligible).toBe(false);
    expect(out.reasons).toContain('membership_category_not_allowed');
  });

  test('saveAttendance pode entrar na waiting list quando a turma lota', async () => {
    models.FitnessAttendance.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'att-1',
            tenant_key: 'tenant-1',
            class_schedule_id: 'sch-1',
            member_id: 'member-a',
            status: 'booked',
            booking_time: '2026-03-06T09:00:00.000Z',
            metadata: {},
          }),
        },
      ]),
      create: jest.fn(),
    });
    models.FitnessClassSchedule.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'sch-1',
          tenant_key: 'tenant-1',
          class_id: 'class-1',
          start_at: '2026-03-07T10:00:00.000Z',
          end_at: '2026-03-07T11:00:00.000Z',
          capacity: 1,
          status: 'scheduled',
          metadata: {},
        }),
      }),
    });
    models.FitnessClass.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({
          id: 'class-1',
          tenant_key: 'tenant-1',
          name: 'Yoga',
          category: 'mind',
          duration_minutes: 60,
          default_capacity: 1,
          active: true,
          metadata: {},
        }),
      }),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'mem-1',
            tenant_key: 'tenant-1',
            member_id: 'member-1',
            plan_name: 'Gold',
            start_date: '2026-01-01',
            end_date: null,
            allowed_classes: ['class-1'],
            allowed_weekly_frequency: 3,
            active: true,
            metadata: {},
          }),
        },
      ]),
    });
    waitingListService.addWaitingEntry.mockResolvedValue({
      ok: true,
      item: { id: 'wait-1', contactId: 'member-1', contextId: 'sch-1' },
    });

    const out = await fitnessService.saveAttendance({
      tenantId: 'tenant-1',
      classScheduleId: 'sch-1',
      memberId: 'member-1',
      payload: { status: 'booked', autoJoinWaitingList: true },
    });

    expect(out.ok).toBe(true);
    expect(out.waitlisted).toBe(true);
    expect(waitingListService.addWaitingEntry).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      contactId: 'member-1',
      contextType: 'fitness_class',
      contextId: 'sch-1',
    }));
  });

  test('getDashboard calcula capacidade restante e filtra waiting list fitness', async () => {
    getPreset.mockReturnValue({ retentionThreshold: 14 });
    models.FitnessClass.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'class-1', tenant_key: 'tenant-1', name: 'Yoga', category: 'mind', duration_minutes: 60, default_capacity: 10, active: true, metadata: {} }) },
      ]),
    });
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'sch-1', tenant_key: 'tenant-1', class_id: 'class-1', start_at: '2026-03-07T10:00:00.000Z', end_at: '2026-03-07T11:00:00.000Z', capacity: 10, location: 'Sala 1', status: 'scheduled', metadata: {} }) },
      ]),
    });
    models.FitnessMembership.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'mem-1', tenant_key: 'tenant-1', member_id: 'member-1', plan_name: 'Gold', start_date: '2026-01-01', end_date: null, allowed_classes: ['class-1'], allowed_weekly_frequency: 3, active: true, metadata: {} }) },
      ]),
    });
    models.FitnessAttendance.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'att-1', tenant_key: 'tenant-1', class_schedule_id: 'sch-1', member_id: 'member-1', status: 'booked', checkin_time: null, booking_time: '2026-03-06T09:00:00.000Z', metadata: {} }) },
      ]),
    });
    models.FitnessMemberGoal.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessCheckin.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.AutonomousWaitingList.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'wait-1', tenant_key: 'tenant-1', service_type: 'Yoga', active: true }) },
        { toJSON: () => ({ id: 'wait-2', tenant_key: 'tenant-1', service_type: 'Pilates', active: true }) },
      ]),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'ops-1', tenant_key: 'tenant-1', purpose: 'Yoga', status: 'confirmed', metadata: {} }) },
      ]),
    });
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'fsp-1', tenant_key: 'tenant-1', class_schedule_id: 'sch-1', professional_id: 'pro-1' }) },
      ]),
      destroy: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'fsr-1', tenant_key: 'tenant-1', class_schedule_id: 'sch-1', resource_id: 'res-1', quantity: 1, exclusive_use: false, metadata: {} }) },
      ]),
      destroy: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.CrmContact.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });

    const out = await fitnessService.getDashboard({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.schedules[0]).toEqual(expect.objectContaining({
      bookedCount: 1,
      remainingCapacity: 9,
    }));
    expect(out.waitingList).toHaveLength(1);
    expect(out.recentSchedules).toHaveLength(1);
    expect(out.summary.waitingListFitness).toBe(1);
  });

  test('listSchedules prioriza relacoes explicitas sobre metadata legado', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'sch-1',
            tenant_key: 'tenant-1',
            class_id: 'class-1',
            start_at: '2026-03-07T10:00:00.000Z',
            end_at: '2026-03-07T11:00:00.000Z',
            capacity: 10,
            status: 'scheduled',
            metadata: {
              professionalIds: ['legacy-pro'],
              resourceIds: ['legacy-res'],
            },
          }),
        },
      ]),
    });
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ class_schedule_id: 'sch-1', professional_id: 'pro-1' }) },
      ]),
      destroy: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ class_schedule_id: 'sch-1', resource_id: 'res-1', quantity: 1, exclusive_use: false, metadata: {} }) },
      ]),
      destroy: jest.fn().mockResolvedValue(0),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });

    const out = await fitnessService.listSchedules({ tenantId: 'tenant-1' });

    expect(out.items[0]).toEqual(expect.objectContaining({
      professionalIds: ['pro-1'],
      resourceIds: ['res-1'],
    }));
  });
});
