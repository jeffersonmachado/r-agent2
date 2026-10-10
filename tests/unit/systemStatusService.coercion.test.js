'use strict';

/**
 * Coercion-guard tests for systemStatusService.js
 */

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../api/utils/config', () => ({
  get: jest.fn(),
}));

jest.mock('../../infra/redis/rateLimitClient', () => ({
  isRedisAvailable: jest.fn(),
  getRateLimitClient: jest.fn(),
}));

jest.mock('../../api/services/ragService', () => ({
  getRagHealth: jest.fn(),
  getRagServiceUrl: jest.fn(),
}));

jest.mock('../../api/services/websocketService', () => ({
  getWebSocketServer: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => null),
}));

jest.mock('../../api/db/models', () => ({
  RagDocument: { count: jest.fn() },
}));

const config = require('../../api/utils/config');
const { isRedisAvailable } = require('../../infra/redis/rateLimitClient');
const { getRagHealth } = require('../../api/services/ragService');
const { getWebSocketServer } = require('../../api/services/websocketService');
const {
  checkRedisStatus,
  checkRagServiceStatus,
  checkWebSocketStatus,
  checkApiServerStatus,
} = require('../../api/services/systemStatusService');

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

describe('systemStatusService coercion guards', () => {
  beforeEach(() => {
    config.get.mockImplementation((key, fallback) => fallback);
    isRedisAvailable.mockReset();
    getRagHealth.mockReset();
    getWebSocketServer.mockReset();
  });

  test('checkRedisStatus: hostile err.message in catch does not throw', async () => {
    config.get.mockImplementation((key, fallback) => (key === 'rateLimit.redis.url' ? 'redis://test:6379' : fallback));
    isRedisAvailable.mockRejectedValue(hostileErr());
    const out = await checkRedisStatus();
    expect(out.status).toBe('unhealthy');
    expect(typeof out.error).toBe('string');
  });

  test('checkRedisStatus: hostile err.message and toString in catch does not throw', async () => {
    config.get.mockImplementation((key, fallback) => (key === 'rateLimit.redis.url' ? 'redis://test:6379' : fallback));
    isRedisAvailable.mockRejectedValue(hostileErrFull());
    const out = await checkRedisStatus();
    expect(out.status).toBe('unhealthy');
    expect(out.error).toBe('');
  });

  test('checkRagServiceStatus: hostile err.message in catch does not throw', async () => {
    getRagHealth.mockRejectedValue(hostileErr());
    const out = await checkRagServiceStatus();
    expect(out.status).toBe('unhealthy');
    expect(typeof out.error).toBe('string');
  });

  test('checkWebSocketStatus: hostile err.message in catch does not throw', async () => {
    getWebSocketServer.mockImplementation(() => {
      throw hostileErr();
    });
    const out = await checkWebSocketStatus();
    expect(out.status).toBe('unhealthy');
    expect(typeof out.error).toBe('string');
  });

  test('checkApiServerStatus: hostile err.message in catch does not throw', async () => {
    const originalMemoryUsage = process.memoryUsage;
    process.memoryUsage = () => {
      throw hostileErr();
    };
    try {
      const out = await checkApiServerStatus();
      expect(out.status).toBe('unhealthy');
      expect(typeof out.error).toBe('string');
    } finally {
      process.memoryUsage = originalMemoryUsage;
    }
  });

  test('checkApiServerStatus: hostile err.message and toString in catch does not throw', async () => {
    const originalMemoryUsage = process.memoryUsage;
    process.memoryUsage = () => {
      throw hostileErrFull();
    };
    try {
      const out = await checkApiServerStatus();
      expect(out.status).toBe('unhealthy');
      expect(out.error).toBe('');
    } finally {
      process.memoryUsage = originalMemoryUsage;
    }
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/systemStatusService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
