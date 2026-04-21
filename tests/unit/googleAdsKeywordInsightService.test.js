'use strict';

describe('googleAdsKeywordInsightService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.fetch;
  });

  test('syncKeywordPerformance consulta Google Ads e persiste keywords e search terms', async () => {
    const keywordUpsert = jest.fn(async () => [true]);
    const searchTermUpsert = jest.fn(async () => [true]);

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          results: [{
            segments: { date: '2026-04-01' },
            campaign: { id: 'cmp-1', name: 'Campanha Search' },
            adGroup: { id: 'ag-1', name: 'Grupo 1' },
            adGroupCriterion: {
              criterionId: 'kw-1',
              status: 'ENABLED',
              keyword: { text: 'clinica odontologica', matchType: 'EXACT' },
            },
            metrics: {
              impressions: 100,
              clicks: 15,
              costMicros: 45000000,
              conversions: 3,
              conversionsValue: 900,
              averageCpc: 3000000,
              ctr: 0.15,
            },
          }],
        }]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ([{
          results: [{
            segments: { date: '2026-04-01' },
            campaign: { id: 'cmp-1', name: 'Campanha Search' },
            adGroup: { id: 'ag-1', name: 'Grupo 1' },
            searchTermView: { searchTerm: 'dentista urgente', status: 'ADDED_EXCLUDED', matchType: 'BROAD' },
            adGroupCriterion: {
              criterionId: 'kw-1',
              keyword: { text: 'clinica odontologica', matchType: 'EXACT' },
            },
            metrics: {
              impressions: 80,
              clicks: 10,
              costMicros: 20000000,
              conversions: 0,
              conversionsValue: 0,
              averageCpc: 2000000,
              ctr: 0.125,
            },
          }],
        }]),
      });

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdsKeywordMetric: () => ({ upsert: keywordUpsert }),
      MarketingAdsSearchTermMetric: () => ({ upsert: searchTermUpsert }),
    }));
    jest.doMock('../../api/services/marketing/googleAdsConversionService', () => ({
      getGoogleAdsSettingsForUpload: jest.fn(async () => ({
        ok: true,
        value: {
          enabled: true,
          customerId: '1234567890',
          developerToken: 'dev-token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshToken: 'refresh-token',
          loginCustomerId: '9999999999',
        },
      })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn(async () => ({ text: '{}' })),
    }));

    const service = require('../../api/services/marketing/googleAdsKeywordInsightService');
    const out = await service.syncKeywordPerformance({
      tenantId: 'tenant-1',
      startDate: '2026-04-01',
      endDate: '2026-04-02',
    });

    expect(out.ok).toBe(true);
    expect(out.keywordRows).toBe(1);
    expect(out.searchTermRows).toBe(1);
    expect(keywordUpsert).toHaveBeenCalledTimes(1);
    expect(searchTermUpsert).toHaveBeenCalledTimes(1);
    expect(keywordUpsert.mock.calls[0][0]).toMatchObject({
      tenant_key: 'tenant-1',
      campaign_id: 'cmp-1',
      keyword_text: 'clinica odontologica',
      cost: 45,
      conversions: 3,
    });
    expect(searchTermUpsert.mock.calls[0][0]).toMatchObject({
      tenant_key: 'tenant-1',
      search_term: 'dentista urgente',
      matched_keyword_text: 'clinica odontologica',
      cost: 20,
    });
  });

  test('analyzeKeywordPortfolio gera recomendações heurísticas e resumo de IA', async () => {
    const keywordFindAll = jest.fn(async () => ([
      {
        toJSON: () => ({
          tenant_key: 'tenant-1',
          platform: 'google_ads',
          metric_date: '2026-04-01',
          campaign_id: 'cmp-1',
          campaign_name: 'Campanha Search',
          ad_group_id: 'ag-1',
          ad_group_name: 'Grupo 1',
          keyword_id: 'kw-1',
          keyword_text: 'dentista barato',
          match_type: 'BROAD',
          impressions: 300,
          clicks: 24,
          cost: '75.0000',
          conversions: '0.0000',
          conversion_value: '0.0000',
        }),
      },
      {
        toJSON: () => ({
          tenant_key: 'tenant-1',
          platform: 'google_ads',
          metric_date: '2026-04-01',
          campaign_id: 'cmp-1',
          campaign_name: 'Campanha Search',
          ad_group_id: 'ag-1',
          ad_group_name: 'Grupo 1',
          keyword_id: 'kw-2',
          keyword_text: 'clinica odontologica',
          match_type: 'EXACT',
          impressions: 120,
          clicks: 18,
          cost: '36.0000',
          conversions: '4.0000',
          conversion_value: '720.0000',
        }),
      },
    ]));
    const searchTermFindAll = jest.fn(async () => ([
      {
        toJSON: () => ({
          tenant_key: 'tenant-1',
          platform: 'google_ads',
          metric_date: '2026-04-01',
          campaign_id: 'cmp-1',
          campaign_name: 'Campanha Search',
          ad_group_id: 'ag-1',
          ad_group_name: 'Grupo 1',
          search_term: 'dentista 24 horas',
          matched_keyword_text: 'clinica odontologica',
          matched_keyword_match_type: 'EXACT',
          impressions: 90,
          clicks: 12,
          cost: '30.0000',
          conversions: '2.0000',
          conversion_value: '400.0000',
        }),
      },
      {
        toJSON: () => ({
          tenant_key: 'tenant-1',
          platform: 'google_ads',
          metric_date: '2026-04-01',
          campaign_id: 'cmp-1',
          campaign_name: 'Campanha Search',
          ad_group_id: 'ag-1',
          ad_group_name: 'Grupo 1',
          search_term: 'curso de dentista',
          matched_keyword_text: 'dentista barato',
          matched_keyword_match_type: 'BROAD',
          impressions: 200,
          clicks: 14,
          cost: '42.0000',
          conversions: '0.0000',
          conversion_value: '0.0000',
        }),
      },
    ]));

    const generateAiResponse = jest.fn(async () => ({
      text: JSON.stringify({
        summary: 'Adicionar dentista 24 horas e negativar curso de dentista. Pausar dentista barato.',
        suggestions: [
          { action: 'include_keyword', term: 'dentista 24 horas', rationale: 'Alta intenção e já converteu.', confidence: 0.92 },
          { action: 'add_negative_keyword', term: 'curso de dentista', rationale: 'Consome verba sem conversão.', confidence: 0.88 },
        ],
      }),
    }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdsKeywordMetric: () => ({ findAll: keywordFindAll }),
      MarketingAdsSearchTermMetric: () => ({ findAll: searchTermFindAll }),
    }));
    jest.doMock('../../api/services/marketing/googleAdsConversionService', () => ({
      getGoogleAdsSettingsForUpload: jest.fn(async () => ({ ok: true, value: {} })),
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({ generateAiResponse }));

    const service = require('../../api/services/marketing/googleAdsKeywordInsightService');
    const out = await service.analyzeKeywordPortfolio({
      tenantId: 'tenant-1',
      startDate: '2026-04-01',
      endDate: '2026-04-02',
    });

    expect(out.ok).toBe(true);
    expect(out.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'include_keyword', term: 'dentista 24 horas' }),
      expect.objectContaining({ action: 'add_negative_keyword', term: 'curso de dentista' }),
      expect.objectContaining({ action: 'remove_or_pause_keyword', keywordText: 'dentista barato' }),
    ]));
    expect(out.ai.summary).toContain('Adicionar dentista 24 horas');
    expect(generateAiResponse).toHaveBeenCalledTimes(1);
  });
});