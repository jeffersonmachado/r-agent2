'use strict';

describe('flowExecutionLedgerService.startFlowExecution event idempotency', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('reuses only same eventId when mode=event and correlationId is shared', async () => {
    const mockFlowExecutionFindOne = jest.fn();
    const mockFlowExecutionCreate = jest.fn();
    const mockSequelizeQuery = jest.fn().mockResolvedValue([[{ id: 'fx-existing' }]]);

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query: mockSequelizeQuery })),
    }));
    jest.doMock('../../api/db/models', () => ({
      FlowExecution: () => ({
        findOne: mockFlowExecutionFindOne,
        create: mockFlowExecutionCreate,
      }),
      NodeExecution: () => ({
        create: jest.fn(),
      }),
    }));

    const { startFlowExecution } = require('../../api/services/flowExecutionLedgerService');
    const out = await startFlowExecution({
      tenantId: 'tenant-1',
      flowId: 'flow-1',
      correlationId: 'linkedid-123',
      subjectType: 'pbx_call',
      subjectId: 'linkedid-123',
      meta: {
        mode: 'event',
        eventId: 'ev-1',
        eventType: 'CallRinging',
      },
    });

    expect(out).toEqual({ ok: true, executionId: 'fx-existing', reused: true });
    expect(mockFlowExecutionFindOne).not.toHaveBeenCalled();
    expect(mockFlowExecutionCreate).not.toHaveBeenCalled();
  });

  test('creates new execution for different eventId under same correlation', async () => {
    const mockFlowExecutionFindOne = jest.fn();
    const mockFlowExecutionCreate = jest.fn().mockResolvedValue({ id: 'fx-new' });
    const mockSequelizeQuery = jest.fn().mockResolvedValue([[]]);

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({ query: mockSequelizeQuery })),
    }));
    jest.doMock('../../api/db/models', () => ({
      FlowExecution: () => ({
        findOne: mockFlowExecutionFindOne,
        create: mockFlowExecutionCreate,
      }),
      NodeExecution: () => ({
        create: jest.fn(),
      }),
    }));

    const { startFlowExecution } = require('../../api/services/flowExecutionLedgerService');
    const out = await startFlowExecution({
      tenantId: 'tenant-1',
      flowId: 'flow-1',
      correlationId: 'linkedid-123',
      subjectType: 'pbx_call',
      subjectId: 'linkedid-123',
      meta: {
        mode: 'event',
        eventId: 'ev-2',
        eventType: 'CallAnswered',
      },
    });

    expect(out.ok).toBe(true);
    expect(out.reused).toBeUndefined();
    expect(out.executionId).toBe('fx-new');
    expect(mockFlowExecutionCreate).toHaveBeenCalledTimes(1);
    expect(mockFlowExecutionCreate.mock.calls[0][0].meta).toMatchObject({
      mode: 'event',
      eventId: 'ev-2',
      eventType: 'CallAnswered',
    });
  });
});

