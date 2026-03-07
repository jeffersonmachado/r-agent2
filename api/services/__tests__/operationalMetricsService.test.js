'use strict';

jest.mock('../../db/models', () => ({
  Tenant: jest.fn(),
  Ticket: jest.fn(),
  OperationalSchedule: jest.fn(),
  OperationalMetricSnapshot: jest.fn(),
  OperationalAlert: jest.fn(),
  UraDecisionAudit: jest.fn(),
  BeautyLoyalty: jest.fn(),
  RevenueOpportunity: jest.fn(),
  FitnessClassSchedule: jest.fn(),
  FitnessAttendance: jest.fn(),
  FitnessScheduleResource: jest.fn(),
}));

jest.mock('../beautyService', () => ({
  getDashboard: jest.fn(),
}));

jest.mock('../fitnessService', () => ({
  getDashboard: jest.fn(),
}));

const models = require('../../db/models');
const beautyService = require('../beautyService');
const fitnessService = require('../fitnessService');
const operationalMetricsService = require('../operationalMetricsService');

describe('operationalMetricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    models.UraDecisionAudit.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ tenant_key: 'tenant-1', fallback_used: false, confidence: 0.9, department_id: 'dept-fit', rag_used: true, provider_status: 'used', latency_ms: 120 }) },
        { toJSON: () => ({ tenant_key: 'tenant-1', fallback_used: true, confidence: 0.4, department_id: 'dept-fin', rag_used: false, provider_status: 'timeout', latency_ms: 300 }) },
      ]),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'ops-1', tenant_key: 'tenant-1', status: 'scheduled', metadata: {} }) },
        { toJSON: () => ({ id: 'ops-2', tenant_key: 'tenant-1', status: 'no_show', metadata: { rescheduledFromScheduleId: 'ops-1' } }) },
      ]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'snap-1' }) }),
    });
    models.OperationalAlert.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ alert_type: 'scheduling_repeated_professional_conflict' }) },
      ]),
    });
    models.BeautyLoyalty.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ id: 'loy-1' }) }]) });
    models.RevenueOpportunity.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ type: 'reactivation' }) }]) });
    models.FitnessClassSchedule.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ id: 'fit-1' }) }]) });
    models.FitnessAttendance.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    models.FitnessScheduleResource.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ class_schedule_id: 'fit-1', resource_id: 'res-1' }) }]) });
    models.Ticket.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ status: 'waiting' }) }]) });
    models.OperationalMetricSnapshot.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'occ-1', snapshot_payload_json: { health: { uraStatus: 'yellow' } } }) }),
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.Tenant.mockReturnValue({ findAll: jest.fn().mockResolvedValue([{ toJSON: () => ({ tenant_key: 'tenant-1', name: 'Tenant 1', status: 'active' }) }]) });
    beautyService.getDashboard.mockResolvedValue({ ok: true, recentSchedules: [{ start_at: new Date().toISOString() }], professionalAgenda: [{ freeWindows: [{}, {}] }] });
    fitnessService.getDashboard.mockResolvedValue({ ok: true, schedules: [{ capacity: 10, bookedCount: 5 }], idleResources: [] });
  });

  test('agrega snapshot OCC por tenant e resumo global', async () => {
    const collected = await operationalMetricsService.collectTenantSnapshot({ tenantId: 'tenant-1', now: new Date() });
    expect(collected.ok).toBe(true);
    expect(collected.payload.ura.totalMessages).toBe(2);
    expect(collected.payload.ai.providerFailures).toBe(1);

    const stored = await operationalMetricsService.storeTenantSnapshot({ tenantId: 'tenant-1', now: new Date() });
    expect(stored.ok).toBe(true);

    const summary = await operationalMetricsService.getTenantsHealthSummary();
    expect(summary.ok).toBe(true);
    expect(summary.summary.tenantsActive).toBe(1);
  });
});
