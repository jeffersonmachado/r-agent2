'use strict';

const { createExecutionTraceService } = require('../../../api/services/governance/executionTraceService');

function makeRow(data) {
  return {
    ...data,
    toJSON() {
      const { toJSON, update, save, ...plain } = this;
      return { ...plain };
    },
    async update(patch) {
      Object.assign(this, patch);
      return this;
    },
  };
}

function makeHarness() {
  const runs = [makeRow({
    run_id: 'run-1',
    tenant_id: 'tenant-a',
    source_fingerprint: 'a'.repeat(64),
    status: 'RUNNING',
  })];
  const traces = [];
  const events = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const sequelize = {
    transaction: jest.fn(async (work) => work(transaction)),
  };

  const GovernanceRun = {
    sequelize,
    findOne: jest.fn(async ({ where }) => runs.find((row) => (
      row.run_id === where.run_id && row.tenant_id === where.tenant_id
    )) || null),
  };
  const ExecutionTrace = {
    sequelize,
    create: jest.fn(async (values) => {
      const row = makeRow(values);
      traces.push(row);
      return row;
    }),
    findOne: jest.fn(async ({ where }) => traces.find((row) => (
      row.id === where.id
      && (!where.run_id || row.run_id === where.run_id)
      && (!where.tenant_id || row.tenant_id === where.tenant_id)
    )) || null),
  };
  const EventLedger = {
    sequelize,
    findOne: jest.fn(async ({ where }) => events.find((row) => Object.entries(where || {}).every(
      ([key, value]) => row[key] === value,
    )) || null),
    findAll: jest.fn(async ({ where }) => events.filter((row) => Object.entries(where || {}).every(
      ([key, value]) => row[key] === value,
    ))),
    count: jest.fn(async ({ where }) => events.filter((row) => Object.entries(where || {}).every(
      ([key, value]) => row[key] === value,
    )).length),
    create: jest.fn(async (values) => {
      const row = makeRow(values);
      events.push(row);
      return row;
    }),
  };

  const service = createExecutionTraceService({
    sequelize,
    GovernanceRun,
    ExecutionTrace,
    EventLedger,
    idFactory: () => '00000000-0000-4000-8000-000000000001',
    clock: () => new Date('2026-08-21T12:00:00.000Z'),
  });

  const traceContext = {
    tenantId: 'tenant-a',
    runId: 'run-1',
    sourceFingerprint: 'a'.repeat(64),
    traceId: '00000000-0000-4000-8000-000000000001',
    traceType: 'CRITICAL_JOURNEY',
    criticalJourneyId: 'support_ticket_flow',
    correlationId: 'corr-1',
    executionId: 'exec-1',
    principalId: 'principal-1',
    startedAt: '2026-08-21T11:59:59.000Z',
  };

  return { service, traceContext, runs, traces, events, GovernanceRun, ExecutionTrace, EventLedger };
}

async function createTrace(harness) {
  return harness.service.createTrace(harness.traceContext);
}

function eventArgs(context, overrides = {}) {
  return {
    tenantId: context.tenantId,
    runId: context.runId,
    sourceFingerprint: context.sourceFingerprint,
    traceId: context.traceId,
    criticalJourneyId: context.criticalJourneyId,
    correlationId: context.correlationId,
    executionId: context.executionId,
    principalId: context.principalId,
    eventId: 'evt-a',
    parentEventId: null,
    causationId: 'evt-a',
    eventType: 'channel.message.inbound',
    producer: 'runtime:channel-whatsapp',
    occurredAt: '2026-08-21T12:00:01.000Z',
    payload: { observed: true },
    ...overrides,
  };
}

describe('governance/executionTraceService', () => {
  test('persiste e reconstrói a cadeia causal A -> B -> C sem inferir IDs', async () => {
    const h = makeHarness();
    await createTrace(h);

    await h.service.appendEvent(eventArgs(h.traceContext));
    await h.service.appendEvent(eventArgs(h.traceContext, {
      eventId: 'evt-b',
      parentEventId: 'evt-a',
      causationId: 'evt-a',
      eventType: 'cognitive.context.completed',
      producer: 'runtime:cognitive-core',
      occurredAt: '2026-08-21T12:00:02.000Z',
    }));
    await h.service.appendEvent(eventArgs(h.traceContext, {
      eventId: 'evt-c',
      parentEventId: 'evt-b',
      causationId: 'evt-a',
      eventType: 'business.outcome.validated',
      producer: 'runtime:outcome-engine',
      occurredAt: '2026-08-21T12:00:03.000Z',
    }));

    const reconstructed = await h.service.reconstructTrace(h.traceContext);
    expect(reconstructed.events.map((event) => event.eventId)).toEqual(['evt-a', 'evt-b', 'evt-c']);
    expect(reconstructed.events.map((event) => event.parentEventId)).toEqual([null, 'evt-a', 'evt-b']);
    expect(reconstructed.eventCount).toBe(3);

    const closed = await h.service.closeTrace({
      ...h.traceContext,
      completedAt: '2026-08-21T12:00:04.000Z',
    });
    expect(closed.trace.status).toBe('COMPLETED');
    expect(closed.trace.eventCount).toBe(3);
  });

  test('rejeita parent e causation ausentes ou externos ao trace', async () => {
    const h = makeHarness();
    await createTrace(h);
    await h.service.appendEvent(eventArgs(h.traceContext));

    await expect(h.service.appendEvent(eventArgs(h.traceContext, {
      eventId: 'evt-b', parentEventId: 'evt-missing', causationId: 'evt-a',
    }))).rejects.toMatchObject({ code: 'TRACE_PARENT_NOT_FOUND' });

    await expect(h.service.appendEvent(eventArgs(h.traceContext, {
      eventId: 'evt-b', parentEventId: 'evt-a', causationId: 'evt-missing',
    }))).rejects.toMatchObject({ code: 'TRACE_CAUSATION_NOT_FOUND' });
  });

  test('rejeita run/source estrangeiro e contexto cross-tenant', async () => {
    const h = makeHarness();
    await expect(h.service.createTrace({
      ...h.traceContext,
      sourceFingerprint: 'b'.repeat(64),
    })).rejects.toMatchObject({ code: 'RUN_SOURCE_DRIFT' });

    await expect(h.service.createTrace({
      ...h.traceContext,
      tenantId: 'tenant-b',
    })).rejects.toMatchObject({ code: 'GOVERNANCE_RUN_NOT_FOUND' });

    await createTrace(h);
    await expect(h.service.appendEvent(eventArgs(h.traceContext, {
      correlationId: 'foreign-correlation',
    }))).rejects.toMatchObject({ code: 'TRACE_CONTEXT_MISMATCH' });
  });

  test('rejeita evento produzido por governance/validator/test/synthetic', async () => {
    const h = makeHarness();
    await createTrace(h);
    for (const producer of ['governance', 'validator:replay', 'test:fixture', 'synthetic:generator']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(h.service.appendEvent(eventArgs(h.traceContext, { producer })))
        .rejects.toMatchObject({ code: 'TRACE_RUNTIME_PRODUCER_REQUIRED' });
    }
    expect(h.events).toHaveLength(0);
  });

  test('não fecha trace sem nenhum evento persistido', async () => {
    const h = makeHarness();
    await createTrace(h);
    await expect(h.service.closeTrace({
      ...h.traceContext,
      completedAt: '2026-08-21T12:00:04.000Z',
    })).rejects.toMatchObject({ code: 'TRACE_EVENTS_REQUIRED' });
  });
});

