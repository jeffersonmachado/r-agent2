'use strict';

jest.mock('../../utils/redisClient', () => ({
  getRedisClientOrNull: jest.fn(),
}));

const { getRedisClientOrNull } = require('../../utils/redisClient');
const { ConversationSessionStore } = require('../conversationSessionStore');

describe('ConversationSessionStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('usa Redis quando disponível', async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ value: { foo: 'bar' } })),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };
    getRedisClientOrNull.mockReturnValue(redis);

    const store = new ConversationSessionStore();
    await store.set('k1', { foo: 'bar' }, 60);
    const value = await store.get('k1');
    await store.delete('k1');

    expect(redis.set).toHaveBeenCalled();
    expect(redis.get).toHaveBeenCalledWith('k1');
    expect(redis.del).toHaveBeenCalledWith('k1');
    expect(value).toEqual({ foo: 'bar' });
  });

  test('faz fallback para memória quando Redis falha', async () => {
    const redis = {
      get: jest.fn().mockRejectedValue(new Error('redis down')),
      set: jest.fn().mockRejectedValue(new Error('redis down')),
      del: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    getRedisClientOrNull.mockReturnValue(redis);

    const store = new ConversationSessionStore();
    await store.set('k2', { a: 1 }, 60);
    const value = await store.get('k2');

    expect(value).toEqual({ a: 1 });
    expect(store.redisFallbackCount).toBeGreaterThan(0);
  });
});
