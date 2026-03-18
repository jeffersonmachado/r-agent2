'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => null) }));

jest.mock('../../api/db/models', () => ({
  PhysicalQueue: jest.fn(() => ({
    findOne: jest.fn(() => null),
    findAll: jest.fn(() => []),
    create: jest.fn(async (data) => ({ ...data, toJSON: () => data, id: 'test-id' })),
  })),
  PhysicalTicket: jest.fn(() => ({
    findOne: jest.fn(() => null),
    create: jest.fn(async (data) => ({ ...data, toJSON: () => data, id: 'test-id' })),
  })),
  PhysicalTicketSequence: jest.fn(() => ({
    findOne: jest.fn(() => null),
    create: jest.fn(async (data) => ({ ...data, toJSON: () => data })),
    sequelize: null, // Disable DB for these tests
  })),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(() => Promise.resolve()),
}));

describe('physicalQueueService coercion hardening', () => {
  let physicalQueueService;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    physicalQueueService = require('../../api/services/physicalQueueService');
  });

  test('createTicket handles normal inputs correctly', async () => {
    const result = await physicalQueueService.createTicket({
      tenantId: 'tenant-123',
      queueId: 'queue-456',
      priority: 0,
      context: {},
    });

    expect(result).toBeTruthy();
    expect(result.tenant_key).toBe('tenant-123');
  });

  test('createTicket with hostile context idempotencyKey is safely coerced', async () => {
    const result = await physicalQueueService.createTicket({
      tenantId: 'tenant-123',
      queueId: 'queue-456',
      priority: 0,
      context: {
        idempotencyKey: {
          toString: () => {
            throw new Error('boom-idempotency');
          },
        },
      },
    });

    // Should not crash; hostile object is coerced safely
    expect(result).toBeTruthy();
  });

  test('listQueues handles normal filters', async () => {
    const result = await physicalQueueService.listQueues({
      tenantId: 'tenant-123',
    });

    expect(Array.isArray(result)).toBe(true);
  });

  test('listQueues with hostile status parameter is safely coerced', async () => {
    const result = await physicalQueueService.listQueues({
      tenantId: 'tenant-123',
      status: {
        toString: () => {
          throw new Error('boom-status');
        },
      },
    });

    // Should not crash; hostile status is coerced safely
    expect(Array.isArray(result)).toBe(true);
  });

  test('upsertQueue handles normal inputs', async () => {
    const result = await physicalQueueService.upsertQueue({
      tenantId: 'tenant-123',
      name: 'Test Queue',
    });

    expect(result).toBeTruthy();
    expect(result.name).toBe('Test Queue');
  });

  test('upsertQueue with hostile status is safely coerced', async () => {
    const result = await physicalQueueService.upsertQueue({
      tenantId: 'tenant-123',
      name: 'Test Queue',
      status: {
        toString: () => {
          throw new Error('boom-status');
        },
      },
    });

    // Should not crash; hostile status is coerced safely
    expect(result).toBeTruthy();
  });
});
