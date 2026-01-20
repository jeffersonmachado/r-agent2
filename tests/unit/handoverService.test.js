/**
 * Testes unitários do HandoverService (Fase 2)
 */

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('handoverService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('takeOver muda ticket.mode para human (idempotente) e emite evento', async () => {
    const ticket = { id: 't1', tenantId: 'tenant-1', mode: 'bot', assignedTo: 'a1' };
    const updatedTicket = { ...ticket, mode: 'human', pauseReason: 'agent_takeover', context: { handoverHistory: [] }, messages: [] };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      setTicketMode: jest.fn(() => updatedTicket),
    }));
    const emitEvent = jest.fn();
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent }));

    // eslint-disable-next-line global-require
    const { takeOver } = require('../../api/services/handoverService');

    const res = await takeOver('t1', { id: 'a1', username: 'agent1' }, 'agent_takeover');
    expect(res.success).toBe(true);
    expect(res.ticket.mode).toBe('human');
    expect(emitEvent).toHaveBeenCalled();
  });

  test('returnToBot muda ticket.mode para bot (idempotente) e emite evento', async () => {
    const ticket = { id: 't1', tenantId: 'tenant-1', mode: 'human', assignedTo: 'a1' };
    const updatedTicket = { ...ticket, mode: 'bot', pauseReason: 'user_request', context: { handoverHistory: [] }, messages: [] };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      setTicketMode: jest.fn(() => updatedTicket),
    }));
    const emitEvent = jest.fn();
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent }));

    // eslint-disable-next-line global-require
    const { returnToBot } = require('../../api/services/handoverService');

    const res = await returnToBot('t1', { id: 'a1', username: 'agent1' }, 'user_request');
    expect(res.success).toBe(true);
    expect(res.ticket.mode).toBe('bot');
    expect(emitEvent).toHaveBeenCalled();
  });

  test('setPaused muda ticket.mode para paused (idempotente) e emite evento', async () => {
    const ticket = { id: 't1', tenantId: 'tenant-1', mode: 'bot', assignedTo: 'a1' };
    const updatedTicket = { ...ticket, mode: 'paused', pauseReason: 'outside_window', context: { handoverHistory: [] }, messages: [] };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
    jest.doMock('../../api/db/models', () => ({}));
    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      setTicketMode: jest.fn(() => updatedTicket),
    }));
    const emitEvent = jest.fn();
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent }));

    // eslint-disable-next-line global-require
    const { setPaused } = require('../../api/services/handoverService');

    const res = await setPaused('t1', { id: 'a1', username: 'agent1' }, 'outside_window');
    expect(res.success).toBe(true);
    expect(res.ticket.mode).toBe('paused');
    expect(emitEvent).toHaveBeenCalled();
  });
});

