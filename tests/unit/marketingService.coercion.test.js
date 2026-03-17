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
});
