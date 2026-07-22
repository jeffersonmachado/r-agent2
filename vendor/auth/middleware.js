'use strict';

/**
 * Middleware de autenticação — framework-agnostic
 *
 * Funciona com Express, http.Server ou qualquer framework que exponha
 * req.headers e permita anexar propriedades ao objeto req.
 */

/**
 * Extrai token do header Authorization.
 * Suporta: "Bearer <token>" ou apenas "<token>"
 */
function extractToken(req) {
  const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return authHeader || '';
}

/**
 * Cria middleware de autenticação.
 *
 * @param {object} deps
 * @param {function} deps.validateToken - função síncrona (token) => { valid, user, session, error }
 * @param {function} [deps.isSuperAdmin] - (user) => boolean
 * @param {function} [deps.resolveTenantId] - (req) => string | null
 * @returns {object} { requireAuth, requirePermission }
 */
function createMiddleware(deps = {}) {
  const validateToken = deps.validateToken;
  const isSuperAdmin = deps.isSuperAdmin || (() => false);
  const resolveTenantId = deps.resolveTenantId || null;

  if (typeof validateToken !== 'function') {
    throw new Error('validateToken é obrigatório');
  }

  /**
   * Middleware que requer autenticação.
   * Adiciona req.agent, req.session, req.token, req.tenantId.
   *
   * @returns {{valid: boolean, agent?: object, session?: object, error?: string}}
   */
  function requireAuth(req) {
    const token = extractToken(req);

    if (!token) {
      return { valid: false, error: 'Token de autenticação não fornecido' };
    }

    const result = validateToken(token);

    if (!result.valid) {
      return { valid: false, error: result.error || 'Token inválido' };
    }

    req.agent = result.user;
    req.session = result.session;
    req.token = token;

    // Resolve tenant
    if (isSuperAdmin(result.user)) {
      const headerTenantId = req.headers?.['x-tenant-id'];
      req.tenantId = headerTenantId && headerTenantId.trim() ? headerTenantId.trim() : null;
    } else if (resolveTenantId) {
      req.tenantId = resolveTenantId(req);
    } else {
      req.tenantId = result.user.tenantId || result.user.tenant_key || null;
    }

    return { valid: true, agent: result.user, session: result.session };
  }

  /**
   * Middleware que requer permissão específica.
   * Deve ser usado após requireAuth.
   *
   * @param {object} req - deve ter req.agent
   * @param {string} resource - ex: 'tickets', 'agents'
   * @param {string} action - ex: 'create', 'read', 'update', 'delete'
   * @param {function} [checker] - (agent, resource, action) => boolean
   * @returns {{allowed: boolean, error?: string}}
   */
  function requirePermission(req, resource, action, checker) {
    if (!req.agent) {
      return { allowed: false, error: 'Autenticação necessária' };
    }

    const checkFn = checker || deps.permissionChecker;

    if (typeof checkFn !== 'function') {
      // Sem checker configurado, permite tudo
      return { allowed: true };
    }

    const allowed = checkFn(req.agent, resource, action);
    if (!allowed) {
      return { allowed: false, error: `Permissão negada: ${resource}:${action}` };
    }

    return { allowed: true };
  }

  /**
   * Helper para Express: retorna true se autenticado, senão responde 401.
   */
  function requireAuthExpress(req, res) {
    const result = requireAuth(req);
    if (!result.valid) {
      res.status(401).json({ error: 'unauthorized', message: result.error });
      return false;
    }
    return true;
  }

  return { requireAuth, requirePermission, requireAuthExpress, extractToken };
}

module.exports = { createMiddleware, extractToken };
