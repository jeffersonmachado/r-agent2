'use strict';

describe('googleAdsRecommendationSchedulerService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('tick processa tenants com google_ads.enabled e respeita autoUpload por tenant', async () => {
    const tenantSettingFindAll = jest.fn(async () => ([
      {
        toJSON: () => ({
          tenant_id: 'tenant-uuid-1',
          value: { enabled: true, autoUpload: true },
        }),
      },
      {
        toJSON: () => ({
          tenant_id: 'tenant-uuid-2',
          value: { enabled: true, autoUpload: false },
        }),
      },
      {
        toJSON: () => ({
          tenant_id: 'tenant-uuid-3',
          value: { enabled: false, autoUpload: true },
        }),
      },
    ]));
    const tenantFindAll = jest.fn(async () => ([
      { toJSON: () => ({ id: 'tenant-uuid-1', tenant_key: 'tenant-1' }) },
      { toJSON: () => ({ id: 'tenant-uuid-2', tenant_key: 'tenant-2' }) },
      { toJSON: () => ({ id: 'tenant-uuid-3', tenant_key: 'tenant-3' }) },
    ]));
    const syncRecommendationsFromAnalysis = jest.fn(async ({ tenantId }) => ({ ok: true, created: tenantId === 'tenant-1' ? 2 : 1, skipped: 0 }));
    const uploadPendingConversions = jest.fn(async ({ tenantId }) => ({ ok: true, attempted: tenantId === 'tenant-1' ? 3 : 0, uploaded: tenantId === 'tenant-1' ? 3 : 0, failed: 0 }));
    const getOrderAttributionGrowthStatus = jest.fn(async ({ tenantId }) => ({
      ok: true,
      tenantId,
      triggered: tenantId === 'tenant-1',
      currentCount: tenantId === 'tenant-1' ? 6 : 1,
      previousCount: tenantId === 'tenant-1' ? 2 : 1,
      growthFactor: tenantId === 'tenant-1' ? 3 : 1,
    }));
    const appendEventV1 = jest.fn(async () => ({ ok: true }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      TenantSetting: () => ({ findAll: tenantSettingFindAll }),
      Tenant: () => ({ findAll: tenantFindAll }),
    }));
    jest.doMock('../../api/services/marketing/googleAdsRecommendationService', () => ({
      syncRecommendationsFromAnalysis,
    }));
    jest.doMock('../../api/services/marketing/googleAdsConversionService', () => ({
      uploadPendingConversions,
    }));
    jest.doMock('../../api/services/marketing/googleAdsAttributionMonitorService', () => ({
      getOrderAttributionGrowthStatus,
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1,
    }));

    const service = require('../../api/services/marketing/googleAdsRecommendationSchedulerService');
    const out = await service.tick({ tenantLimit: 10, autoUploadOnScheduler: true });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      processedTenants: 2,
    }));
    expect(syncRecommendationsFromAnalysis).toHaveBeenCalledTimes(2);
    expect(syncRecommendationsFromAnalysis).toHaveBeenNthCalledWith(1, expect.objectContaining({ tenantId: 'tenant-1' }));
    expect(syncRecommendationsFromAnalysis).toHaveBeenNthCalledWith(2, expect.objectContaining({ tenantId: 'tenant-2' }));
    expect(uploadPendingConversions).toHaveBeenCalledTimes(1);
    expect(uploadPendingConversions).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', limit: 50 }));
    expect(getOrderAttributionGrowthStatus).toHaveBeenCalledTimes(2);
    expect(appendEventV1).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      type: 'MarketingGoogleAdsAttributionAlert',
      payload: expect.objectContaining({
        category: 'marketing_attribution_missing_growth',
        severity: 'warning',
        currentCount: 6,
        previousCount: 2,
      }),
    }));
    expect(out.items[0]).toEqual(expect.objectContaining({
      tenantId: 'tenant-1',
      attributionAlert: expect.objectContaining({
        triggered: true,
        alertEmitted: true,
      }),
    }));
    expect(out.items[1]).toEqual(expect.objectContaining({
      tenantId: 'tenant-2',
      attributionAlert: expect.objectContaining({
        triggered: false,
      }),
    }));
  });
});