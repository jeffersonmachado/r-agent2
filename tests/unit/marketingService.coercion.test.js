'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('marketingService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('upsertForm returns tenant_required for hostile tenantId coercion', async () => {
    const marketingFormFindOne = jest.fn();

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingForm: () => ({ findOne: marketingFormFindOne, create: jest.fn() }),
      MarketingLead: () => ({}),
      MarketingFormSubmission: () => ({}),
      MarketingScoringRule: () => ({}),
      MarketingEmailCampaign: () => ({}),
      MarketingEmailSend: () => ({}),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1: jest.fn(async () => ({ ok: true })) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn(async () => ({ queued: true })) }));

    const { upsertForm } = require('../../api/services/marketing/marketingService');

    const out = await upsertForm({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      slug: 'lead-form',
      name: 'Lead Form',
    });

    expect(out).toEqual({ ok: false, error: 'tenant_required' });
    expect(marketingFormFindOne).not.toHaveBeenCalled();
  });

  test('recordMarketingEvent tolerates hostile coercions in event fields', async () => {
    const appendEventV1 = jest.fn(async () => ({ ok: true, id: 'ev-1' }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingForm: () => ({}),
      MarketingLead: () => ({}),
      MarketingFormSubmission: () => ({}),
      MarketingScoringRule: () => ({}),
      MarketingEmailCampaign: () => ({}),
      MarketingEmailSend: () => ({}),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1 }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn(async () => ({ queued: true })) }));

    const { recordMarketingEvent } = require('../../api/services/marketing/marketingService');

    await expect(recordMarketingEvent({
      tenantId: 'tenant-1',
      eventType: { toString: () => { throw new Error('boom-type'); } },
      correlationId: { toString: () => { throw new Error('boom-correlation'); } },
      lead: { id: { toString: () => { throw new Error('boom-lead'); } } },
      payload: { idempotencyKey: { toString: () => { throw new Error('boom-idem'); } } },
    })).resolves.toEqual({ ok: true, id: 'ev-1' });

    expect(appendEventV1).toHaveBeenCalledTimes(1);
    expect(appendEventV1.mock.calls[0][0]).toMatchObject({
      tenantId: 'tenant-1',
      type: '',
      correlationId: '',
      subject: { type: 'marketing', id: 'anonymous' },
    });
  });

  test('submitForm tolerates hostile ipAddress/userAgent coercion', async () => {
    const submissionCreate = jest.fn(async (payload) => ({ toJSON: () => ({ ...payload }) }));
    const formFindOne = jest.fn(async () => ({ toJSON: () => ({ id: 'form-1', slug: 'lp', tenant_key: 'tenant-1' }) }));
    const leadFindOne = jest.fn(async () => null);
    const leadCreate = jest.fn(async (payload) => ({ id: 'lead-1', ...payload, toJSON: () => ({ id: 'lead-1', ...payload }) }));
    const ruleFindAll = jest.fn(async () => []);

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingForm: () => ({ findOne: formFindOne }),
      MarketingLead: () => ({ findOne: leadFindOne, create: leadCreate }),
      MarketingFormSubmission: () => ({ create: submissionCreate, findOne: jest.fn() }),
      MarketingScoringRule: () => ({ findAll: ruleFindAll }),
      MarketingEmailCampaign: () => ({}),
      MarketingEmailSend: () => ({}),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1: jest.fn(async () => ({ ok: true })) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn(async () => ({ queued: true })) }));

    const { submitForm } = require('../../api/services/marketing/marketingService');

    const out = await submitForm({
      tenantId: 'tenant-1',
      slug: 'lp',
      data: { email: 'lead@example.com', name: 'Lead One' },
      ipAddress: { toString: () => { throw new Error('boom-ip'); } },
      userAgent: { toString: () => { throw new Error('boom-ua'); } },
    });

    expect(out.ok).toBe(true);
    expect(submissionCreate).toHaveBeenCalledTimes(1);
    expect(submissionCreate.mock.calls[0][0]).toMatchObject({
      ip_address: '',
      user_agent: '',
    });
  });

  test('submitForm persists canonical Google Ads attribution from payload', async () => {
    const submissionCreate = jest.fn(async (payload) => ({ toJSON: () => ({ ...payload }) }));
    const formFindOne = jest.fn(async () => ({ toJSON: () => ({ id: 'form-1', slug: 'lp', tenant_key: 'tenant-1' }) }));
    const leadFindOne = jest.fn(async () => null);
    const leadCreate = jest.fn(async (payload) => ({ id: 'lead-1', ...payload, toJSON: () => ({ id: 'lead-1', ...payload }) }));
    const ruleFindAll = jest.fn(async () => []);

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingForm: () => ({ findOne: formFindOne }),
      MarketingLead: () => ({ findOne: leadFindOne, create: leadCreate }),
      MarketingFormSubmission: () => ({ create: submissionCreate, findOne: jest.fn() }),
      MarketingScoringRule: () => ({ findAll: ruleFindAll }),
      MarketingEmailCampaign: () => ({}),
      MarketingEmailSend: () => ({}),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1: jest.fn(async () => ({ ok: true })) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn(async () => ({ queued: true })) }));

    const { submitForm } = require('../../api/services/marketing/marketingService');

    const out = await submitForm({
      tenantId: 'tenant-1',
      slug: 'lp',
      data: {
        email: 'lead@example.com',
        name: 'Lead Ads',
        utm_source: 'google',
        utm_campaign: 'brand-search',
        __tracking: {
          gclid: 'test-gclid-123',
          landingUrl: 'https://example.com/lp?utm_source=google&utm_campaign=brand-search&gclid=test-gclid-123',
          referrer: 'https://www.google.com/',
        },
      },
    });

    expect(out.ok).toBe(true);
    expect(leadCreate).toHaveBeenCalledTimes(1);
    expect(leadCreate.mock.calls[0][0].attributes).toMatchObject({
      utm_source: 'google',
      utm_campaign: 'brand-search',
      gclid: 'test-gclid-123',
      lastAttribution: expect.objectContaining({
        utm_source: 'google',
        utm_campaign: 'brand-search',
        gclid: 'test-gclid-123',
        landingUrl: 'https://example.com/lp?utm_source=google&utm_campaign=brand-search&gclid=test-gclid-123',
        referrer: 'https://www.google.com/',
      }),
    });
  });

  test('updateLead registra conversao offline quando stage muda para customer', async () => {
    const rowUpdate = jest.fn(async () => ({}));
    const leadRow = {
      id: 'lead-1',
      stage: 'lead',
      attributes: {
        gclid: 'gclid-123',
        currencyCode: 'BRL',
      },
      toJSON: () => ({
        id: 'lead-1',
        stage: 'lead',
        attributes: {
          gclid: 'gclid-123',
          currencyCode: 'BRL',
        },
      }),
      update: rowUpdate,
    };
    const leadFindOne = jest.fn(async () => leadRow);
    const registerOfflineConversion = jest.fn(async () => ({ ok: true, conversion: { id: 'conv-1' } }));

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      MarketingForm: () => ({}),
      MarketingLead: () => ({ findOne: leadFindOne }),
      MarketingFormSubmission: () => ({}),
      MarketingScoringRule: () => ({}),
      MarketingEmailCampaign: () => ({}),
      MarketingEmailSend: () => ({}),
    }));
    jest.doMock('../../api/services/eventLedgerService', () => ({ appendEventV1: jest.fn(async () => ({ ok: true })) }));
    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn(async () => ({ queued: true })) }));
    jest.doMock('../../api/services/marketing/googleAdsConversionService', () => ({
      getGoogleAdsSettingsForUpload: jest.fn(async () => ({
        ok: true,
        value: {
          defaultConversionName: 'customer',
          defaultConversionActionId: 'action-1',
          defaultCurrencyCode: 'BRL',
        },
      })),
      registerOfflineConversion,
    }));

    const { updateLead } = require('../../api/services/marketing/marketingService');
    const out = await updateLead({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      stage: 'customer',
      attributesPatch: { convertedBy: 'test' },
    });

    expect(out.ok).toBe(true);
    expect(rowUpdate).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'customer',
    }));
    expect(registerOfflineConversion).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      leadId: 'lead-1',
      conversionName: 'customer',
      conversionActionId: 'action-1',
      currencyCode: 'BRL',
      idempotencyKey: 'google_ads:auto_customer:tenant-1:lead-1',
    }));
  });
});
