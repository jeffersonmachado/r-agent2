'use strict';

jest.mock('../../api/db/models', () => ({
  OperationalSchedule: jest.fn(),
  BeautyScheduleProfessional: jest.fn(),
  BeautyScheduleService: jest.fn(),
}));

const models = require('../../api/db/models');
const { backfillBeautyScheduleRelations, parseCliArgs } = require('../backfill-beauty-schedule-relations');

describe('backfillBeautyScheduleRelations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('materializa relacoes explicitas da Beauty a partir de metadata legado', async () => {
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-1',
            tenant_key: 'tenant-1',
            metadata: {
              verticalTemplate: 'beauty',
              beautyProfessionalId: 'pro-1',
              beautyServiceId: 'svc-1',
            },
          }),
        },
      ]),
    });
    const bulkCreateProfessionals = jest.fn().mockResolvedValue([]);
    const bulkCreateServices = jest.fn().mockResolvedValue([]);
    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: bulkCreateProfessionals,
    });
    models.BeautyScheduleService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: bulkCreateServices,
    });

    const out = await backfillBeautyScheduleRelations({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(out.processedSchedules).toBe(1);
    expect(out.eligibleSchedules).toBe(1);
    expect(out.migrableSchedules).toBe(1);
    expect(out.migratedSchedules).toBe(1);
    expect(out.createdProfessionals).toBe(1);
    expect(out.createdServices).toBe(1);
    expect(out.validation.exactMatches).toBe(1);
    expect(bulkCreateProfessionals).toHaveBeenCalled();
    expect(bulkCreateServices).toHaveBeenCalled();
  });

  test('dry-run e idempotencia nao duplicam relacoes', async () => {
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-2',
            tenant_key: 'tenant-1',
            metadata: {
              verticalTemplate: 'beauty',
              beautyProfessionalId: 'pro-1',
              beautyServiceId: 'svc-1',
            },
          }),
        },
      ]),
    });
    const bulkCreateProfessionals = jest.fn().mockResolvedValue([]);
    const bulkCreateServices = jest.fn().mockResolvedValue([]);
    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([{ beauty_professional_id: 'pro-1' }]),
      bulkCreate: bulkCreateProfessionals,
    });
    models.BeautyScheduleService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([{ beauty_service_id: 'svc-1' }]),
      bulkCreate: bulkCreateServices,
    });

    const out = await backfillBeautyScheduleRelations({ tenantId: 'tenant-1', dryRun: true });

    expect(out.ok).toBe(true);
    expect(out.dryRun).toBe(true);
    expect(out.alreadyMigrated).toBe(1);
    expect(out.migratedSchedules).toBe(0);
    expect(out.createdProfessionals).toBe(0);
    expect(out.createdServices).toBe(0);
    expect(bulkCreateProfessionals).not.toHaveBeenCalled();
    expect(bulkCreateServices).not.toHaveBeenCalled();
  });

  test('filtra por status e periodo e mantem CLI em dry-run por padrao', async () => {
    models.OperationalSchedule.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([
        {
          toJSON: () => ({
            id: 'ops-1',
            tenant_key: 'tenant-1',
            status: 'scheduled',
            start_at: '2026-03-07T10:00:00.000Z',
            metadata: { verticalTemplate: 'beauty', beautyProfessionalId: 'pro-1', beautyServiceId: 'svc-1' },
          }),
        },
        {
          toJSON: () => ({
            id: 'ops-2',
            tenant_key: 'tenant-1',
            status: 'cancelled',
            start_at: '2026-03-09T10:00:00.000Z',
            metadata: { verticalTemplate: 'beauty', beautyProfessionalId: 'pro-2', beautyServiceId: 'svc-2' },
          }),
        },
      ]),
    });
    models.BeautyScheduleProfessional.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });
    models.BeautyScheduleService.mockReturnValue({
      findAll: jest.fn().mockResolvedValue([]),
      bulkCreate: jest.fn().mockResolvedValue([]),
    });

    const out = await backfillBeautyScheduleRelations({
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
