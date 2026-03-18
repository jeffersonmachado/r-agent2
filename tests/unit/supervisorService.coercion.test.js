'use strict';

/**
 * Coercion-guard tests for supervisorService.js
 * Verifies hostile toString() on ids/queues don't crash the service.
 */

jest.mock('../../api/services/queueService', () => ({
  listAllTickets: jest.fn(() => ({ tickets: [] })),
  listQueues: jest.fn(() => []),
}));
jest.mock('../../api/services/authService', () => ({ listAgents: jest.fn(async () => []) }));
jest.mock('../../api/services/queueDefinitionService', () => ({
  listQueues: jest.fn(() => []),
}));
jest.mock('../../api/services/websocketService', () => ({
  getConnectedAgentsByTenant: jest.fn(() => new Map()),
}));

const { getSupervisorQueueStatus } = require('../../api/services/supervisorService');
const { listAllTickets, listQueues } = require('../../api/services/queueService');

const hostileToString = () => {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', { get() { throw new Error('hostile toString'); } });
  Object.defineProperty(o, 'valueOf', { get() { throw new Error('hostile valueOf'); } });
  return o;
};

describe('supervisorService – coercion guards', () => {
  beforeEach(() => jest.clearAllMocks());

  test('getSupervisorQueueStatus: hostile ticket.assignedTo does not throw', () => {
    listAllTickets.mockReturnValue({
      tickets: [
        { queue: 'q1', assignedTo: hostileToString(), status: 'waiting' },
        { queue: 'q1', status: 'in_progress' },
      ],
    });
    expect(() => getSupervisorQueueStatus({ tenantId: 't1' })).not.toThrow();
  });

  test('getSupervisorQueueStatus: hostile ticket.queue does not throw', () => {
    listAllTickets.mockReturnValue({
      tickets: [{ queue: hostileToString(), status: 'waiting' }],
    });
    expect(() => getSupervisorQueueStatus({ tenantId: 't1' })).not.toThrow();
  });

  test('getSupervisorQueueStatus: hostile queue from listQueues does not throw', () => {
    listAllTickets.mockReturnValue({ tickets: [] });
    listQueues.mockReturnValue([hostileToString(), hostileToString()]);
    expect(() => getSupervisorQueueStatus({ tenantId: 't1' })).not.toThrow();
  });
});
