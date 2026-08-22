'use strict';

jest.mock('../../../api/db/sequelize', () => ({ getSequelize: jest.fn() }));
jest.mock('../../../api/db/models/ExecutionTrace', () => jest.fn());
jest.mock('../../../api/db/models/ExecutionTraceEvent', () => jest.fn());
jest.mock('../../../api/utils/logger', () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }));

const { getSequelize } = require('../../../api/db/sequelize');
const getTrace = require('../../../api/db/models/ExecutionTrace');
const getEvent = require('../../../api/db/models/ExecutionTraceEvent');
const { recordCriticalEvent } = require('../../../api/services/governance/runtimeTraceRecorder');

describe('runtimeTraceRecorder (ponte runtime -> ExecutionTrace/Event)', () => {
  beforeEach(() => {
    getSequelize.mockReturnValue({});
  });

  test('cria trace e espelha evento causal com parent/causation', async () => {
    const trace = { id: 'trace-1', critical_journey_id: null, update: jest.fn().mockResolvedValue({}) };
    getTrace.mockReturnValue({ findOne: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(trace) });
    const eventCreate = jest.fn().mockResolvedValue({ id: 'evt-db-1' });
    getEvent.mockReturnValue({ create: eventCreate });

    await recordCriticalEvent({
      runId: 'run-1',
      correlationId: 'corr-1',
      criticalJourneyId: 'support_ticket_flow',
      executionId: 'exec-1',
      tenantId: 'tenant-a',
      principalId: 'principal-1',
      eventId: 'evt-a',
      parentEventId: null,
      causationId: 'evt-a',
      type: 'channel.message.inbound',
      subject: { type: 'ticket', id: 't-1' },
      payload: { observed: true },
    });

    expect(getTrace().create).toHaveBeenCalledWith(expect.objectContaining({ run_id: 'run-1', correlation_id: 'corr-1' }));
    expect(trace.update).toHaveBeenCalledWith({ critical_journey_id: 'support_ticket_flow' });
    expect(eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      trace_id: 'trace-1',
      event_id: 'evt-a',
      parent_event_id: null,
      causation_id: 'evt-a',
      event_type: 'channel.message.inbound',
    }));
  });

  test('reusa trace existente e nunca lança para o fluxo de negócio', async () => {
    const existing = { id: 'trace-1', critical_journey_id: 'support_ticket_flow', update: jest.fn() };
    getTrace.mockReturnValue({ findOne: jest.fn().mockResolvedValue(existing), create: jest.fn() });
    const eventCreate = jest.fn().mockResolvedValue({ id: 'evt-db-2' });
    getEvent.mockReturnValue({ create: eventCreate });

    await recordCriticalEvent({ runId: 'run-1', correlationId: 'corr-1', criticalJourneyId: 'support_ticket_flow', type: 'cognitive.decision' });
    expect(getTrace().create).not.toHaveBeenCalled();
    expect(existing.update).not.toHaveBeenCalled();
  });

  test('ignora silenciosamente quando runId/correlationId ausentes', async () => {
    getTrace.mockReturnValue({ findOne: jest.fn(), create: jest.fn() });
    await expect(recordCriticalEvent({ type: 'x' })).resolves.toBeNull();
  });
});
