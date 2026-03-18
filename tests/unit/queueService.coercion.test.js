'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));
jest.mock('../../api/db/models', () => ({}));

describe('queueService coercion hardening', () => {
  let queueService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    queueService = require('../../api/services/queueService');
  });

  test('createTicket tolerates hostile sessionId in channelType detection', () => {
    const hostileSessionId = {
      toString: () => {
        throw new Error('boom-sessionId');
      },
    };

    const ticket = queueService.createTicket({
      tenantId: 'tenant-123',
      sessionId: hostileSessionId,
      queue: 'support',
      context: {},
    });

    // Should not crash; channelType falls back to null since safeToString catches the error
    expect(ticket.id).toBeTruthy();
    expect(ticket.sessionId).toBe(hostileSessionId);
    expect(ticket.channelType).toBe(null); // hostile sessionId fallback
  });

  test('listAllTickets tolerates hostile status query parameter', () => {
    // Create a couple of normal tickets
    queueService.createTicket({
      tenantId: 'tenant-123',
      sessionId: 'session-1',
      queue: 'support',
      context: {},
    });

    const hostileStatus = {
      toString: () => {
        throw new Error('boom-status');
      },
      toLowerCase: () => {
        throw new Error('boom-toLowerCase');
      },
    };

    // Query with hostile status parameter - should be safely coerced to string
    // safeTrimLower will handle the hostile object and fallback to empty string
    const results = queueService.listAllTickets({
      tenantId: 'tenant-123',
      status: hostileStatus,
    });

    // Should not crash; returns object with pagination info
    expect(results).toBeTruthy();
    expect(results.items).toBeTruthy();
    expect(Array.isArray(results.items)).toBe(true);
  });

  test('listAllTickets tolerates hostile search query parameter', () => {
    // Create a ticket
    queueService.createTicket({
      tenantId: 'tenant-123',
      sessionId: 'session-search',
      queue: 'support',
      context: {},
    });

    const hostileQuery = {
      toString: () => {
        throw new Error('boom-query');
      },
      toLowerCase: () => {
        throw new Error('boom-toLowerCase');
      },
    };

    // Query with hostile search string - should be safely coerced
    const results = queueService.listAllTickets({
      tenantId: 'tenant-123',
      q: hostileQuery,
    });

    // Should not crash; returns paginated results object safely
    expect(results).toBeTruthy();
    expect(results.items).toBeTruthy();
    expect(Array.isArray(results.items)).toBe(true);
  });

  test('listAllTickets search handles normal string queries correctly', () => {
    // Create a ticket with known values
    queueService.createTicket({
      tenantId: 'tenant-123',
      sessionId: 'session-123',
      queue: 'support',
      context: {},
    });

    // Normal search query should work
    const results = queueService.listAllTickets({
      tenantId: 'tenant-123',
      q: 'session',
    });

    expect(results).toBeTruthy();
    expect(Array.isArray(results.items)).toBe(true);
  });

  test('listAllTickets status filter handles normal status values', () => {
    // Create tickets
    const ticket1 = queueService.createTicket({
      tenantId: 'tenant-123',
      sessionId: 'session-1',
      queue: 'support',
      context: {},
    });

    // Normal status filter should work
    const results = queueService.listAllTickets({
      tenantId: 'tenant-123',
      status: 'waiting',
    });

    expect(results).toBeTruthy();
    expect(Array.isArray(results.items)).toBe(true);
    expect(results.items.length).toBeGreaterThan(0);
  });
});
