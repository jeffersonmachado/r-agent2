'use strict';

jest.mock('../../db/models', () => ({
  OperationalSchedule: jest.fn(),
  FitnessClassSchedule: jest.fn(),
  FitnessScheduleProfessional: jest.fn(),
  FitnessScheduleResource: jest.fn(),
  BeautyScheduleProfessional: jest.fn(),
  BeautyScheduleService: jest.fn(),
  OperationalAlert: jest.fn(),
}));

jest.mock('../operationalAvailabilityService', () => ({
  resolveOperationalAvailability: jest.fn(),
}));

const models = require('../../db/models');
const { resolveOperationalAvailability } = require('../operationalAvailabilityService');
const schedulingHealthService = require('../schedulingHealthService');

describe('schedulingHealthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    models.OperationalAlert.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'alert-1' }) }),
    });
  });

  test('detecta schedule fitness sem relacoes explicitas e fora do horario', async () => {
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'ops-1', tenant_key: 'tenant-1', start_at: '2026-03-07T10:00:00.000Z', end_at: '2026-03-07T11:00:00.000Z', metadata: { verticalTemplate: 'fitness' } }) },
      ]),
    });
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'fit-1', tenant_key: 'tenant-1', operational_schedule_id: 'ops-1', metadata: { professionalIds: ['legacy-pro'] } }) },
      ]),
    });
    models.FitnessScheduleProfessional.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    models.FitnessScheduleResource.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    models.BeautyScheduleProfessional.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    models.BeautyScheduleService.mockReturnValue({ findAll: jest.fn().mockResolvedValue([]) });
    resolveOperationalAvailability.mockResolvedValue({
      reasons: ['outside_working_hours'],
      professionalConflicts: [],
      resourceConflicts: [],
    });

    const out = await schedulingHealthService.scanTenant({ tenantId: 'tenant-1', persist: false });

    expect(out.ok).toBe(true);
    expect(out.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ alertType: 'scheduling_missing_explicit_relations' }),
      expect.objectContaining({ alertType: 'scheduling_outside_working_hours' }),
    ]));
  });
});
