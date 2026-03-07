'use strict';

jest.mock('../../db/models', () => ({
  TenantFeatureFlag: jest.fn(),
}));

const models = require('../../db/models');
const tenantFeatureService = require('../tenantFeatureService');

describe('tenantFeatureService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('upsertFlag cria e isEnabled respeita tenant/feature', async () => {
    const create = jest.fn().mockResolvedValue({
      toJSON: () => ({ id: 'flag-1', tenant_key: 'tenant-1', feature_key: 'ura_ai_enabled', enabled: true, config_json: { threshold: 0.8 } }),
    });
    const findOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        toJSON: () => ({ id: 'flag-1', tenant_key: 'tenant-1', feature_key: 'ura_ai_enabled', enabled: true, config_json: { threshold: 0.8 } }),
      });
    models.TenantFeatureFlag.mockReturnValue({
      findOne,
      create,
      findAll: jest.fn().mockResolvedValue([]),
    });

    const saved = await tenantFeatureService.upsertFlag({
      tenantId: 'tenant-1',
      featureKey: 'ura_ai_enabled',
      enabled: true,
      config: { threshold: 0.8 },
    });

    expect(saved.ok).toBe(true);
    expect(create).toHaveBeenCalled();
    await expect(tenantFeatureService.isEnabled('tenant-1', 'ura_ai_enabled')).resolves.toBe(true);
  });
});
