/**
 * Middleware de autenticação para proteger rotas.
 *
 * Uso:
 *   const { requireAuth, requirePermission } = require('./middleware/auth');
 *
 *   // Proteger rota com autenticação
 *   if (method === 'POST' && pathname === '/tickets') {
 *     const authResult = requireAuth(req);
 *     if (!authResult.valid) {
 *       sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
 *       return;
 *     }
 *     // req.agent e req.session estão disponíveis
 *   }
 *
 *   // Proteger rota com permissão
 *   const permResult = requirePermission(req, 'tickets', 'create');
 *   if (!permResult.allowed) {
 *     sendJson(res, 403, { error: 'forbidden', message: permResult.error });
 *     return;
 *   }
 */

const { validateToken } = require('../services/authService');
const { hasPermission } = require('../services/rbacService');
const { isSuperAdmin } = require('../services/superAdminService');

/**
 * Extrai token do header Authorization.
 *
 * @param {http.IncomingMessage} req
 * @returns {string|null}
 */
function extractToken(req) {
  const authHeader = req.headers.authorization || '';
  
  // Suporta formato "Bearer <token>" ou apenas "<token>"
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  
  return authHeader || null;
}

/**
 * Middleware que requer autenticação.
 * Adiciona req.agent, req.session e req.tenantId se autenticado.
 *
 * @param {http.IncomingMessage} req
 * @returns {{valid: boolean, agent?: Object, session?: Object, error?: string}}
 */
function requireAuth(req) {
  const token = extractToken(req);
  
  if (!token) {
    return { valid: false, error: 'Token de autenticação não fornecido' };
  }

  const validation = validateToken(token);
  
  if (!validation.valid) {
    return { valid: false, error: validation.error || 'Token inválido' };
  }

  // Adiciona agente, sessão e tenantId ao request (para uso posterior)
  req.agent = validation.agent;
  req.session = validation.session;
  req.token = token;
  
  // Para super-admin, permite usar X-Tenant-Id header para acessar diferentes tenants
  // Caso contrário, usa o tenantId do agente autenticado
  if (isSuperAdmin(validation.agent)) {
    const headerTenantId = req.headers['x-tenant-id'];
    if (headerTenantId && headerTenantId.trim()) {
      req.tenantId = headerTenantId.trim();
    } else {
      // Hardening: super-admin deve selecionar tenant explicitamente via header (evita operar "silenciosamente" no tenant do usuário)
      req.tenantId = null;
    }
  } else {
    req.tenantId = validation.agent.tenantId || null; // Extrai tenantId do agente
  }

  return { valid: true, agent: validation.agent, session: validation.session };
}

/**
 * Middleware que requer uma permissão específica.
 * Deve ser usado após requireAuth.
 *
 * @param {http.IncomingMessage} req - Request (deve ter req.agent)
 * @param {string} resource - Recurso (tickets, queues, agents, etc.)
 * @param {string} action - Ação (create, read, update, delete, etc.)
 * @returns {{allowed: boolean, error?: string}}
 */
function requirePermission(req, resource, action) {
  if (!req.agent) {
    return { allowed: false, error: 'Autenticação necessária' };
  }

  if (!hasPermission(req.agent, resource, action)) {
    return {
      allowed: false,
      error: `Permissão negada: ${action} em ${resource}`,
    };
  }

  return { allowed: true };
}

module.exports = {
  extractToken,
  requireAuth,
  requirePermission,
};

