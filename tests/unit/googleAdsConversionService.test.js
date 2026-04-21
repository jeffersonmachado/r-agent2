'use strict';

describe('googleAdsConversionService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('registerOfflineConversion captura gclid do lead e persiste conversao pendente', async () => {
    const create = jest.fn(async (payload) => ({ toJSON: () => ({ ...payload }) }));
    const conversionFindOne = jest.fn(async () => null);
    const leadFindOne = jest.fn(async () => ({
      toJSON: () => ({
        id: 'lead-1',
        email: 'lead@example.com',
        stage: 'customer',
        attributes: {
          lastAttribution: {
            gclid: 'gclid-test-123',
            utm_source: 'google',
          },
        },
      }),
    }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdConversion: () => ({ findOne: conversionFindOne, create }),
      MarketingLead: () => ({ findOne: leadFindOne }),
      Tenant: () => ({ findOne: jest.fn(async () => ({ id: 'tenant-uuid-1', tenant_key: 'tenant-1' })) }),
      TenantAICredential: () => ({ findOne: jest.fn(async () => null) }),
    }));
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: null })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const service = require('../../api/services/marketing/googleAdsConversionService');
    const out = await service.registerOfflineConversion({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversionName: 'customer',
      conversionValue: 129.9,
      currencyCode: 'brl',
      idempotencyKey: 'conv-1',
    });

    expect(out.ok).toBe(true);
    expect(out.deduplicated).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      tenant_key: 'tenant-1',
      lead_id: 'lead-1',
      click_id_type: 'gclid',
      click_id: 'gclid-test-123',
      conversion_name: 'customer',
      currency_code: 'BRL',
      status: 'pending',
      idempotency_key: 'conv-1',
    });
  });

  test('uploadPendingConversions falha quando integracao do tenant esta desabilitada', async () => {
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdConversion: () => ({ findAll: jest.fn(async () => []) }),
      MarketingLead: () => ({ findOne: jest.fn(async () => null) }),
      Tenant: () => ({ findOne: jest.fn(async () => ({ id: 'tenant-uuid-1', tenant_key: 'tenant-1' })) }),
      TenantAICredential: () => ({ findOne: jest.fn(async () => null) }),
    }));
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: { enabled: false } })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const service = require('../../api/services/marketing/googleAdsConversionService');
    const out = await service.uploadPendingConversions({
      tenantId: 'tenant-1',
      uploader: jest.fn(async () => ({ uploadId: 'u-1' })),
    });

    expect(out).toEqual({ ok: false, error: 'integration_disabled' });
  });

  test('uploadPendingConversions usa uploader injetado e marca conversoes como uploaded', async () => {
    const update = jest.fn(async () => ({}));
    const findAll = jest.fn(async () => ([{
      toJSON: () => ({
        id: 'conv-1',
        tenant_key: 'tenant-1',
        click_id_type: 'gclid',
        click_id: 'gclid-123',
        conversion_name: 'customer',
        conversion_action_id: null,
        conversion_time: new Date('2026-04-18T10:00:00.000Z'),
        conversion_value: '99.90',
        currency_code: 'BRL',
        attempts: 0,
        metadata: {},
      }),
      update,
    }]));
    const uploader = jest.fn(async ({ conversion }) => ({ uploadId: `uploaded-${conversion.clickId}` }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdConversion: () => ({ findAll }),
      MarketingLead: () => ({ findOne: jest.fn(async () => null) }),
      Tenant: () => ({ findOne: jest.fn(async () => ({ id: 'tenant-uuid-1', tenant_key: 'tenant-1' })) }),
      TenantAICredential: () => ({ findOne: jest.fn(async () => null) }),
    }));
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({
        ok: true,
        value: {
          enabled: true,
          customerId: '1234567890',
          loginCustomerId: '9999999999',
          defaultConversionActionId: 'action-1',
          dryRun: true,
        },
      })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const service = require('../../api/services/marketing/googleAdsConversionService');
    const out = await service.uploadPendingConversions({ tenantId: 'tenant-1', uploader });

    expect(out).toEqual({ ok: true, uploaded: 1, failed: 0, attempted: 1 });
    expect(uploader).toHaveBeenCalledTimes(1);
    expect(uploader.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      conversion: expect.objectContaining({
        customerId: '1234567890',
        loginCustomerId: '9999999999',
        conversionActionId: 'action-1',
        clickIdType: 'gclid',
        clickId: 'gclid-123',
      }),
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'uploaded',
      external_upload_id: 'uploaded-gclid-123',
      last_error: null,
    }));
  });

  test('googleAdsApiUploader usa OAuth e endpoint uploadClickConversions', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [{}], jobId: 'job-1' }),
      });
    global.fetch = fetchMock;

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdConversion: () => ({ findAll: jest.fn(async () => []) }),
      MarketingLead: () => ({ findOne: jest.fn(async () => null) }),
      Tenant: () => ({ findOne: jest.fn(async () => ({ id: 'tenant-uuid-1', tenant_key: 'tenant-1' })) }),
      TenantAICredential: () => ({ findOne: jest.fn(async () => null) }),
    }));
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: null })),
      upsertSetting: jest.fn(async () => ({ ok: true, value: {} })),
    }));

    const service = require('../../api/services/marketing/googleAdsConversionService');
    const out = await service.googleAdsApiUploader({
      settings: {
        enabled: true,
        customerId: '1234567890',
        loginCustomerId: '9999999999',
        defaultConversionActionId: '111222333',
        defaultCurrencyCode: 'BRL',
        developerToken: 'dev-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        dryRun: true,
      },
      conversion: {
        clickIdType: 'gclid',
        clickId: 'gclid-123',
        conversionTime: '2026-04-18T10:00:00.000Z',
        conversionValue: 50,
        currencyCode: 'BRL',
        metadata: { leadId: 'lead-1' },
      },
    });

    expect(out).toEqual(expect.objectContaining({ uploadId: 'job-1' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://googleads.googleapis.com/v17/customers/1234567890:uploadClickConversions');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-123',
        'developer-token': 'dev-token',
        'login-customer-id': '9999999999',
      }),
    });
  });

  test('upsertGoogleAdsSettings separa segredos em TenantAICredential criptografado', async () => {
    const credentialCreate = jest.fn(async () => ({ id: 'cred-1' }));
    const credentialFindOne = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ api_key_encrypted: 'encrypted-json' });
    const tenantFindOne = jest.fn(async ({ where }) => {
      if (where && where.tenant_key === 'tenant-1') return { id: 'tenant-uuid-1', tenant_key: 'tenant-1' };
      return null;
    });
    const upsertSetting = jest.fn(async () => ({ ok: true, value: {} }));
    const decryptMock = jest.fn(() => JSON.stringify({ developerToken: 'dev-token' }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingAdConversion: () => ({ findOne: jest.fn(async () => null), findAll: jest.fn(async () => []) }),
      MarketingLead: () => ({ findOne: jest.fn(async () => null) }),
      Tenant: () => ({ findOne: tenantFindOne }),
      TenantAICredential: () => ({
        findOne: credentialFindOne,
        create: credentialCreate,
      }),
    }));
    jest.doMock('../../api/services/tenantSettingsService', () => ({
      getSetting: jest.fn(async () => ({ ok: true, value: { enabled: true, customerId: '123' } })),
      upsertSetting,
    }));
    jest.doMock('../../api/utils/crypto', () => ({
      encrypt: jest.fn(() => 'encrypted-json'),
      decrypt: decryptMock,
    }));

    const service = require('../../api/services/marketing/googleAdsConversionService');
    const out = await service.upsertGoogleAdsSettings({
      tenantId: 'tenant-1',
      value: {
        enabled: true,
        customerId: '123-456-7890',
        defaultConversionActionId: 'action-1',
        developerToken: 'dev-token',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
      },
    });

    expect(upsertSetting).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      key: 'google_ads',
      value: expect.objectContaining({
        enabled: true,
        customerId: '1234567890',
        defaultConversionActionId: 'action-1',
      }),
    }));
    expect(credentialCreate).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-uuid-1',
      provider: 'google_ads',
      api_key_encrypted: 'encrypted-json',
    }));
    expect(out.ok).toBe(true);
    expect(out.value.hasDeveloperToken).toBe(true);
  });
});