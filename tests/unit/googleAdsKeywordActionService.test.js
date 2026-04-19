'use strict';

describe('googleAdsKeywordActionService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.fetch;
  });

  test('applyKeywordAction usa OAuth e adGroupCriteria:mutate em dry-run para incluir keyword', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-abc' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{ resourceName: 'customers/123/adGroupCriteria/456~789' }] }),
      });
    global.fetch = fetchMock;

    jest.doMock('../../api/services/marketing/googleAdsConversionService', () => ({
      getGoogleAdsSettingsForUpload: jest.fn(async () => ({
        ok: true,
        value: {
          enabled: true,
          customerId: '123-456-7890',
          loginCustomerId: '999-999-9999',
          developerToken: 'dev-token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
          refreshToken: 'refresh-token',
          dryRun: false,
        },
      })),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: jest.fn(async () => ({ ok: true })),
    }));

    const service = require('../../api/services/marketing/googleAdsKeywordActionService');
    const out = await service.applyKeywordAction({
      tenantId: 'tenant-1',
      action: 'include_keyword',
      payload: {
        campaignId: '123',
        adGroupId: '456',
        keywordText: 'crm industrial',
        matchType: 'phrase',
        dryRun: true,
      },
    });

    expect(out).toEqual(expect.objectContaining({
      ok: true,
      action: 'include_keyword',
      dryRun: true,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://googleads.googleapis.com/v17/customers/1234567890/adGroupCriteria:mutate');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-abc',
        'developer-token': 'dev-token',
        'login-customer-id': '9999999999',
      }),
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(expect.objectContaining({
      validateOnly: true,
      operations: [
        {
          create: {
            adGroup: 'customers/1234567890/adGroups/456',
            status: 'ENABLED',
            keyword: {
              text: 'crm industrial',
              matchType: 'PHRASE',
            },
          },
        },
      ],
    }));
  });
});