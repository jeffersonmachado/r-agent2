/**
 * ExportService - isolamento multi-tenant (verifica que passa tenantId para listagens)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('exportService (tenant isolation)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('exportTicketsCSV usa listAllTickets({ tenantId })', () => {
    const listAllTickets = jest.fn(() => ({ tickets: [] }));
    jest.doMock('../../api/services/queueService', () => ({
      listAllTickets,
    }));
    jest.doMock('../../api/services/authService', () => ({ listAgents: jest.fn(() => []) }));
    jest.doMock('../../api/services/auditService', () => ({ queryLogs: jest.fn(async () => ({ items: [] })) }));
    jest.doMock('../../api/services/analyticsService', () => ({ getAllMetrics: jest.fn(() => ({ general: { totalTickets: 0, openTickets: 0, closedTickets: 0, avgResolutionTime: 0, avgFirstResponseTime: 0, totalMessages: 0 }, agents: [], departments: [], queues: [] })) }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/exportService');
    svc.exportTicketsCSV({ tenantId: 't-123' });

    expect(listAllTickets).toHaveBeenCalledWith({ tenantId: 't-123' });
  });
});

