'use strict';

jest.mock('../../db/models', () => ({
  OperationalSchedule: jest.fn(),
  ScheduleWorkingHour: jest.fn(),
  ScheduleBlock: jest.fn(),
  FitnessClassSchedule: jest.fn(),
  FitnessProfessional: jest.fn(),
  FitnessResource: jest.fn(),
  FitnessScheduleProfessional: jest.fn(),
  FitnessScheduleResource: jest.fn(),
  BeautyScheduleProfessional: jest.fn(),
}));

const models = require('../../db/models');
const {
  resolveCentralAvailability,
  resolveOperationalAvailability,
} = require('../operationalAvailabilityService');

describe('operationalAvailabilityService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    models.ScheduleWorkingHour.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ start_time: '09:00', end_time: '18:00', enabled: true }) },
      ]),
    });
    models.ScheduleBlock.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'pro-1', name: 'Lia', max_concurrent_sessions: 1, active: true }) },
      ]),
    });
    models.FitnessResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ id: 'res-1', name: 'Sala 1', capacity: 1, exclusive_use: true, active: true }) },
      ]),
    });
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
    });
  });

  test('resolveCentralAvailability detecta conflito de agenda team_based', async () => {
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-1',
            tenant_key: 'tenant-1',
            context_type: 'custom',
            context_id: 'x',
            start_at: '2026-03-07T10:00:00.000Z',
            end_at: '2026-03-07T11:00:00.000Z',
            team_id: 'team-1',
            status: 'scheduled',
            metadata: {},
          }),
        },
      ]),
    });

    const out = await resolveCentralAvailability({
      tenantId: 'tenant-1',
      mode: 'team_based',
      teamId: 'team-1',
      startAt: '2026-03-07T10:15:00.000Z',
      endAt: '2026-03-07T10:45:00.000Z',
    });

    expect(out.available).toBe(false);
    expect(out.reasons).toContain('schedule_conflict');
  });

  test('resolveOperationalAvailability detecta conflito de profissional legado em metadata', async () => {
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-1',
            tenant_key: 'tenant-1',
            context_type: 'custom',
            context_id: 'beauty:1',
            start_at: '2026-03-07T10:00:00.000Z',
            end_at: '2026-03-07T11:00:00.000Z',
            status: 'scheduled',
            metadata: { beautyProfessionalId: 'pro-1', verticalTemplate: 'beauty' },
          }),
        },
      ]),
    });

    const out = await resolveOperationalAvailability({
      tenantId: 'tenant-1',
      startAt: '2026-03-07T10:15:00.000Z',
      endAt: '2026-03-07T10:45:00.000Z',
      professionalIds: ['pro-1'],
    });

    expect(out.available).toBe(false);
    expect(out.reasons).toContain('professional_conflict');
  });

  test('resolveOperationalAvailability detecta conflito de recurso por relacao explicita', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'fit-1',
            tenant_key: 'tenant-1',
            class_id: 'class-1',
            operational_schedule_id: 'ops-legacy',
            start_at: '2026-03-07T10:00:00.000Z',
            end_at: '2026-03-07T11:00:00.000Z',
            status: 'scheduled',
            metadata: {},
          }),
        },
      ]),
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        { toJSON: () => ({ class_schedule_id: 'fit-1', resource_id: 'res-1', quantity: 1, exclusive_use: true, metadata: {} }) },
      ]),
    });

    const out = await resolveOperationalAvailability({
      tenantId: 'tenant-1',
      startAt: '2026-03-07T10:15:00.000Z',
      endAt: '2026-03-07T10:45:00.000Z',
      resourceRequirements: [{ resourceId: 'res-1', quantity: 1, exclusiveUse: true }],
    });

    expect(out.available).toBe(false);
    expect(out.reasons).toContain('resource_conflict');
  });
});
