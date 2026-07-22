'use strict';

/**
 * @results/auth — Token-based Authentication Module
 *
 * Uso:
 *   const { createAuth } = require('@results/auth');
 *   const auth = createAuth({ adapter: new SequelizeAdapter({...}) });
 *   await auth.initialize();
 *   const result = await auth.login({ username, password });
 *   const { valid, user } = auth.validateToken(token);
 *
 * API pública:
 *   createAuth(options) → { login, validateToken, logout, initialize, middleware }
 */

const { createTokenService } = require('./token-service');
const { createMiddleware } = require('./middleware');
const { SequelizeAdapter } = require('./adapters/sequelize-adapter');
const { MemoryAdapter } = require('./adapters/memory-adapter');
const { hashPassword, verifyPassword } = require('./password');

/**
 * Factory principal.
 *
 * @param {object} options
 * @param {object} options.adapter - adapter de persistência (obrigatório)
 * @param {number} [options.tokenLength=64]
 * @param {number} [options.tokenExpirationHours=24]
 * @param {number} [options.inactivityTimeoutMinutes=30]
 * @param {number} [options.maxSessionsPerAgent=3]
 * @param {function} [options.isSuperAdmin] - (user) => boolean
 * @param {function} [options.permissionChecker] - (user, resource, action) => boolean
 * @param {object} [options.sessionStore] - Map-like store (default: Map em memória)
 * @returns {object} { login, validateToken, logout, initialize, middleware }
 */
function createAuth(options = {}) {
  const adapter = options.adapter;
  if (!adapter) throw new Error('Adapter é obrigatório');

  const tokenService = createTokenService({
    adapter,
    tokenLength: options.tokenLength,
    tokenExpirationHours: options.tokenExpirationHours,
    inactivityTimeoutMinutes: options.inactivityTimeoutMinutes,
    maxSessionsPerAgent: options.maxSessionsPerAgent,
    sessionStore: options.sessionStore,
  });

  const middleware = createMiddleware({
    validateToken: tokenService.validateToken,
    isSuperAdmin: options.isSuperAdmin,
    permissionChecker: options.permissionChecker,
    resolveTenantId: options.resolveTenantId,
  });

  const auth = {
    ...tokenService,
    ...middleware,
    adapter,
  };

  // Alias para compatibilidade com API antiga
  auth.requireAuth = middleware.requireAuth;
  auth.requirePermission = middleware.requirePermission;

  return auth;
}

module.exports = {
  createAuth,
  createTokenService,
  createMiddleware,
  SequelizeAdapter,
  MemoryAdapter,
  hashPassword,
  verifyPassword,
};
