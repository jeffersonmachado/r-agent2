'use strict';

/**
 * Password helpers — bcrypt hash + verify
 */

const crypto = require('crypto');

let bcrypt = null;
try {
  bcrypt = require('bcrypt');
} catch (_) {
  // bcrypt não instalado — usa fallback SHA-256 (apenas para testes)
}

const BCRYPT_ROUNDS = 10;

async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password é obrigatório');
  }
  if (bcrypt) {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }
  // Fallback para testes sem bcrypt
  const salt = crypto.randomBytes(16).toString('hex');
  return `sha256:${salt}:${crypto.createHash('sha256').update(salt + password).digest('hex')}`;
}

async function verifyPassword(password, hash) {
  if (!password || !hash) return false;
  if (bcrypt) {
    return bcrypt.compare(password, hash);
  }
  // Fallback SHA-256
  if (hash.startsWith('sha256:')) {
    const [, salt, expected] = hash.split(':');
    const actual = crypto.createHash('sha256').update(salt + password).digest('hex');
    return actual === expected;
  }
  return false;
}

module.exports = { hashPassword, verifyPassword };
