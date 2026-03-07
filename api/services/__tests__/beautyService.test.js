'use strict';

jest.mock('../../db/models', () => ({
  BeautyProfessional: jest.fn(),
  BeautyService: jest.fn(),
  BeautyServiceProfessional: jest.fn(),
  BeautyServiceComposition: jest.fn(),
  BeautyLoyalty: jest.fn(),
  BeautyClientPreference: jest.fn(),
  BeautyScheduleProfessional: jest.fn(),
  BeautyScheduleService: jest.fn(),
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

jest.mock('../schedulingService', () => ({
  createSchedule: jest.fn(),
  cancelSchedule: jest.fn(),
  rescheduleSchedule: jest.fn(),
}));

jest.mock('../operationalAvailabilityService', () => ({
  resolveOperationalAvailability: jest.fn(),
}));

jest.mock('../eventLedgerService', () => ({
  appendEventV1: jest.fn(),
}));

const models = require('../../db/models');
const { getPreset } = require('../../core/autonomous-scheduling/VerticalTemplateRegistry');
const { getInsights } = require('../../core/autonomous-scheduling/PredictiveInsightsService');
const schedulingService = require('../schedulingService');
const { resolveOperationalAvailability } = require('../operationalAvailabilityService');
const beautyService = require('../beautyService');

describe('beautyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getInsights.mockResolvedValue({ ok: true, insights: { idleRisk: 'medium', fillProbability: 0.62 } });
    schedulingService.createSchedule.mockResolvedValue({
      schedule: {
        id: 'ops-1',
        startAt: '2026-03-07T10:00:00.000Z',
        endAt: '2026-03-07T10:30:00.000Z',
        metadata: { verticalTemplate: 'beauty' },
      },
    });
    schedulingService.cancelSchedule.mockResolvedValue({
      schedule: {
        id: 'ops-1',
        status: 'canceled',
        contact_id: 'contact-1',
        metadata: { verticalTemplate: 'beauty' },
      },
    });
    schedulingService.rescheduleSchedule.mockResolvedValue({
      schedule: {
        id: 'ops-1',
        startAt: '2026-03-07T11:00:00.000Z',
        endAt: '2026-03-07T11:30:00.000Z',
        contact_id: 'contact-1',
        metadata: { verticalTemplate: 'beauty' },
      },
    });
    resolveOperationalAvailability.mockResolvedValue({
      ok: true,
      available: true,
      reasons: [],
      professionalConflicts: [],
      resourceConflicts: [],
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    });
    models.BeautyLoyalty.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'loy-default', tenant_key: 'tenant-1', contact_id: 'contact-default', visits: 0, points: 0, segment: 'active', metadata: {} }),
      }),
    });
    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.BeautyScheduleService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
  });

  test('resolveBundle expande composicao e aplica override por profissional', async () => {
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-combo', tenant_key: 'tenant-1', name: 'Combo', category: 'combo', default_duration: 60, default_price: 100, active: true, metadata: {} }) },
        { toJSON: () => ({ id: 'svc-mani', tenant_key: 'tenant-1', name: 'Manicure', category: 'nails', default_duration: 40, default_price: 50, active: true, metadata: {} }) },
        { toJSON: () => ({ id: 'svc-pedi', tenant_key: 'tenant-1', name: 'Pedicure', category: 'nails', default_duration: 50, default_price: 60, active: true, metadata: {} }) },
      ]),
    });
    models.BeautyServiceProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'assign-1', tenant_key: 'tenant-1', service_id: 'svc-mani', professional_id: 'pro-1', duration_minutes: 35, price_amount: 55, active: true, metadata: {} }) },
      ]),
    });
    models.BeautyServiceComposition.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'cmp-1', tenant_key: 'tenant-1', parent_service_id: 'svc-combo', child_service_id: 'svc-mani', sequence: 1, optional: false }) },
        { toJSON: () => ({ id: 'cmp-2', tenant_key: 'tenant-1', parent_service_id: 'svc-combo', child_service_id: 'svc-pedi', sequence: 2, optional: false }) },
      ]),
    });

    const out = await beautyService.resolveBundle({
      tenantId: 'tenant-1',
      serviceIds: ['svc-combo'],
      professionalId: 'pro-1',
    });

    expect(out.ok).toBe(true);
    expect(out.bundle.items).toEqual([
      expect.objectContaining({ serviceId: 'svc-mani', durationMinutes: 35, priceAmount: 55 }),
      expect.objectContaining({ serviceId: 'svc-pedi', durationMinutes: 50, priceAmount: 60 }),
    ]);
    expect(out.bundle.totalDurationMinutes).toBe(85);
    expect(out.bundle.totalPriceAmount).toBe(115);
  });

  test('listReactivationCandidates respeita janela da vertical beauty', async () => {
    const now = Date.now();
    getPreset.mockReturnValue({ revenueDefaults: { reactivationWindowDays: 30 } });
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.BeautyLoyalty.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'loy-1',
            tenant_key: 'tenant-1',
            contact_id: 'contact-1',
            visits: 6,
            points: 10,
            last_visit_at: new Date(now - (40 * 24 * 60 * 60 * 1000)).toISOString(),
            segment: 'vip',
            metadata: {},
          }),
        },
        {
          toJSON: () => ({
            id: 'loy-2',
            tenant_key: 'tenant-1',
            contact_id: 'contact-2',
            visits: 2,
            points: 2,
            last_visit_at: new Date(now - (10 * 24 * 60 * 60 * 1000)).toISOString(),
            segment: 'new',
            metadata: {},
          }),
        },
      ]),
      create: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'loy-react', tenant_key: 'tenant-1', contact_id: 'contact-react', visits: 0, points: 0, segment: 'active', metadata: {} }),
      }),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.CrmContact.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'contact-1', name: 'Alice' }) },
        { toJSON: () => ({ id: 'contact-2', name: 'Bruna' }) },
      ]),
    });

    const out = await beautyService.listReactivationCandidates({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toEqual(expect.objectContaining({
      contactId: 'contact-1',
      segment: 'vip',
      contact: expect.objectContaining({ name: 'Alice' }),
    }));
    expect(out.items[0].inactiveDays).toBeGreaterThanOrEqual(40);
  });

  test('getDashboard filtra waiting list e schedules pelo contexto beauty', async () => {
    getPreset.mockReturnValue({ revenueDefaults: { reactivationWindowDays: 45 } });
    models.BeautyProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'pro-1', tenant_key: 'tenant-1', name: 'Ana', active: true, metadata: {} }) },
      ]),
    });
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 50, default_price: 80, active: true, metadata: {} }) },
      ]),
    });
    models.BeautyServiceProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.BeautyServiceComposition.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.BeautyLoyalty.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'loy-dashboard', tenant_key: 'tenant-1', contact_id: 'contact-dashboard', visits: 0, points: 0, segment: 'active', metadata: {} }),
      }),
    });
    models.BeautyClientPreference.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.AutonomousWaitingList.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'wait-1', tenant_key: 'tenant-1', service_type: 'svc-1', active: true }) },
        { toJSON: () => ({ id: 'wait-2', tenant_key: 'tenant-1', service_type: 'other-service', active: true }) },
      ]),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'sch-1', tenant_key: 'tenant-1', purpose: 'Escova', status: 'confirmed', metadata: {} }) },
        { toJSON: () => ({ id: 'sch-2', tenant_key: 'tenant-1', purpose: 'Consulta', status: 'confirmed', metadata: {} }) },
      ]),
    });
    models.CrmContact.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });

    const out = await beautyService.getDashboard({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.waitingList).toHaveLength(1);
    expect(out.waitingList[0]).toEqual(expect.objectContaining({ id: 'wait-1' }));
    expect(out.recentSchedules).toHaveLength(1);
    expect(out.recentSchedules[0]).toEqual(expect.objectContaining({ id: 'sch-1' }));
    expect(out.summary.waitingListBeauty).toBe(1);
    expect(out.summary.recentBeautySchedules).toBe(1);
  });

  test('listProfessionalAgenda agrega agenda e sinais de ociosidade por profissional', async () => {
    models.BeautyProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'pro-1',
            tenant_key: 'tenant-1',
            name: 'Ana',
            specialty: 'Cabelo',
            specialties: ['corte'],
            max_daily_sessions: 3,
            working_hours: {},
            schedule_ref: 'ana',
            active: true,
            metadata: {},
          }),
        },
      ]),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'sch-1',
            tenant_key: 'tenant-1',
            start_at: new Date(Date.now() + (2 * 60 * 60 * 1000)).toISOString(),
            end_at: new Date(Date.now() + (3 * 60 * 60 * 1000)).toISOString(),
            purpose: 'Escova',
            metadata: { beautyProfessionalId: 'pro-1' },
          }),
        },
      ]),
    });
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 50, default_price: 80, active: true, metadata: {} }) },
      ]),
    });

    const out = await beautyService.listProfessionalAgenda({ tenantId: 'tenant-1', daysAhead: 2 });

    expect(out.ok).toBe(true);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].appointments).toHaveLength(1);
    expect(out.items[0].idleSignals[0]).toEqual(expect.objectContaining({
      bookedSessions: 1,
      suggestedCapacity: 2,
    }));
  });

  test('syncLoyaltyFromSchedules deriva visitas e ultima visita a partir do scheduling central', async () => {
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 50, default_price: 80, active: true, metadata: {} }) },
      ]),
    });
    const create = jest.fn().mockResolvedValue({
      toJSON: () => ({ id: 'loy-sync', tenant_key: 'tenant-1', contact_id: 'contact-1', visits: 1, points: 10, segment: 'active', metadata: {} }),
    });
    models.BeautyLoyalty.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create,
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-1',
            tenant_key: 'tenant-1',
            contact_id: 'contact-1',
            purpose: 'Escova',
            start_at: '2026-03-01T10:00:00.000Z',
            metadata: { verticalTemplate: 'beauty', beautyServiceId: 'svc-1' },
          }),
        },
      ]),
    });

    await beautyService.syncLoyaltyFromSchedules({ tenantId: 'tenant-1' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      tenant_key: 'tenant-1',
      contact_id: 'contact-1',
      visits: 1,
    }));
  });

  test('createBeautyBooking usa disponibilidade central, cria schedule e reconcilia fidelidade', async () => {
    models.BeautyService.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 30, default_price: 80, active: true, metadata: {} }),
      }),
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 30, default_price: 80, active: true, metadata: {} }) },
      ]),
    });
    models.BeautyProfessional.mockReturnValue({
      findOne: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'pro-1', tenant_key: 'tenant-1', name: 'Ana', specialty: 'Cabelo', active: true, metadata: {} }),
      }),
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'pro-1', tenant_key: 'tenant-1', name: 'Ana', specialty: 'Cabelo', active: true, metadata: {} }) },
      ]),
    });
    models.BeautyServiceProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.BeautyServiceComposition.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.BeautyLoyalty.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        toJSON: () => ({ id: 'loy-1', tenant_key: 'tenant-1', contact_id: 'contact-1', visits: 1, points: 10, segment: 'active', metadata: {} }),
      }),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-1',
            tenant_key: 'tenant-1',
            contact_id: 'contact-1',
            start_at: '2026-03-07T10:00:00.000Z',
            status: 'scheduled',
            purpose: 'Escova',
            metadata: { verticalTemplate: 'beauty', beautyServiceId: 'svc-1', beautyProfessionalId: 'pro-1' },
          }),
        },
      ]),
    });

    const out = await beautyService.createBeautyBooking({
      tenantId: 'tenant-1',
      contactId: 'contact-1',
      serviceId: 'svc-1',
      professionalId: 'pro-1',
      startAt: '2026-03-07T10:00:00.000Z',
    });

    expect(resolveOperationalAvailability).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      professionalIds: ['pro-1'],
    }));
    expect(schedulingService.createSchedule).toHaveBeenCalled();
    expect(models.BeautyScheduleProfessional().bulkCreate).toHaveBeenCalled();
    expect(models.BeautyScheduleService().bulkCreate).toHaveBeenCalled();
    expect(out.ok).toBe(true);
    expect(out.booking.scheduleId).toBe('ops-1');
  });

  test('resolveBeautyScheduleContext prioriza relacoes explicitas e cai para metadata no legado', async () => {
    models.BeautyProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'pro-1', tenant_key: 'tenant-1', name: 'Ana', active: true, metadata: {} }) },
      ]),
    });
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 30, default_price: 80, active: true, metadata: {} }) },
      ]),
    });
    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'bsp-1', tenant_key: 'tenant-1', operational_schedule_id: 'ops-1', beauty_professional_id: 'pro-1' }) },
      ]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.BeautyScheduleService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'bss-1', tenant_key: 'tenant-1', operational_schedule_id: 'ops-1', beauty_service_id: 'svc-1' }) },
      ]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });

    const explicit = await beautyService.resolveBeautyScheduleContext({
      tenantId: 'tenant-1',
      schedule: { id: 'ops-1', purpose: 'Escova', metadata: {} },
    });
    expect(explicit).toEqual(expect.objectContaining({
      source: 'explicit',
      primaryProfessionalId: 'pro-1',
      primaryServiceId: 'svc-1',
    }));

    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.BeautyScheduleService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });

    const legacy = await beautyService.resolveBeautyScheduleContext({
      tenantId: 'tenant-1',
      schedule: {
        id: 'ops-legacy',
        purpose: 'Escova',
        metadata: { verticalTemplate: 'beauty', beautyProfessionalId: 'pro-1', beautyServiceId: 'svc-1' },
      },
    });
    expect(legacy).toEqual(expect.objectContaining({
      source: 'metadata',
      primaryProfessionalId: 'pro-1',
      primaryServiceId: 'svc-1',
    }));
  });

  test('cancelBeautyBooking e rescheduleBeautyBooking preservam reconciliacao e contexto', async () => {
    const scheduleRow = {
      toJSON: () => ({
        id: 'ops-1',
        tenant_key: 'tenant-1',
        contact_id: 'contact-1',
        purpose: 'Escova',
        start_at: '2026-03-07T10:00:00.000Z',
        end_at: '2026-03-07T10:30:00.000Z',
        timezone: 'UTC',
        channel: 'whatsapp',
        origin: 'system',
        mode: 'free',
        metadata: { verticalTemplate: 'beauty', beautyProfessionalId: 'pro-1', beautyServiceId: 'svc-1' },
      }),
    };
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(scheduleRow),
    });
    models.BeautyProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'pro-1', tenant_key: 'tenant-1', name: 'Ana', active: true, metadata: {} }) },
      ]),
    });
    models.BeautyService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'svc-1', tenant_key: 'tenant-1', name: 'Escova', category: 'hair', default_duration: 30, default_price: 80, active: true, metadata: {} }) },
      ]),
    });

    const canceled = await beautyService.cancelBeautyBooking({
      tenantId: 'tenant-1',
      scheduleId: 'ops-1',
      reason: 'cliente pediu',
    });
    expect(schedulingService.cancelSchedule).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      scheduleId: 'ops-1',
    }));
    expect(canceled.ok).toBe(true);

    const rescheduled = await beautyService.rescheduleBeautyBooking({
      tenantId: 'tenant-1',
      scheduleId: 'ops-1',
      startAt: '2026-03-07T11:00:00.000Z',
    });
    expect(resolveOperationalAvailability).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      professionalIds: ['pro-1'],
    }));
    expect(schedulingService.rescheduleSchedule).toHaveBeenCalled();
    expect(rescheduled.ok).toBe(true);
  });
});
