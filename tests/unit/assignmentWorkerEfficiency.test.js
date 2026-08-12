/**
 * Regressão: o ciclo do assignment worker não pode re-escanear a base inteira
 * de tickets por tenant (O(tenants × tickets) a cada 15s satura o event loop
 * da API — observado em produção local: ~174 listAllTickets/s contínuos e
 * requests HTTP falhando em nível de rede durante waves RPA).
 *
 * Também garante proteção de reentrância: um ciclo ainda em andamento não
 * pode ser sobreposto pelo próximo tick do setInterval.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

function buildMocks({ tickets, isOnline = () => false }) {
  jest.doMock('../../api/services/queueService', () => ({
    getTicket: jest.fn((id) => tickets.find((t) => t.id === id) || null),
    assignTicket: jest.fn((id, assignedTo) => ({ ...tickets.find((t) => t.id === id), assignedTo, status: 'in_progress' })),
    listAllTickets: jest.fn((options = {}) => {
      let list = tickets;
      if (options.tenantId) list = list.filter((t) => t.tenantId === options.tenantId);
      if (options.status) list = list.filter((t) => t.status === options.status);
      return { tickets: list };
    }),
  }));
  jest.doMock('../../api/services/authService', () => ({
    listAgents: jest.fn(async (tenantId) => ([
      { id: `a-${tenantId}`, tenantId, role: 'operator', active: true, status: 'active' },
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
    isAgentOnline: jest.fn(isOnline),
    emitEvent: jest.fn(),
  }));
  jest.doMock('../../api/services/webhookService', () => ({ triggerWebhooks: jest.fn(() => Promise.resolve()) }));
  jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
}

describe('assignmentService worker efficiency', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('um ciclo do worker faz uma única varredura de tickets (não uma por tenant)', async () => {
    // 5 tenants com tickets; apenas 2 com in_progress atribuído
    const tickets = [];
    for (let i = 0; i < 5; i += 1) {
      tickets.push({ id: `w${i}`, tenantId: `tenant-${i}`, queue: 'suporte', status: 'waiting', assignedTo: null });
    }
    tickets.push({ id: 'p0', tenantId: 'tenant-0', queue: 'suporte', status: 'in_progress', assignedTo: 'off-0' });
    tickets.push({ id: 'p1', tenantId: 'tenant-1', queue: 'suporte', status: 'in_progress', assignedTo: 'off-1' });

    buildMocks({ tickets });

    // eslint-disable-next-line global-require
    const queueService = require('../../api/services/queueService');
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/assignmentService');

    expect(typeof svc._internal?.runAssignmentCycle).toBe('function');
    await svc._internal.runAssignmentCycle();

    // Antes da correção: 1 varredura geral + 1 por tenant (6 chamadas aqui;
    // em produção ~171 por ciclo com ~170 tenants). Depois: 1 varredura.
    expect(queueService.listAllTickets.mock.calls.length).toBe(1);
  });

  test('ciclo sobreposto é ignorado (guarda de reentrância)', async () => {
    const tickets = [
      { id: 'p0', tenantId: 'tenant-0', queue: 'suporte', status: 'in_progress', assignedTo: 'off-0' },
    ];
    buildMocks({ tickets });

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/assignmentService');

    // Trava a resolução de candidatos para manter o primeiro ciclo em voo
    let release;
    // eslint-disable-next-line global-require
    const authService = require('../../api/services/authService');
    authService.listAgents.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));

    const first = svc._internal.runAssignmentCycle();
    const second = await svc._internal.runAssignmentCycle();
    expect(second).toEqual(expect.objectContaining({ skipped: 'cycle_in_progress' }));

    release([]);
    await first;
  });
});
