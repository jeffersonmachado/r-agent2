'use strict';

describe('googleAdsRecommendationService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('syncRecommendationsFromAnalysis cria recomendações novas e deduplica por fingerprint', async () => {
    const create = jest.fn(async (payload) => ({ toJSON: () => ({ ...payload }) }));
    const findAll = jest.fn(async () => []);

    jest.doMock('../../api/db/models', () => ({
      TenantRecommendation: () => ({ findAll, create }),
    }));
    jest.doMock('../../api/services/marketing/googleAdsKeywordInsightService', () => ({
      analyzeKeywordPortfolio: jest.fn(async () => ({
        ok: true,
        recommendations: [
          {
            action: 'include_keyword',
            term: 'crm industrial',
            campaignId: 'cmp-1',
            adGroupId: 'ag-1',
            confidence: 0.91,
            rationale: 'Converteu bem e ainda nao esta no portfolio.',
          },
        ],
      })),
    }));
    jest.doMock('../../api/services/marketing/googleAdsKeywordActionService', () => ({
      applyKeywordAction: jest.fn(async () => ({ ok: true })),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const service = require('../../api/services/marketing/googleAdsRecommendationService');
    const out = await service.syncRecommendationsFromAnalysis({
      tenantId: 'tenant-1',
      startDate: '2026-04-01',
      endDate: '2026-04-19',
    });

    expect(out).toEqual(expect.objectContaining({ ok: true, created: 1, skipped: 0 }));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      tenant_key: 'tenant-1',
      action_type: 'include_keyword',
      status: 'open',
    });
    expect(create.mock.calls[0][0].metadata).toEqual(expect.objectContaining({
      domain: 'marketing_google_ads',
      recommendation: expect.objectContaining({
        term: 'crm industrial',
      }),
    }));
  });

  test('applyRecommendation atualiza status para applied quando ação executa com sucesso', async () => {
    const update = jest.fn(async () => ({}));
    const findOne = jest.fn(async () => ({
      toJSON: () => ({
        id: 'rec-1',
        tenant_key: 'tenant-1',
        action_type: 'pause_keyword',
        status: 'approved',
        metadata: {
          recommendation: {
            campaignId: 'cmp-1',
            adGroupId: 'ag-1',
            keywordId: 'kw-1',
          },
        },
      }),
      update,
    }));

    jest.doMock('../../api/db/models', () => ({
      TenantRecommendation: () => ({ findOne }),
    }));
    jest.doMock('../../api/services/marketing/googleAdsKeywordInsightService', () => ({
      analyzeKeywordPortfolio: jest.fn(async () => ({ ok: true, recommendations: [] })),
    }));
    jest.doMock('../../api/services/marketing/googleAdsKeywordActionService', () => ({
      applyKeywordAction: jest.fn(async () => ({ ok: true, dryRun: false, result: { results: [] } })),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const service = require('../../api/services/marketing/googleAdsRecommendationService');
    const out = await service.applyRecommendation({ tenantId: 'tenant-1', recommendationId: 'rec-1', dryRun: false });

    expect(out.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'applied',
      metadata: expect.objectContaining({
        lastApplyResult: expect.objectContaining({ ok: true }),
      }),
    }));
  });
});