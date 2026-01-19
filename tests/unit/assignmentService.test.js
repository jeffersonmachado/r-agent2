/**
 * Testes unitários do AssignmentService (Fase 3)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('assignmentService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('autoAssign não atribui quando estratégia é manual', async () => {
    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ({ id: 't1', tenantId: 'tenant-1', queue: 'suporte', status: 'waiting', assignedTo: null })),
      assignTicket: jest.fn(),
      listAllTickets: jest.fn(() => ({ tickets: [] })),
    }));
    jest.doMock('../../api/services/authService', () => ({
      listAgents: jest.fn(async () => [{ id: 'a1', tenantId: 'tenant-1', role: 'operator', active: true, status: 'active' }]),
    }));
    jest.doMock('../../api/services/departmentsService', () => ({
      listDepartments: jest.fn(() => []),
      getDepartment: jest.fn(() => null),
    }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({
      getQueueByName: jest.fn(() => ({ routingStrategy: 'manual' })),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      getOnlineAgentsByTenant: jest.fn(() => []),
      isAgentOnline: jest.fn(() => false),
      emitEvent: jest.fn(),
    }));
    jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks: jest.fn(() => Promise.resolve()) }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));

    // eslint-disable-next-line global-require
    const { autoAssign } = require('../../api/services/assignmentService');
    const res = await autoAssign('t1');
    expect(res.success).toBe(true);
    expect(res.skipped).toBe('manual');
  });

  test('autoAssign round_robin escolhe agentes em sequência', async () => {
    const getTicket = jest.fn(() => ({ id: 't1', tenantId: 'tenant-1', queue: 'suporte', status: 'waiting', assignedTo: null }));
    const assignTicket = jest.fn((id, assignedTo) => ({ id, tenantId: 'tenant-1', queue: 'suporte', status: 'in_progress', assignedTo }));

    jest.doMock('../../api/services/queueService', () => ({
      getTicket,
      assignTicket,
      listAllTickets: jest.fn(() => ({ tickets: [] })),
    }));
    jest.doMock('../../api/services/authService', () => ({
      listAgents: jest.fn(async () => ([
        { id: 'a1', tenantId: 'tenant-1', role: 'operator', active: true, status: 'active' },
        { id: 'a2', tenantId: 'tenant-1', role: 'operator', active: true, status: 'active' },
      ])),
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

    // eslint-disable-next-line global-require
    const { autoAssign } = require('../../api/services/assignmentService');

    const first = await autoAssign('t1');
    expect(first.assignedTo).toBe('a1');

    // Próximo ticket simulado
    getTicket.mockReturnValueOnce({ id: 't2', tenantId: 'tenant-1', queue: 'suporte', status: 'waiting', assignedTo: null });
    const second = await autoAssign('t2');
    expect(second.assignedTo).toBe('a2');
  });

  test('autoAssign least_busy escolhe agente com menos in_progress', async () => {
    const getTicket = jest.fn(() => ({ id: 't1', tenantId: 'tenant-1', queue: 'suporte', status: 'waiting', assignedTo: null }));
    const assignTicket = jest.fn((id, assignedTo) => ({ id, tenantId: 'tenant-1', queue: 'suporte', status: 'in_progress', assignedTo }));

    jest.doMock('../../api/services/queueService', () => ({
      getTicket,
      assignTicket,
      listAllTickets: jest.fn(() => ({
        tickets: [
          { id: 'x1', tenantId: 'tenant-1', status: 'in_progress', assignedTo: 'a1' },
          { id: 'x2', tenantId: 'tenant-1', status: 'in_progress', assignedTo: 'a1' },
        ],
      })),
    }));
    jest.doMock('../../api/services/authService', () => ({
      listAgents: jest.fn(async () => ([
        { id: 'a1', tenantId: 'tenant-1', role: 'operator', active: true, status: 'active' },
        { id: 'a2', tenantId: 'tenant-1', role: 'operator', active: true, status: 'active' },
      ])),
    }));
    jest.doMock('../../api/services/departmentsService', () => ({
      listDepartments: jest.fn(() => []),
      getDepartment: jest.fn(() => null),
    }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({
      getQueueByName: jest.fn(() => ({ routingStrategy: 'least_busy' })),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      getOnlineAgentsByTenant: jest.fn(() => []),
      isAgentOnline: jest.fn(() => false),
      emitEvent: jest.fn(),
    }));
    jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks: jest.fn(() => Promise.resolve()) }));
    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));

    // eslint-disable-next-line global-require
    const { autoAssign } = require('../../api/services/assignmentService');

    const res = await autoAssign('t1');
    expect(res.assignedTo).toBe('a2');
  });
});

