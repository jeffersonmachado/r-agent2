'use strict';

describe('Redis optional config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.RATE_LIMIT_REDIS_URL;
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('rateLimitClient não instancia Redis sem URL configurada em test', () => {
    const Redis = jest.fn(() => ({
      on: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      status: 'end',
    }));

    jest.doMock('ioredis', () => Redis);
    jest.doMock('../../api/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn(() => undefined),
    }));

    const { getRateLimitClient } = require('../../infra/redis/rateLimitClient');

    expect(getRateLimitClient()).toBeNull();
    expect(Redis).not.toHaveBeenCalled();
  });

  test('ephemeralContextClient não instancia Redis sem URL configurada em test', () => {
    const Redis = jest.fn(() => ({
      on: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      status: 'end',
    }));

    jest.doMock('ioredis', () => Redis);
    jest.doMock('../../api/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn(() => undefined),
    }));

    const { getEphemeralContextClient } = require('../../infra/redis/ephemeralContextClient');

    expect(getEphemeralContextClient()).toBeNull();
    expect(Redis).not.toHaveBeenCalled();
  });

  test('systemStatusService marca Redis como degraded quando não configurado fora de produção', async () => {
    jest.doMock('../../api/utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }));
    jest.doMock('../../api/utils/config', () => ({
      get: jest.fn(() => undefined),
    }));
    jest.doMock('../../infra/redis/rateLimitClient', () => ({
      isRedisAvailable: jest.fn(async () => false),
      getRateLimitClient: jest.fn(() => null),
    }));
    jest.doMock('../../api/services/ragService', () => ({
      isRagAvailable: jest.fn(),
      getRagServiceUrl: jest.fn(),
    }));
    jest.doMock('../../api/services/websocketService', () => ({
      getWebSocketServer: jest.fn(),
    }));
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => null),
    }));
    jest.doMock('../../api/db/models', () => ({
      RagDocument: { count: jest.fn() },
    }));

    const { checkRedisStatus } = require('../../api/services/systemStatusService');
    const out = await checkRedisStatus();

    expect(out.status).toBe('degraded');
    expect(out.details).toEqual(expect.objectContaining({
      configured: false,
      mode: 'memory',
      fallbackEnabled: false,
      environment: 'test',
    }));
  });
});