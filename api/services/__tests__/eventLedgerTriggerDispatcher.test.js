'use strict';

jest.mock('../../db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

const mockFindOne = jest.fn();

jest.mock('../../db/models', () => ({
  EventLedger: () => ({
    findOne: mockFindOne,
  }),
}));

const mockTriggerWebhooks = jest.fn();
const mockDispatchFlowsForEvent = jest.fn();

jest.mock('../webhookService', () => ({
  triggerWebhooks: (...args) => mockTriggerWebhooks(...args),
}));

jest.mock('../flowEventTriggerService', () => ({
  dispatchFlowsForEvent: (...args) => mockDispatchFlowsForEvent(...args),
}));

const { getSequelize } = require('../../db/sequelize');
const { dispatchOne } = require('../eventLedgerTriggerDispatcher');

describe('eventLedgerTriggerDispatcher.dispatchOne', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.EVENT_DISPATCH_STRICT_FAILURES;
    getSequelize.mockReturnValue({});
    mockFindOne.mockResolvedValue({
      toJSON: () => ({
        id: 'ev1',
        type: 'CallRinging',
        source: 'pbx.cdr',
        occurred_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        correlation_id: 'corr-1',
        subject_type: 'pbx_call',
        subject_id: 'call-1',
        actor_type: 'system',
        actor_id: 'pbx',
        payload: { ok: true },
      }),
    });
  });

  test('webhooks failure throws when only webhooks target', async () => {
    mockTriggerWebhooks.mockRejectedValue(new Error('wh_fail'));

    await expect(dispatchOne({
      tenantId: 't1',
      consumer: 'webhooks_v1',
      eventId: 'ev1',
      dispatchTargets: ['webhooks'],
    })).rejects.toThrow('wh_fail');
  });

  test('flows failure throws when only flows target', async () => {
    mockDispatchFlowsForEvent.mockRejectedValue(new Error('flow_fail'));

    await expect(dispatchOne({
      tenantId: 't1',
      consumer: 'webhooks_v1',
      eventId: 'ev1',
      dispatchTargets: ['flows'],
    })).rejects.toThrow('flow_fail');
  });

  test('webhooks failure throws when targets include flows', async () => {
    mockTriggerWebhooks.mockRejectedValue(new Error('wh_fail'));
    mockDispatchFlowsForEvent.mockResolvedValue({ ok: true });

    await expect(dispatchOne({
      tenantId: 't1',
      consumer: 'webhooks_v1',
      eventId: 'ev1',
      dispatchTargets: ['webhooks', 'flows'],
    })).rejects.toThrow('wh_fail');
  });

  test('can keep legacy best-effort behavior when strict failures is disabled', async () => {
    process.env.EVENT_DISPATCH_STRICT_FAILURES = 'false';
    mockTriggerWebhooks.mockRejectedValue(new Error('wh_fail'));
    mockDispatchFlowsForEvent.mockResolvedValue({ ok: true });

    const out = await dispatchOne({
      tenantId: 't1',
      consumer: 'webhooks_v1',
      eventId: 'ev1',
      dispatchTargets: ['webhooks', 'flows'],
    });

    expect(out.ok).toBe(true);
    expect(out.webhooksOk).toBe(false);
    expect(out.flowsOk).toBe(true);
  });
});
