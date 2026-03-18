'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('assignmentService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('autoAssign tolerates hostile err.message getter in DB cursor fallback', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    const tx = jest.fn(async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }));
    const Model = {
      sequelize: { transaction: tx, constructor: { Op: {} } },
      findOne: jest.fn(async () => {
        throw hostileError;
      }),
      create: jest.fn(),
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      QueueAssignmentState: () => Model,
    }));

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ({ id: 't1', tenantId: 'tenant-1', queue: 'suporte', status: 'waiting', assignedTo: null })),
      assignTicket: jest.fn((id, assignedTo) => ({ id, tenantId: 'tenant-1', queue: 'suporte', status: 'in_progress', assignedTo })),
      listAllTickets: jest.fn(() => ({ tickets: [] })),
    }));

    jest.doMock('../../api/services/authService', () => ({
      listAgents: jest.fn(async () => [
        { id: 'a1', role: 'operator', active: true, status: 'active' },
      ]),
    }));

    jest.doMock('../../api/services/departmentsService', () => ({
      listDepartments: jest.fn(() => []),
      getDepartment: jest.fn(() => null),
    }));

    jest.doMock('../../api/services/queueDefinitionService', () => ({
      getQueueByName: jest.fn(() => ({ routingStrategy: 'round_robin' })),
    }));

    jest.doMock('../../api/services/websocketService', () => ({
      getOnlineAgentsByTenant: jest.fn(() => []),
      isAgentOnline: jest.fn(() => false),
      emitEvent: jest.fn(),
    }));

    jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks: jest.fn(() => Promise.resolve()) }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));

    const logger = require('../../api/utils/logger');
    const { autoAssign } = require('../../api/services/assignmentService');

    const res = await autoAssign('t1');

    expect(res.success).toBe(true);
    expect(res.assignedTo).toBe('a1');
    expect(logger.debug).toHaveBeenCalledWith(
      '[Assignment] Falha ao obter cursor RR do DB (fallback para memória)',
      expect.objectContaining({ tenantId: 'tenant-1', queueName: 'suporte', error: '' })
    );
  });

  test('assignment worker catches hostile err.message getter without throwing', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ QueueAssignmentState: jest.fn() }));

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(),
      assignTicket: jest.fn(),
      listAllTickets: jest.fn(() => {
        throw hostileError;
      }),
    }));

    jest.doMock('../../api/services/authService', () => ({ listAgents: jest.fn(async () => []) }));
    jest.doMock('../../api/services/departmentsService', () => ({ listDepartments: jest.fn(() => []), getDepartment: jest.fn(() => null) }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ getQueueByName: jest.fn(() => ({ routingStrategy: 'manual' })) }));
    jest.doMock('../../api/services/websocketService', () => ({
      getOnlineAgentsByTenant: jest.fn(() => []),
      isAgentOnline: jest.fn(() => false),
      emitEvent: jest.fn(),
    }));
    jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks: jest.fn(() => Promise.resolve()) }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));

    const logger = require('../../api/utils/logger');
    const { startAssignmentWorker, stopAssignmentWorker } = require('../../api/services/assignmentService');

    expect(() => {
      startAssignmentWorker({ intervalMs: 10 });
    }).not.toThrow();

    await jest.advanceTimersByTimeAsync(10);
    stopAssignmentWorker();

    expect(logger.debug).toHaveBeenCalledWith(
      '[Assignment] worker erro (ignorado)',
      { error: '' }
    );
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/assignmentService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
