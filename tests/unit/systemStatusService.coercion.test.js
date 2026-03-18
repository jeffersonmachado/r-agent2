'use strict';

/**
 * Coercion-guard tests for systemStatusService.js
 */

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
  isRagAvailable: jest.fn(),
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
const { isRagAvailable } = require('../../api/services/ragService');
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

describe('systemStatusService coercion guards', () => {
  beforeEach(() => {
    config.get.mockImplementation((key, fallback) => fallback);
    isRedisAvailable.mockReset();
    isRagAvailable.mockReset();
    getWebSocketServer.mockReset();
  });

  test('checkRedisStatus: hostile err.message in catch does not throw', async () => {
    isRedisAvailable.mockRejectedValue(hostileErr());
    const out = await checkRedisStatus();
    expect(out.status).toBe('unhealthy');
    expect(typeof out.error).toBe('string');
  });

  test('checkRagServiceStatus: hostile err.message in catch does not throw', async () => {
    isRagAvailable.mockRejectedValue(hostileErr());
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
});
