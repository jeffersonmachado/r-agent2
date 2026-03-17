'use strict';

describe('flowExecutionLedgerService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('startFlowExecution returns tenant_id_required for hostile tenantId coercion', async () => {
    const mockFlowExecutionCreate = jest.fn();

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    jest.doMock('../../api/db/models', () => ({
      FlowExecution: () => ({
        findOne: jest.fn(),
        create: mockFlowExecutionCreate,
      }),
      NodeExecution: () => ({
        create: jest.fn(),
      }),
    }));

    const { startFlowExecution } = require('../../api/services/flowExecutionLedgerService');
    const out = await startFlowExecution({
      tenantId: { toString: () => { throw new Error('boom-tenant'); } },
      flowId: 'flow-1',
      meta: {},
    });

    expect(out).toEqual({ ok: false, error: 'tenant_id_required' });
    expect(mockFlowExecutionCreate).not.toHaveBeenCalled();
  });

  test('startFlowExecution returns flow_id_required for hostile flowId coercion', async () => {
    const mockFlowExecutionCreate = jest.fn();

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    jest.doMock('../../api/db/models', () => ({
      FlowExecution: () => ({
        findOne: jest.fn(),
        create: mockFlowExecutionCreate,
      }),
      NodeExecution: () => ({
        create: jest.fn(),
      }),
    }));

    const { startFlowExecution } = require('../../api/services/flowExecutionLedgerService');
    const out = await startFlowExecution({
      tenantId: 'tenant-1',
      flowId: { toString: () => { throw new Error('boom-flow'); } },
      meta: {},
    });

    expect(out).toEqual({ ok: false, error: 'flow_id_required' });
    expect(mockFlowExecutionCreate).not.toHaveBeenCalled();
  });

  test('appendNodeExecution tolerates hostile coercions in optional fields', async () => {
    const mockNodeCreate = jest.fn().mockResolvedValue({ id: 'nx-1' });

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));
    jest.doMock('../../api/db/models', () => ({
      FlowExecution: () => ({
        findOne: jest.fn(),
        create: jest.fn(),
      }),
      NodeExecution: () => ({
        create: mockNodeCreate,
      }),
    }));

    const { appendNodeExecution } = require('../../api/services/flowExecutionLedgerService');
    const out = await appendNodeExecution({
      tenantId: 'tenant-1',
      executionId: 'fx-1',
      nodeId: { toString: () => { throw new Error('boom-node'); } },
      status: { toString: () => { throw new Error('boom-status'); } },
      errorMessage: { toString: () => { throw new Error('boom-error'); } },
    });

    expect(out).toEqual({ ok: true, nodeExecutionId: 'nx-1' });
    expect(mockNodeCreate).toHaveBeenCalledTimes(1);
    expect(mockNodeCreate.mock.calls[0][0]).toMatchObject({
      tenant_key: 'tenant-1',
      execution_id: 'fx-1',
      status: 'ok',
      node_id: '',
      error_message: '',
    });
  });
});
