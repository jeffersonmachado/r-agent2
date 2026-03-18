'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('eventLedgerTriggerDispatcher coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('dispatchOne tolera tenantId/eventId/type hostis sem lançar', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));

    jest.doMock('../../api/db/models', () => ({
      EventLedger: () => ({
        findOne: jest.fn(async () => ({
          toJSON: () => ({
            id: { toString: () => { throw new Error('boom-id'); } },
            type: { toString: () => { throw new Error('boom-type'); } },
            source: 'src',
            occurred_at: new Date().toISOString(),
            received_at: new Date().toISOString(),
            correlation_id: null,
            subject_type: null,
            subject_id: null,
            actor_type: null,
            actor_id: null,
            payload: {},
          }),
        })),
      }),
    }));

    const triggerWebhooks = jest.fn(async () => ({}));
    const dispatchFlowsForEvent = jest.fn(async () => ({ ok: true }));

    jest.doMock('../../api/services/executionQueueService', () => ({ enqueueJob: jest.fn(async () => ({})) }));
    jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks }));
    jest.doMock('../../api/services/flowEventTriggerService', () => ({ dispatchFlowsForEvent }));

    const svc = require('../../api/services/eventLedgerTriggerDispatcher');

    const out = await svc.dispatchOne({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      eventId: { toString: () => { throw new Error('boom-event'); } },
    });

    expect(out.ok).toBe(true);
    expect(Array.isArray(out.targets)).toBe(true);
    expect(triggerWebhooks).toHaveBeenCalledTimes(1);
    expect(dispatchFlowsForEvent).toHaveBeenCalledTimes(1);
  });

  test('scanAndEnqueue tolera consumer/target/eventId hostis', async () => {
    const nowIso = new Date().toISOString();
    const query = jest.fn(async (sql) => {
      if (sql.includes('SELECT id, consumer, last_received_at, last_event_id') && sql.includes('LIMIT 1')) {
        return [[{ id: 'eds:', consumer: '', last_received_at: '1970-01-01T00:00:00.000Z', last_event_id: null }]];
      }
      if (sql.includes('FOR UPDATE')) {
        return [[{ id: 'eds:', consumer: '', last_received_at: '1970-01-01T00:00:00.000Z', last_event_id: null }]];
      }
      return [[]];
    });

    const sequelize = {
      query,
      transaction: async (fn) => fn({}),
    };

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => sequelize),
    }));

    jest.doMock('../../api/db/models', () => ({
      EventLedger: () => ({
        findAll: jest.fn(async () => ([
          {
            toJSON: () => ({
              tenant_key: 'tenant-1',
              id: { toString: () => { throw new Error('boom-event-id'); } },
              received_at: nowIso,
            }),
          },
        ])),
      }),
    }));

    const enqueueJob = jest.fn(async () => ({}));
    jest.doMock('../../api/services/executionQueueService', () => ({ enqueueJob }));
    jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks: jest.fn(async () => ({})) }));
    jest.doMock('../../api/services/flowEventTriggerService', () => ({ dispatchFlowsForEvent: jest.fn(async () => ({ ok: true })) }));

    const svc = require('../../api/services/eventLedgerTriggerDispatcher');

    const out = await svc.scanAndEnqueue({
      consumer: { toString: () => { throw new Error('boom-consumer'); } },
      batchSize: 10,
      dispatchTargets: [{ toString: () => { throw new Error('boom-target'); } }],
    });

    expect(out.ok).toBe(true);
    expect(out.enqueued).toBe(1);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob.mock.calls[0][0].payload).toMatchObject({
      consumer: 'webhooks_v1',
      eventId: '',
      dispatchTargets: [''],
    });
  });
});
