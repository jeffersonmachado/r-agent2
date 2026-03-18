'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ticketInsightService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('generateAiSummary: fallback disabled does not crash with hostile error.message getter', async () => {
    const ticket = { id: 't-1', tenantId: 'tenant-1', queue: 'geral', status: 'in_progress', context: { variables: {} } };

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      getTicketMessages: jest.fn(() => []),
      updateTicket: jest.fn(),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn().mockRejectedValue({
        get message() {
          throw new Error('poisoned message getter');
        },
        toString() {
          throw new Error('poisoned toString');
        },
      }),
    }));

    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((_path, defaultValue) => defaultValue),
    }));

    const svc = require('../../api/services/ticketInsightService');
    const result = await svc.generateAiSummary({ ticketId: 't-1', tenantId: 'tenant-1', agent: { id: 'a-1', username: 'ana' } });

    expect(result).toEqual(expect.objectContaining({
      success: false,
      error: 'ai_summary_failed',
      message: 'Erro ao gerar resumo por IA',
    }));
  });

  test('generateAiSummary: fallback enabled still returns heuristic summary with hostile error.message getter', async () => {
    const ticket = {
      id: 't-1',
      tenantId: 'tenant-1',
      queue: 'geral',
      status: 'in_progress',
      context: { variables: { nome: 'Joao' } },
      lastUserMessage: 'Preciso de ajuda',
      tags: ['urgente'],
    };

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      getTicketMessages: jest.fn(() => []),
      updateTicket: jest.fn(),
    }));

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn().mockRejectedValue({
        get message() {
          throw new Error('poisoned message getter');
        },
        toString() {
          throw new Error('poisoned toString');
        },
      }),
    }));

    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn((key, defaultValue) => {
        if (key === 'fallbacks.ticketInsightHeuristic') return true;
        return defaultValue;
      }),
    }));

    const svc = require('../../api/services/ticketInsightService');
    const result = await svc.generateAiSummary({ ticketId: 't-1', tenantId: 'tenant-1', agent: { id: 'a-1', username: 'ana' } });

    expect(result.success).toBe(true);
    expect(result.summary.text).toContain('Última mensagem');
  });

  test('static guard: no direct err/error.message outside safeErrorMessage helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ticketInsightService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
