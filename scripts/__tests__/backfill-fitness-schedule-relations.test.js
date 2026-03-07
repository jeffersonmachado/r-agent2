'use strict';

jest.mock('../../api/db/models', () => ({
  FitnessClassSchedule: jest.fn(),
  FitnessScheduleProfessional: jest.fn(),
  FitnessScheduleResource: jest.fn(),
}));

const models = require('../../api/db/models');
const { backfillFitnessScheduleRelations, parseCliArgs } = require('../backfill-fitness-schedule-relations');

describe('backfillFitnessScheduleRelations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('materializa relacoes explicitas a partir de metadata legado', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'sch-1',
            tenant_key: 'tenant-1',
            operational_schedule_id: 'ops-1',
            metadata: {
              professionalIds: ['pro-1'],
              resourceIds: ['res-1'],
            },
          }),
        },
      ]),
    });
    const bulkCreateProfessionals = jest.fn().mockResolvedValue([]);
    const bulkCreateResources = jest.fn().mockResolvedValue([]);
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: bulkCreateProfessionals,
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: bulkCreateResources,
    });

    const out = await backfillFitnessScheduleRelations({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.processedSchedules).toBe(1);
    expect(out.eligibleSchedules).toBe(1);
    expect(out.migrableSchedules).toBe(1);
    expect(out.migratedSchedules).toBe(1);
    expect(out.createdProfessionals).toBe(1);
    expect(out.createdResources).toBe(1);
    expect(out.validation.exactMatches).toBe(1);
    expect(bulkCreateProfessionals).toHaveBeenCalled();
    expect(bulkCreateResources).toHaveBeenCalled();
  });

  test('dry-run reporta sem gravar e reconhece schedule ja migrado', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'sch-2',
            tenant_key: 'tenant-1',
            operational_schedule_id: 'ops-2',
            metadata: {
              professionalIds: ['pro-1'],
              resourceIds: ['res-1'],
            },
          }),
        },
      ]),
    });
    const bulkCreateProfessionals = jest.fn().mockResolvedValue([]);
    const bulkCreateResources = jest.fn().mockResolvedValue([]);
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([{ professional_id: 'pro-1' }]),
      bulkCreate: bulkCreateProfessionals,
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([{ resource_id: 'res-1' }]),
      bulkCreate: bulkCreateResources,
    });

    const out = await backfillFitnessScheduleRelations({ tenantId: 'tenant-1', dryRun: true });

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(true);
    expect(out.alreadyMigrated).toBe(1);
    expect(out.migratedSchedules).toBe(0);
    expect(out.createdProfessionals).toBe(0);
    expect(out.createdResources).toBe(0);
    expect(bulkCreateProfessionals).not.toHaveBeenCalled();
    expect(bulkCreateResources).not.toHaveBeenCalled();
  });

  test('aplica filtros e parseia CLI segura com dry-run padrao', async () => {
    models.FitnessClassSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'sch-1',
            tenant_key: 'tenant-1',
            status: 'scheduled',
            start_at: '2026-03-07T10:00:00.000Z',
            operational_schedule_id: 'ops-1',
            metadata: { professionalIds: ['pro-1'] },
          }),
        },
        {
          toJSON: () => ({
            id: 'sch-2',
            tenant_key: 'tenant-1',
            status: 'cancelled',
            start_at: '2026-03-09T10:00:00.000Z',
            operational_schedule_id: 'ops-2',
            metadata: { professionalIds: ['pro-2'] },
          }),
        },
      ]),
    });
    models.FitnessScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.FitnessScheduleResource.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });

    const out = await backfillFitnessScheduleRelations({
      tenantId: 'tenant-1',
      dryRun: true,
      statuses: ['scheduled'],
      endDate: '2026-03-08T00:00:00.000Z',
      limit: 1,
      batchSize: 1,
    });

    expect(out.processedSchedules).toBe(1);
    expect(out.processedBatches).toBe(1);
    expect(parseCliArgs(['--tenant=system', '--status=scheduled,confirmed', '--limit=10'])).toEqual(expect.objectContaining({
      tenantId: 'system',
      dryRun: true,
      statuses: ['scheduled', 'confirmed'],
      limit: 10,
    }));
  });
});
