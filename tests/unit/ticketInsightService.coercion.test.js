'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('ticketInsightService coercion hardening (IA-only, sem fallback)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('generateAiSummary: propaga erro com hostile error.message getter (sem fallback)', async () => {
    const ticket = { id: 't-1', tenantId: 'tenant-1', queue: 'geral', status: 'in_progress', context: { variables: {} } };

    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      getTicketMessages: jest.fn(() => []),
      updateTicket: jest.fn(),
    }));

    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/services/aiProviderService', () => ({
      generateAiResponse: jest.fn().mockRejectedValue(hostileError),
    }));

    const svc = require('../../api/services/ticketInsightService');

    // Erro propaga naturalmente — sem try/catch no serviço
    await expect(svc.generateAiSummary({ ticketId: 't-1', tenantId: 'tenant-1' }))
      .rejects.toBe(hostileError);
  });

  test('static guard: no heuristic fallback or safeErrorMessage helper in source', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/ticketInsightService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    expect(source).not.toMatch(/heuristicSummary/);
    expect(source).not.toMatch(/fallbacks\.ticketInsightHeuristic/);
    expect(source).not.toMatch(/safeErrorMessage/);
    expect(source).not.toMatch(/config\.get/);
  });
});
