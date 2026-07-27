/**
 * Regressão: exportService deve aguardar getAllMetrics (async).
 *
 * Falha observada em produção local (2026-07-27):
 *   GET /export/metrics.csv     -> 500 "Cannot read properties of undefined (reading 'totalTickets')"
 *   GET /export/full-report.json -> 500 (mesma causa)
 *
 * Causa raiz: analyticsService.getAllMetrics é async, mas exportMetricsCSV
 * e exportFullReportJSON liam `metrics.general` sobre a Promise sem await.
 * O mock síncrono do teste de tenant isolation escondia o bug — este teste
 * usa mock async, fiel ao comportamento real do analyticsService.
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const METRICS = {
  general: {
    totalTickets: 3,
    openTickets: 1,
    closedTickets: 2,
    avgResolutionTime: 42,
    avgFirstResponseTime: 5,
    totalMessages: 10,
  },
  agents: [{ agentName: 'Agente QA', totalTickets: 3, closedTickets: 2, openTickets: 1, totalMessages: 10, avgResolutionTime: 42 }],
  departments: [{ departmentName: 'Dept QA', totalTickets: 3, closedTickets: 2, openTickets: 1, totalMessages: 10, avgResolutionTime: 42 }],
  queues: [{ queueName: 'support', totalTickets: 3, closedTickets: 2, openTickets: 1, totalMessages: 10, avgResolutionTime: 42 }],
  trends: {},
  timestamp: '2026-07-27T00:00:00.000Z',
};

describe('exportService (métricas async)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.doMock('../../api/services/queueService', () => ({
      listAllTickets: jest.fn(() => ({ tickets: [] })),
    }));
    jest.doMock('../../api/services/authService', () => ({ listAgents: jest.fn(() => []) }));
    jest.doMock('../../api/services/auditService', () => ({ queryLogs: jest.fn(async () => ({ items: [] })) }));
    // Mock fiel à assinatura real: getAllMetrics é async.
    jest.doMock('../../api/services/analyticsService', () => ({
      getAllMetrics: jest.fn(async () => METRICS),
    }));
  });

  test('exportMetricsCSV aguarda getAllMetrics e inclui métricas gerais', async () => {
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/exportService');
    const csv = await svc.exportMetricsCSV({ tenantId: 't-123' });

    expect(typeof csv).toBe('string');
    expect(csv).toContain('MÉTRICAS GERAIS');
    expect(csv).toContain('Total de Tickets,3');
    expect(csv).toContain('Agente QA');
    expect(csv).toContain('Dept QA');
    expect(csv).toContain('support');
  });

  test('exportFullReportJSON aguarda getAllMetrics e monta summary', async () => {
    // eslint-disable-next-line global-require
    const svc = require('../../api/services/exportService');
    const report = await svc.exportFullReportJSON({ tenantId: 't-123' });

    expect(report.summary).toEqual({
      totalTickets: 3,
      openTickets: 1,
      closedTickets: 2,
      avgResolutionTime: 42,
      avgFirstResponseTime: 5,
      totalMessages: 10,
    });
    expect(report.metrics.general.totalTickets).toBe(3);
    expect(Array.isArray(report.conversations)).toBe(true);
  });
});
