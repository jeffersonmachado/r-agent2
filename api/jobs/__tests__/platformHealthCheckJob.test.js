'use strict';

jest.mock('../../db/models', () => ({
  Tenant: jest.fn(),
  OperationalAlert: jest.fn(),
}));

jest.mock('../collectOperationalMetricsJob', () => ({
  run: jest.fn().mockResolvedValue({ ok: true, items: [{ tenantId: 'tenant-1', ok: true }] }),
}));

jest.mock('../../services/schedulingHealthService', () => ({
  scanTenant: jest.fn().mockResolvedValue({ ok: true, alerts: [] }),
}));

jest.mock('../../services/uraDecisionAuditService', () => ({
  cleanupOldAudits: jest.fn().mockResolvedValue({ ok: true, deleted: 0 }),
}));

jest.mock('../../services/operationalMetricsService', () => ({
  getLatestTenantSnapshot: jest.fn(),
}));

const models = require('../../db/models');
const operationalMetricsService = require('../../services/operationalMetricsService');
const platformHealthCheckJob = require('../platformHealthCheckJob');

describe('platformHealthCheckJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('cria alerta quando provider IA degrada no snapshot OCC', async () => {
    models.OperationalAlert.mockReturnValue({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ toJSON: () => ({ id: 'alert-1' }) }),
    });
    operationalMetricsService.getLatestTenantSnapshot.mockResolvedValue({
      item: {
        snapshot_payload_json: {
          ai: { providerFailures: 4 },
          health: { aiStatus: 'yellow' },
        },
      },
    });

    const out = await platformHealthCheckJob.syncAiProviderAlert({ tenantId: 'tenant-1' });

    expect(out.ok).toBe(true);
    expect(models.OperationalAlert().create).toHaveBeenCalled();
  });
});
