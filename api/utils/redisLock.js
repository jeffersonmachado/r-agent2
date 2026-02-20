// utils/redisLock.js
// Lock distribuído simples usando Redis SET NX + release com token.

'use strict';

const crypto = require('crypto');
const { getRedisClientOrNull } = require('./redisClient');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquireLock(key, ttlMs = 120000) {
  const redis = getRedisClientOrNull();
  if (!redis || redis.status !== 'ready') {
    return { ok: false, via: 'noop', token: null };
  }

  const token = crypto.randomBytes(16).toString('hex');
  const res = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (res !== 'OK') return { ok: false, via: 'redis', token: null };
  return { ok: true, via: 'redis', token };
}

async function releaseLock(key, token) {
  const redis = getRedisClientOrNull();
  if (!redis || redis.status !== 'ready') return { ok: false, via: 'noop' };
  if (!token) return { ok: false, via: 'redis' };

  const script = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
      return redis.call('DEL', KEYS[1])
    else
      return 0
    end
  `;

  try {
    await redis.eval(script, 1, key, token);
    return { ok: true, via: 'redis' };
  } catch (_) {
    return { ok: false, via: 'redis' };
  }
}

async function waitFor(predicateFn, { timeoutMs = 60000, intervalMs = 250 } = {}) {
  const started = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (predicateFn()) return { ok: true };
    if (Date.now() - started >= timeoutMs) return { ok: false, error: 'timeout' };
    await sleep(intervalMs);
  }
}

module.exports = { acquireLock, releaseLock, waitFor };
