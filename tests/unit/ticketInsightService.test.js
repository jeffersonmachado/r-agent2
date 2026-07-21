/**
 * Testes unitários: TicketInsightService (IA-only, sem fallback heurístico).
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('TicketInsightService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('generateAiSummary propaga erro quando IA falha (sem fallback)', async () => {
    const ticket = {
      id: 't-1',
      tenantId: 'tenant-1',
      queue: 'geral',
      status: 'in_progress',
      mode: 'human',
      phoneNumber: '5511999999999',
      tags: ['cobrança'],
      context: { variables: { nome: 'João' } },
      lastUserMessage: 'Quero 2ª via',
    };
    const messages = [
      { sender: 'user', text: 'Quero 2ª via', timestamp: new Date().toISOString() },
    ];

    const updateTicket = jest.fn();

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      getTicketMessages: jest.fn(() => messages),
      updateTicket,
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn().mockRejectedValue(new Error('no api key')),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/ticketInsightService');

    await expect(svc.generateAiSummary({ ticketId: 't-1', tenantId: 'tenant-1' }))
      .rejects.toThrow('no api key');
    expect(updateTicket).not.toHaveBeenCalled();
  });

  test('generateAiSummary retorna erro quando IA retorna texto vazio', async () => {
    const ticket = { id: 't-1', tenantId: 'tenant-1', queue: 'geral', status: 'in_progress', context: { variables: {} } };
    const updateTicket = jest.fn();

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      getTicketMessages: jest.fn(() => []),
      updateTicket,
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn().mockResolvedValue({ text: '' }),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/ticketInsightService');

    const result = await svc.generateAiSummary({ ticketId: 't-1', tenantId: 'tenant-1' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('ai_summary_empty');
    expect(updateTicket).not.toHaveBeenCalled();
  });

  test('generateAiSummary usa texto do provider quando IA responde', async () => {
    const ticket = {
      id: 't-1',
      tenantId: 'tenant-1',
      queue: 'geral',
      status: 'in_progress',
      phoneNumber: '5511999999999',
      tags: [],
      context: { variables: {} },
    };
    const updateTicket = jest.fn();

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      getTicketMessages: jest.fn(() => []),
      updateTicket,
    }));
    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn().mockResolvedValue({ text: '- Resumo ok' }),
    }));

    // eslint-disable-next-line global-require
    const svc = require('../../api/services/ticketInsightService');
    const result = await svc.generateAiSummary({ ticketId: 't-1', tenantId: 'tenant-1', agent: { id: 'a-1', username: 'ana' } });
    expect(result.success).toBe(true);
    expect(result.summary.text).toBe('- Resumo ok');
  });
});

