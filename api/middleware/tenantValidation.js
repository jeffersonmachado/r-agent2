/**
 * Middleware de validação de tenant.
 * 
 * REGRA ABSOLUTA: Todo request deve conter tenant_id válido.
 * 
 * O tenant_id pode vir de:
 * 1. JWT token (req.agent.tenantId)
 * 2. Header X-Tenant-Id
 * 3. Subdomínio (futuro)
 * 
 * Este middleware:
 * - Valida que o tenant existe
 * - Valida que o tenant está ativo e não expirado
 * - Bloqueia acesso cruzado entre tenants
 * - Adiciona req.tenantId e req.tenant ao request
 */

const { getTenant, validateTenantStatus } = require('../services/tenantService');
const { requireAuth } = require('./auth');
const logger = require('../utils/logger');

/**
 * Extrai tenant_id do request.
 * Ordem de prioridade:
 * 1. req.agent.tenantId (do JWT - autentica se necessário)
 * 2. Header X-Tenant-Id
 * 
 * @param {http.IncomingMessage} req
 * @returns {string|null}
 */
function extractTenantId(req) {
  // 1. Do agente autenticado (preferencial)
  // Se req.agent não existe mas há token, tenta autenticar
  if (!req.agent) {
    const authResult = requireAuth(req);
    if (authResult.valid && authResult.agent && authResult.agent.tenantId) {
      // Atualiza req.agent para uso posterior
      req.agent = authResult.agent;
      req.session = authResult.session;
      return authResult.agent.tenantId;
    }
  } else if (req.agent && req.agent.tenantId) {
    return req.agent.tenantId;
  }

  // 2. Do header
  const headerTenantId = req.headers['x-tenant-id'];
  if (headerTenantId) {
    return headerTenantId.trim();
  }

  return null;
}

/**
 * Middleware que valida e resolve tenant.
 * Adiciona req.tenantId e req.tenant ao request.
 * 
 * @param {http.IncomingMessage} req
 * @returns {Promise<{valid: boolean, tenantId?: string, tenant?: Object, error?: string}>}
 */
async function requireTenant(req) {
  const tenantId = extractTenantId(req);

  if (!tenantId) {
    return {
      valid: false,
      error: 'tenant_id é obrigatório. Forneça via JWT ou header X-Tenant-Id',
    };
  }

  // Verifica se tenant existe
  const tenant = await getTenant(tenantId);
  if (!tenant) {
    // Para super-admin com tenantId "system", permite mesmo se tenant não existir ainda
    // (pode ser criado posteriormente)
    // Verifica se é super-admin sem criar dependência circular
    const isSuperAdmin = req.agent && (
      req.agent.role === 'super_admin' || 
      (req.agent.role === 'owner' && req.agent.tenantId === 'system')
    );
    
    if (isSuperAdmin && tenantId === 'system') {
      logger.debug('[TenantValidation] Super Admin acessando tenant "system" (pode não existir ainda)');
      // Cria um tenant "system" temporário para permitir o acesso
      req.tenantId = tenantId;
      req.tenant = {
        id: 'system',
        name: 'Sistema',
        status: 'active',
        plan: 'enterprise',
      };
      return {
        valid: true,
        tenantId,
        tenant: req.tenant,
      };
    }
    
    logger.warn('[TenantValidation] Tentativa de acesso com tenant_id inválido', {
      tenantId,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    });
    return {
      valid: false,
      error: 'Tenant não encontrado',
    };
  }

  // Valida status do tenant (reusa o tenant já carregado — evita nova query)
  try {
    const statusValidation = await validateTenantStatus(tenantId, tenant);
    if (!statusValidation.valid) {
      logger.warn('[TenantValidation] Tentativa de acesso a tenant inválido/suspenso', {
        tenantId,
        status: tenant.status,
        error: statusValidation.error,
      });
      return {
        valid: false,
        error: statusValidation.error || 'Tenant não disponível',
      };
    }
  } catch (err) {
    logger.error('[TenantValidation] Erro ao validar status do tenant:', err);
    // Continua mesmo com erro de validação (não bloqueia)
  }

  // Verifica isolamento: se o agente está autenticado, deve pertencer ao mesmo tenant
  if (req.agent && req.agent.tenantId && req.agent.tenantId !== tenantId) {
    logger.warn('[TenantValidation] Tentativa de acesso cruzado entre tenants', {
      agentTenantId: req.agent.tenantId,
      requestedTenantId: tenantId,
      agentId: req.agent.id,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    });
    return {
      valid: false,
      error: 'Acesso negado: isolamento de tenant',
    };
  }

  // Adiciona tenant ao request
  req.tenantId = tenantId;
  req.tenant = tenant;

  return {
    valid: true,
    tenantId,
    tenant,
  };
}

/**
 * Middleware que valida tenant e bloqueia acesso se inválido.
 * Deve ser usado após requireAuth.
 * 
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Function} sendJson - Função helper para enviar JSON
 * @returns {Promise<boolean>} true se válido, false se bloqueado
 */
async function validateTenantMiddleware(req, res, sendJson) {
  const validation = await requireTenant(req);

  if (!validation.valid) {
    sendJson(res, 403, {
      error: 'tenant_validation_failed',
      message: validation.error,
    });
    return false;
  }

  return true;
}

/**
 * Valida que um recurso pertence ao tenant do request.
 * 
 * @param {http.IncomingMessage} req
 * @param {Object} resource - Recurso (deve ter campo tenantId)
 * @returns {{valid: boolean, error?: string}}
 */
function validateResourceTenant(req, resource) {
  if (!req.tenantId) {
    return { valid: false, error: 'Tenant não resolvido no request' };
  }

  if (!resource) {
    return { valid: false, error: 'Recurso não fornecido' };
  }

  // Se o recurso não tem tenantId, assume que pertence ao tenant do request
  // (para compatibilidade com recursos antigos)
  if (!resource.tenantId) {
    logger.warn('[TenantValidation] Recurso sem tenantId, assumindo tenant do request', {
      resourceId: resource.id,
      tenantId: req.tenantId,
    });
    return { valid: true };
  }

  if (resource.tenantId !== req.tenantId) {
    logger.warn('[TenantValidation] Tentativa de acesso a recurso de outro tenant', {
      resourceTenantId: resource.tenantId,
      requestTenantId: req.tenantId,
      resourceId: resource.id,
    });
    return {
      valid: false,
      error: 'Recurso não pertence ao tenant do request',
    };
  }

  return { valid: true };
}

module.exports = {
  extractTenantId,
  requireTenant,
  validateTenantMiddleware,
  validateResourceTenant,
};
