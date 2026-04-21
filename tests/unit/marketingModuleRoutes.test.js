'use strict';

const { createMarketingService } = require('../../api/modules/marketing/service');
const { createMarketingController } = require('../../api/modules/marketing/controller');
const { createMarketingRoutes } = require('../../api/modules/marketing/routes');

describe('marketing module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      logAction: jest.fn(),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createMarketingRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    expect(stack).toEqual([
      '/api/marketing/forms',
      '/api/marketing/forms',
      '/api/marketing/links',
      '/api/marketing/links',
      '/api/marketing/leads',
      '/api/marketing/leads',
      '/api/marketing/leads/:leadId',
      '/api/marketing/leads/stats',
      '/api/marketing/scoring-rules',
      '/api/marketing/scoring-rules',
      '/api/marketing/email-campaigns',
      '/api/marketing/email-campaigns',
      '/api/marketing/email-campaigns/:campaignId/send',
      '/api/marketing/google-ads/settings',
      '/api/marketing/google-ads/settings',
      '/api/marketing/google-ads/conversions',
      '/api/marketing/google-ads/conversions',
      '/api/marketing/google-ads/conversions/upload',
      '/api/marketing/google-ads/keywords/sync',
      '/api/marketing/google-ads/keywords/performance',
      '/api/marketing/google-ads/search-terms/performance',
      '/api/marketing/google-ads/roi',
      '/api/marketing/google-ads/attribution-exceptions',
      '/api/marketing/google-ads/keywords/analyze',
      '/api/marketing/google-ads/keywords/actions/apply',
      '/api/marketing/google-ads/recommendations/sync',
      '/api/marketing/google-ads/recommendations',
      '/api/marketing/google-ads/recommendations/:recommendationId',
      '/api/marketing/google-ads/recommendations/:recommendationId/apply',
    ]);
  });

  test('controller listLinks preserva erro 503 quando service falha', async () => {
    const deps = makeDeps();
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {
        listLinks: jest.fn(async () => ({ ok: false, error: 'links_unavailable' })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', url: '/api/marketing/links?limit=20' };
    const res = {};

    await controller.listLinks(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 503, { error: 'links_unavailable' });
  });

  test('controller createEmailCampaign retorna 201 no contrato atual', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'Campanha', subject: 'Oi' })),
    });
    const service = createMarketingService({
      marketingService: {
        createEmailCampaign: jest.fn(async () => ({ ok: true, id: 'cmp-1' })),
      },
      marketingLinkService: {},
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1' };
    const res = {};

    await controller.createEmailCampaign(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, { ok: true, id: 'cmp-1' });
  });

  test('controller uploadGoogleAdsConversions retorna 200 quando service envia pendencias', async () => {
    const deps = makeDeps();
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {},
      googleAdsService: {
        uploadPendingConversions: jest.fn(async () => ({ ok: true, uploaded: 2, failed: 0, attempted: 2 })),
        getGoogleAdsSettings: jest.fn(async () => ({ ok: true, value: {} })),
        upsertGoogleAdsSettings: jest.fn(async () => ({ ok: true, value: {} })),
        listOfflineConversions: jest.fn(async () => ({ ok: true, items: [] })),
        registerOfflineConversion: jest.fn(async () => ({ ok: true, conversion: { id: 'c1' } })),
      },
      googleAdsKeywordService: {
        syncKeywordPerformance: jest.fn(async () => ({ ok: true })),
        listKeywordPerformance: jest.fn(async () => ({ ok: true, items: [] })),
        listSearchTermPerformance: jest.fn(async () => ({ ok: true, items: [] })),
        analyzeKeywordPortfolio: jest.fn(async () => ({ ok: true, recommendations: [] })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', url: '/api/marketing/google-ads/conversions/upload?limit=2' };
    const res = {};

    await controller.uploadGoogleAdsConversions(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { ok: true, uploaded: 2, failed: 0, attempted: 2 });
  });

  test('controller analyzeGoogleAdsKeywords retorna 200 com análise consolidada', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ startDate: '2026-04-01', endDate: '2026-04-18' })),
    });
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {},
      googleAdsService: {
        uploadPendingConversions: jest.fn(async () => ({ ok: true, uploaded: 0, failed: 0, attempted: 0 })),
        getGoogleAdsSettings: jest.fn(async () => ({ ok: true, value: {} })),
        upsertGoogleAdsSettings: jest.fn(async () => ({ ok: true, value: {} })),
        listOfflineConversions: jest.fn(async () => ({ ok: true, items: [] })),
        registerOfflineConversion: jest.fn(async () => ({ ok: true, conversion: { id: 'c1' } })),
      },
      googleAdsKeywordService: {
        syncKeywordPerformance: jest.fn(async () => ({ ok: true })),
        listKeywordPerformance: jest.fn(async () => ({ ok: true, items: [] })),
        listSearchTermPerformance: jest.fn(async () => ({ ok: true, items: [] })),
        analyzeKeywordPortfolio: jest.fn(async () => ({ ok: true, recommendations: [{ action: 'include_keyword' }], ai: { summary: 'Resumo' } })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1' };
    const res = {};

    await controller.analyzeGoogleAdsKeywords(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      recommendations: [{ action: 'include_keyword' }],
    }));
  });

  test('controller applyGoogleAdsKeywordAction retorna 200 e registra auditoria best-effort', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        action: 'include_keyword',
        campaignId: '123',
        adGroupId: '456',
        keywordText: 'crm industrial',
        matchType: 'PHRASE',
        dryRun: true,
      })),
    });
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {},
      googleAdsService: {
        uploadPendingConversions: jest.fn(async () => ({ ok: true, uploaded: 0, failed: 0, attempted: 0 })),
        getGoogleAdsSettings: jest.fn(async () => ({ ok: true, value: {} })),
        upsertGoogleAdsSettings: jest.fn(async () => ({ ok: true, value: {} })),
        listOfflineConversions: jest.fn(async () => ({ ok: true, items: [] })),
        registerOfflineConversion: jest.fn(async () => ({ ok: true, conversion: { id: 'c1' } })),
      },
      googleAdsKeywordService: {
        syncKeywordPerformance: jest.fn(async () => ({ ok: true })),
        listKeywordPerformance: jest.fn(async () => ({ ok: true, items: [] })),
        listSearchTermPerformance: jest.fn(async () => ({ ok: true, items: [] })),
        analyzeKeywordPortfolio: jest.fn(async () => ({ ok: true, recommendations: [] })),
      },
      googleAdsKeywordActionSvc: {
        applyKeywordAction: jest.fn(async () => ({ ok: true, action: 'include_keyword', dryRun: true, result: { results: [] } })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', agent: { id: 'agent-1', username: 'tester' }, ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
    const res = {};

    await controller.applyGoogleAdsKeywordAction(req, res);

    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'marketing_google_ads_keyword_action_apply',
      tenantId: 'tenant-1',
      username: 'tester',
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      action: 'include_keyword',
      dryRun: true,
    }));
  });

  test('controller updateGoogleAdsRecommendation retorna 200 e registra auditoria', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ status: 'approved', note: 'validada pelo operador' })),
    });
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {},
      googleAdsRecommendationSvc: {
        syncRecommendationsFromAnalysis: jest.fn(async () => ({ ok: true, created: 1, skipped: 0, recommendations: [] })),
        listRecommendations: jest.fn(async () => ({ ok: true, total: 0, items: [] })),
        updateRecommendationStatus: jest.fn(async () => ({ ok: true, recommendation: { id: 'rec-1', status: 'approved' } })),
        applyRecommendation: jest.fn(async () => ({ ok: true, recommendation: { id: 'rec-1', status: 'applied' }, actionResult: { ok: true } })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', params: { recommendationId: 'rec-1' }, agent: { id: 'agent-1', username: 'tester' }, ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
    const res = {};

    await controller.updateGoogleAdsRecommendation(req, res);

    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'marketing_google_ads_recommendation_status_update',
      resourceId: 'rec-1',
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ ok: true }));
  });

  test('controller getGoogleAdsRoiBreakdown retorna 200 com resumo financeiro', async () => {
    const deps = makeDeps();
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {},
      googleAdsRoiSvc: {
        getGoogleAdsRoiBreakdown: jest.fn(async () => ({
          ok: true,
          entity: 'campaign',
          summary: {
            keywords: { cost: 120, conversionValue: 480, roas: 4, roi: 3 },
            searchTerms: { cost: 110, conversionValue: 430, roas: 3.9091, roi: 2.9091 },
          },
          total: 1,
          items: [{ campaignId: 'cmp-1', campaignName: 'Search', cost: 120, conversionValue: 480, roas: 4, roi: 3 }],
        })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', url: '/api/marketing/google-ads/roi?entity=campaign' };
    const res = {};

    await controller.getGoogleAdsRoiBreakdown(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      entity: 'campaign',
      total: 1,
    }));
  });

  test('controller getGoogleAdsAttributionExceptions retorna 200 com resumo operacional', async () => {
    const deps = makeDeps();
    const service = createMarketingService({
      marketingService: {},
      marketingLinkService: {},
      googleAdsAttributionMonitorSvc: {
        getOrderAttributionExceptions: jest.fn(async () => ({
          ok: true,
          windowDays: 7,
          summary: {
            totalMissing: 4,
            recentMissing: 2,
            distinctOrdersRecent: 2,
            lastOccurredAt: '2026-04-19T12:00:00.000Z',
          },
          alert: {
            windowDays: 7,
            triggered: true,
            severity: 'warning',
            currentCount: 4,
            previousCount: 2,
            growthFactor: 2,
            thresholds: { minRecentMissing: 3, growthFactorThreshold: 2 },
          },
          bySource: [{ source: 'orders.storefront', total: 4, recent: 2 }],
          items: [{ id: 'ev-1', orderId: 'ord-1', source: 'orders.storefront' }],
        })),
      },
    });
    const controller = createMarketingController({ service, deps });
    const req = { tenantId: 'tenant-1', url: '/api/marketing/google-ads/attribution-exceptions?windowDays=7&limit=20' };
    const res = {};

    await controller.getGoogleAdsAttributionExceptions(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      ok: true,
      windowDays: 7,
      alert: expect.objectContaining({ severity: 'warning' }),
      summary: expect.objectContaining({ recentMissing: 2 }),
    }));
  });
});
