'use strict';

describe('googleAdsRoiService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('getGoogleAdsRoiBreakdown agrega ROI e ROAS por campanha', async () => {
    jest.doMock('../../api/db/models', () => ({
      Order: () => ({
        findAll: jest.fn(async () => ([
          {
            toJSON: () => ({
              id: 'ord-1',
              customer_phone: '+5511999999999',
              total_amount: 300,
              status: 'delivered',
              context: {},
            }),
          },
        ])),
      }),
      MarketingLead: () => ({
        findAll: jest.fn(async () => ([
          {
            toJSON: () => ({
              phone: '+5511999999999',
              attributes: {
                lastAttribution: {
                  utm_campaign: 'search brand',
                },
              },
            }),
          },
        ])),
      }),
    }));
    jest.doMock('sequelize', () => ({ Op: { gte: 'gte', lte: 'lte', not: 'not' } }));
    jest.doMock('../../api/services/evidenceUtils', () => ({
      normalizePhone: jest.fn((value) => value),
      normalizeText: jest.fn((value) => String(value || '').toLowerCase().trim()),
    }));
    jest.doMock('../../api/services/marketing/googleAdsKeywordInsightService', () => ({
      listKeywordPerformance: jest.fn(async () => ({
        ok: true,
        startDate: '2026-04-01',
        endDate: '2026-04-19',
        items: [
          {
            campaignId: 'cmp-1',
            campaignName: 'Search Brand',
            adGroupId: 'ag-1',
            adGroupName: 'Brand',
            keywordText: 'crm brand',
            matchType: 'EXACT',
            impressions: 100,
            clicks: 20,
            cost: 50,
            conversions: 5,
            conversionValue: 250,
            firstDate: '2026-04-01',
            lastDate: '2026-04-19',
          },
          {
            campaignId: 'cmp-1',
            campaignName: 'Search Brand',
            adGroupId: 'ag-2',
            adGroupName: 'Generic',
            keywordText: 'crm software',
            matchType: 'PHRASE',
            impressions: 200,
            clicks: 25,
            cost: 70,
            conversions: 4,
            conversionValue: 210,
            firstDate: '2026-04-01',
            lastDate: '2026-04-19',
          },
        ],
      })),
      listSearchTermPerformance: jest.fn(async () => ({
        ok: true,
        startDate: '2026-04-01',
        endDate: '2026-04-19',
        items: [
          {
            campaignId: 'cmp-1',
            campaignName: 'Search Brand',
            adGroupId: 'ag-1',
            adGroupName: 'Brand',
            searchTerm: 'crm brand preço',
            matchedKeywordText: 'crm brand',
            impressions: 40,
            clicks: 8,
            cost: 18,
            conversions: 2,
            conversionValue: 90,
            firstDate: '2026-04-01',
            lastDate: '2026-04-19',
          },
        ],
      })),
    }));

    const service = require('../../api/services/marketing/googleAdsRoiService');
    const out = await service.getGoogleAdsRoiBreakdown({ tenantId: 'tenant-1', entity: 'campaign' });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      entity: 'campaign',
      total: 1,
      summary: expect.objectContaining({
        keywords: expect.objectContaining({
          cost: 120,
          conversionValue: 460,
          roas: 3.8333,
          roi: 2.8333,
        }),
        reconciled: expect.objectContaining({
          internalRevenue: 300,
          attributedOrders: 1,
          reconciledRoas: 2.5,
          reconciledRoi: 1.5,
        }),
      }),
    }));
    expect(out.items[0]).toEqual(expect.objectContaining({
      campaignId: 'cmp-1',
      cost: 120,
      conversionValue: 460,
      roas: 3.8333,
      roi: 2.8333,
      margin: 340,
      internalRevenue: 300,
      attributedOrders: 1,
      reconciledRoas: 2.5,
      reconciledRoi: 1.5,
    }));
  });
});