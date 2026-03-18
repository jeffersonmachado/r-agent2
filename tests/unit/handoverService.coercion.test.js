'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('handoverService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('takeOver: hostile err.message in ticket_event persistence catch does not throw', async () => {
    const ticket = { id: 't1', tenantId: 'tenant-1', mode: 'bot', assignedTo: 'a1', conversationId: 'c1' };
    const updatedTicket = { ...ticket, mode: 'human', pauseReason: 'agent_takeover', context: { handoverHistory: [] }, messages: [] };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: () => ({
        findOne: jest.fn(async () => null),
      }),
      TicketEvent: () => ({
        create: jest.fn(async () => {
          throw {
            get message() {
              throw new Error('poisoned message getter');
            },
            toString() {
              throw new Error('poisoned toString');
            },
          };
        }),
      }),
    }));

    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      setTicketMode: jest.fn(() => updatedTicket),
    }));
    jest.doMock('../../api/services/assignmentService', () => ({ autoAssign: jest.fn(() => Promise.resolve()) }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));

    const { takeOver } = require('../../api/services/handoverService');
    const result = await takeOver('t1', { id: 'a1', username: 'agent1' }, 'agent_takeover');

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(result.ticket.mode).toBe('human');
  });

  test('returnToBot: hostile err.message in conversation status catch does not throw', async () => {
    const ticket = { id: 't1', tenantId: 'tenant-1', mode: 'human', assignedTo: 'a1', conversationId: 'c1' };
    const updatedTicket = { ...ticket, mode: 'bot', pauseReason: 'user_request', context: { handoverHistory: [] }, messages: [] };

    jest.doMock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
    jest.doMock('../../api/db/models', () => ({
      ChannelConversation: () => ({
        findOne: jest.fn(async () => {
          throw {
            get message() {
              throw new Error('poisoned message getter');
            },
            toString() {
              throw new Error('poisoned toString');
            },
          };
        }),
      }),
      TicketEvent: () => ({ create: jest.fn(async () => null) }),
    }));

    jest.doMock('../../api/services/auditService', () => ({ logAction: jest.fn() }));
    jest.doMock('../../api/services/queueService', () => ({
      getTicket: jest.fn(() => ticket),
      setTicketMode: jest.fn(() => updatedTicket),
    }));
    jest.doMock('../../api/services/assignmentService', () => ({ autoAssign: jest.fn(() => Promise.resolve()) }));
    jest.doMock('../../api/services/websocketService', () => ({ emitEvent: jest.fn() }));

    const { returnToBot } = require('../../api/services/handoverService');
    const result = await returnToBot('t1', { id: 'a1', username: 'agent1' }, 'user_request');

    expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(result.ticket.mode).toBe('bot');
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/handoverService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
