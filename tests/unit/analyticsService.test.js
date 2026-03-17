/**
 * Testes unitários: AnalyticsService.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('AnalyticsService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('getQueueMetrics agrega tickets por fila', async () => {
    jest.doMock('../../api/services/queueService', () => ({
      listAllTickets: jest.fn(() => ({
        tickets: [
          { queue: 'fila-a', status: 'closed', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T11:00:00.000Z', messages: [{}, {}] },
          { queue: 'fila-a', status: 'waiting', createdAt: '2026-03-01T12:00:00.000Z', updatedAt: '2026-03-01T12:10:00.000Z', messages: [{}] },
        ],
      })),
      listQueues: jest.fn(() => ['fila-a', 'fila-b']),
    }));
    jest.doMock('../../api/services/authService', () => ({ listAgents: jest.fn(async () => []) }));
    jest.doMock('../../api/services/auditService', () => ({ queryLogs: jest.fn(async () => []) }));
    jest.doMock('../../api/services/departmentsService', () => ({ listDepartments: jest.fn(() => []) }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ listQueues: jest.fn(() => [{ name: 'fila-c' }]) }));
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ ChannelConversation: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/analyticsService');

    const out = svc.getQueueMetrics({ tenantId: 'tenant-1' });
    expect(Array.isArray(out)).toBe(true);

    const filaA = out.find((q) => q.queueName === 'fila-a');
    expect(filaA).toBeTruthy();
    expect(filaA.totalTickets).toBe(2);
    expect(filaA.closedTickets).toBe(1);
    expect(filaA.waitingTickets).toBe(1);
  });

  test('getQueueMetrics tolera nomes de fila hostis sem quebrar', async () => {
    const hostile = {
      toString() {
        throw new Error('boom_toString');
      },
    };

    jest.doMock('../../api/services/queueService', () => ({
      listAllTickets: jest.fn(() => ({
        tickets: [
          { queue: hostile, status: 'waiting', createdAt: '2026-03-01T10:00:00.000Z', updatedAt: '2026-03-01T11:00:00.000Z', messages: [] },
          { queue: 'safe-queue', status: 'closed', createdAt: '2026-03-01T12:00:00.000Z', updatedAt: '2026-03-01T13:00:00.000Z', messages: [{}] },
        ],
      })),
      listQueues: jest.fn(() => [hostile, 'safe-queue']),
    }));
    jest.doMock('../../api/services/authService', () => ({ listAgents: jest.fn(async () => []) }));
    jest.doMock('../../api/services/auditService', () => ({ queryLogs: jest.fn(async () => []) }));
    jest.doMock('../../api/services/departmentsService', () => ({ listDepartments: jest.fn(() => []) }));
    jest.doMock('../../api/services/queueDefinitionService', () => ({ listQueues: jest.fn(() => [{ name: hostile }, { name: 'safe-queue' }]) }));
    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({ ChannelConversation: jest.fn(() => ({})) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/analyticsService');

    const out = svc.getQueueMetrics({ tenantId: 'tenant-1' });
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((q) => q.queueName === 'safe-queue')).toBe(true);
  });
});
