'use strict';

/**
 * Coercion-guard tests for queueDefinitionService.js
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

jest.mock('../../api/db/models', () => ({
  Queue: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
  },
}));

const { getSequelize } = require('../../api/db/sequelize');
const { Queue } = require('../../api/db/models');
const {
  initialize,
  getQueueByName,
  upsertQueue,
} = require('../../api/services/queueDefinitionService');

function hostileToString() {
  const o = Object.create(null);
  Object.defineProperty(o, 'toString', {
    get() {
      throw new Error('hostile toString');
    },
  });
  Object.defineProperty(o, 'valueOf', {
    get() {
      throw new Error('hostile valueOf');
    },
  });
  return o;
}

function hostileErr() {
  const e = new Error('real');
  Object.defineProperty(e, 'message', {
    get() {
      throw new Error('hostile message getter');
    },
  });
  return e;
}

function hostileErrFull() {
  return {
    get message() {
      throw new Error('hostile message getter');
    },
    toString() {
      throw new Error('hostile toString');
    },
  };
}

describe('queueDefinitionService coercion guards', () => {
  beforeEach(() => {
    getSequelize.mockReturnValue({});
    Queue.findAll.mockReset();
    Queue.findOne.mockReset();
    Queue.create.mockReset();
  });

  test('initialize: hostile err.message does not throw', async () => {
    Queue.findAll.mockRejectedValue(hostileErr());
    await expect(initialize()).resolves.toBeUndefined();
  });

  test('initialize: hostile err.message and toString does not throw', async () => {
    Queue.findAll.mockRejectedValue(hostileErrFull());
    await expect(initialize()).resolves.toBeUndefined();
  });

  test('getQueueByName: hostile name does not throw', () => {
    expect(() => getQueueByName('tenant-1', hostileToString())).not.toThrow();
  });

  test('upsertQueue: hostile queue name does not throw and returns validation error', async () => {
    Queue.findOne.mockResolvedValue(null);
    const out = await upsertQueue({ tenantId: 'tenant-1', name: hostileToString() });
    expect(out.success).toBe(false);
    expect(typeof out.error).toBe('string');
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/queueDefinitionService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
