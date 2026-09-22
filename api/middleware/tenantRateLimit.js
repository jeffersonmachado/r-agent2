/**
 * Middleware de Rate Limiting por Tenant.
 * 
 * Aplica rate limiting isolado por tenant, usando limites do plano.
 * 
 * Limites por plano:
 * - free: 100 req/min
 * - trial: 500 req/min
 * - pro: 2000 req/min
 * - enterprise: 10000 req/min (ou ilimitado)
 */

const { checkRateLimit } = require('../../infra/rate-limit');
const { TENANT_API_PLAN_LIMITS, TENANT_USER_API_PLAN_LIMITS } = require('../../infra/rate-limit/policies');
const { getTenant } = require('../services/tenantService');
const { requireTenant } = require('./tenantValidation');
const { isSuperAdmin } = require('../services/superAdminService');
const logger = require('../utils/logger');

/**
 * Limites de requisições por minuto por plano.
 * Fonte canônica: infra/rate-limit/policies.js (o operationType dinâmico
 * TENANT_API_<plano>_<points>_<duration> resolve nessa mesma tabela).
 */
const RATE_LIMITS_BY_PLAN = TENANT_API_PLAN_LIMITS;

/**
 * Middleware que aplica rate limiting por tenant.
 * 
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Function} sendJson - Função helper para enviar JSON
 * @returns {Promise<boolean>} true se permitido, false se bloqueado
 */
async function tenantRateLimitMiddleware(req, res, sendJson) {
  const pathname = req.path || new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
  const normalizedPathname = pathname.startsWith('/api/') ? pathname.slice('/api'.length) : pathname;
  const isAuthRoute = normalizedPathname === '/auth' || normalizedPathname.startsWith('/auth/');

  // Rotas de auth não devem depender de tenant para evitar bloquear login/logout.
  if (isAuthRoute) {
    return true;
  }

  // Em desenvolvimento, rate limit é desativado
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'development') {
    logger.debug('[TenantRateLimit] Rate limit desativado em desenvolvimento');
    return true;
  }
  
  // Para super-admins, rate limit é apenas informativo (não bloqueia)
  if (req.agent && isSuperAdmin(req.agent)) {
    // Ainda valida e verifica rate limit, mas apenas para logging
    const tenantValidation = await requireTenant(req);
    if (tenantValidation.valid) {
      const tenantId = req.tenantId;
      const tenant = req.tenant;
      const limits = RATE_LIMITS_BY_PLAN[tenant.plan] || RATE_LIMITS_BY_PLAN.trial;
      // Plano desconhecido cai no fallback trial: o operationType precisa
      // refletir o plano efetivo para resolver na política canônica
      const effectivePlan = RATE_LIMITS_BY_PLAN[tenant.plan] ? tenant.plan : 'trial';
      
      try {
        const operationType = `TENANT_API_${effectivePlan}_${limits.points}_${limits.duration}`;
        const result = await checkRateLimit({
          userId: `tenant:${tenantId}`,
          operationType,
        });
        
        // Apenas loga, não bloqueia
        if (!result.allowed) {
          logger.warn('[TenantRateLimit] Rate limit excedido (super-admin - apenas informativo)', {
            tenantId,
            plan: tenant.plan,
            retryAfter: result.retryAfter,
            agentId: req.agent.id,
            username: req.agent.username,
          });
        }
        
        // Adiciona headers informativos mesmo para super-admin
        res.setHeader('X-RateLimit-Limit', limits.points);
        res.setHeader('X-RateLimit-Remaining', result.remainingPoints || limits.points);
        res.setHeader('X-RateLimit-Reset', new Date(Date.now() + (limits.duration * 1000)).toISOString());
        res.setHeader('X-RateLimit-SuperAdmin', 'true'); // Indica que é super-admin
      } catch (err) {
        logger.debug('[TenantRateLimit] Erro ao verificar rate limit para super-admin (ignorado)', {
          tenantId: req.tenantId,
          error: err.message,
        });
      }
    }
    // Super-admin sempre passa, rate limit é apenas informativo
    return true;
  }
  
  // Rotas de autenticação e super-admin não exigem tenant_id
  // (serão tratadas antes de chegar aqui no server.js)
  // Valida tenant primeiro
  const tenantValidation = await requireTenant(req);
  if (!tenantValidation.valid) {
    // Sem agente resolvido, a causa raiz é ausência de autenticação, não
    // ausência de tenant: 401 precede 403 (uma chamada anônima deve ser
    // barrada por "não autenticado", nunca por "tenant obrigatório").
    if (!req.agent) {
      sendJson(res, 401, {
        error: 'unauthorized',
        message: 'Autenticação necessária',
      });
      return false;
    }
    sendJson(res, 403, {
      error: 'tenant_validation_failed',
      message: tenantValidation.error,
    });
    return false;
  }

  const tenantId = req.tenantId;
  const tenant = req.tenant;

  // Enterprise pode ter rate limit customizado ou ilimitado
  if (tenant.plan === 'enterprise') {
    // Verifica se há limite customizado
    if (tenant.settings?.rateLimit) {
      const customLimit = tenant.settings.rateLimit;
      try {
        const result = await checkRateLimit({
          userId: `tenant:${tenantId}`,
          operationType: `TENANT_API_${customLimit.points}_${customLimit.duration}`,
        });

        if (!result.allowed) {
          sendJson(res, 429, {
            error: 'rate_limit_exceeded',
            message: `Limite de requisições excedido. Tente novamente em ${result.retryAfter} segundos.`,
            retryAfter: result.retryAfter,
          });
          return false;
        }
      } catch (err) {
        // Se rate limiting falhar, permite mas loga
        logger.error('[TenantRateLimit] Erro ao verificar rate limit', {
          tenantId,
          error: err.message,
        });
        // Em produção, pode querer bloquear aqui
      }
    }
    // Se não há limite customizado, permite (ilimitado)
    return true;
  }

  // Obtém limites do plano
  const limits = RATE_LIMITS_BY_PLAN[tenant.plan] || RATE_LIMITS_BY_PLAN.trial;
  // Plano desconhecido cai no fallback trial: o operationType precisa
  // refletir o plano efetivo para resolver na política canônica
  const effectivePlan = RATE_LIMITS_BY_PLAN[tenant.plan] ? tenant.plan : 'trial';

  try {
    // Usa operação específica para rate limiting por tenant
    const operationType = `TENANT_API_${effectivePlan}_${limits.points}_${limits.duration}`;
    
    const result = await checkRateLimit({
      userId: `tenant:${tenantId}`,
      operationType,
    });

    if (!result.allowed) {
      // Adiciona header Retry-After
      res.setHeader('Retry-After', result.retryAfter);
      
      sendJson(res, 429, {
        error: 'rate_limit_exceeded',
        message: `Limite de requisições excedido para o plano ${tenant.plan}. Tente novamente em ${result.retryAfter} segundos.`,
        retryAfter: result.retryAfter,
        plan: tenant.plan,
        limit: limits.points,
        duration: limits.duration,
      });

      logger.warn('[TenantRateLimit] Rate limit excedido', {
        tenantId,
        plan: tenant.plan,
        retryAfter: result.retryAfter,
      });

      return false;
    }

    // Adiciona headers informativos
    res.setHeader('X-RateLimit-Limit', limits.points);
    res.setHeader('X-RateLimit-Remaining', result.remainingPoints || limits.points);
    res.setHeader('X-RateLimit-Reset', new Date(Date.now() + (limits.duration * 1000)).toISOString());

    return true;
  } catch (err) {
    // Se rate limiting falhar, permite mas loga como erro crítico
    logger.error('[TenantRateLimit] Erro ao verificar rate limit', {
      tenantId,
      plan: tenant.plan,
      error: err.message,
      errorStack: err.stack,
    });

    // Em produção, pode querer bloquear aqui por segurança
    // Por enquanto, permite para não quebrar o sistema
    return true;
  }
}

/**
 * Middleware que aplica rate limiting por tenant e usuário.
 * Mais restritivo: limita por tenant E por usuário.
 * 
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Function} sendJson - Função helper para enviar JSON
 * @returns {Promise<boolean>} true se permitido, false se bloqueado
 */
async function tenantUserRateLimitMiddleware(req, res, sendJson) {
  // Valida tenant primeiro
  const tenantValidation = await requireTenant(req);
  if (!tenantValidation.valid) {
    // Sem agente resolvido, a causa raiz é ausência de autenticação, não
    // ausência de tenant: 401 precede 403 (uma chamada anônima deve ser
    // barrada por "não autenticado", nunca por "tenant obrigatório").
    if (!req.agent) {
      sendJson(res, 401, {
        error: 'unauthorized',
        message: 'Autenticação necessária',
      });
      return false;
    }
    sendJson(res, 403, {
      error: 'tenant_validation_failed',
      message: tenantValidation.error,
    });
    return false;
  }

  // Requer autenticação
  if (!req.agent || !req.agent.id) {
    sendJson(res, 401, {
      error: 'unauthorized',
      message: 'Autenticação necessária para rate limiting por usuário',
    });
    return false;
  }

  const tenantId = req.tenantId;
  const tenant = req.tenant;
  const userId = req.agent.id;

  // Enterprise pode ter rate limit customizado
  if (tenant.plan === 'enterprise') {
    if (tenant.settings?.userRateLimit) {
      const customLimit = tenant.settings.userRateLimit;
      try {
        const result = await checkRateLimit({
          userId: `tenant:${tenantId}:user:${userId}`,
          operationType: `TENANT_USER_API_${customLimit.points}_${customLimit.duration}`,
        });

        if (!result.allowed) {
          sendJson(res, 429, {
            error: 'rate_limit_exceeded',
            message: `Limite de requisições excedido. Tente novamente em ${result.retryAfter} segundos.`,
            retryAfter: result.retryAfter,
          });
          return false;
        }
      } catch (err) {
        logger.error('[TenantRateLimit] Erro ao verificar rate limit por usuário', {
          tenantId,
          userId,
          error: err.message,
        });
      }
    }
    return true;
  }

  // Limites por usuário são menores que por tenant
  // Fonte canônica: infra/rate-limit/policies.js (TENANT_USER_API_PLAN_LIMITS)
  const limits = TENANT_USER_API_PLAN_LIMITS[tenant.plan] || TENANT_USER_API_PLAN_LIMITS.trial;
  const effectivePlan = TENANT_USER_API_PLAN_LIMITS[tenant.plan] ? tenant.plan : 'trial';

  try {
    const operationType = `TENANT_USER_API_${effectivePlan}_${limits.points}_${limits.duration}`;
    
    const result = await checkRateLimit({
      userId: `tenant:${tenantId}:user:${userId}`,
      operationType,
    });

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfter);
      
      sendJson(res, 429, {
        error: 'rate_limit_exceeded',
        message: `Limite de requisições por usuário excedido. Tente novamente em ${result.retryAfter} segundos.`,
        retryAfter: result.retryAfter,
        plan: tenant.plan,
      });

      return false;
    }

    res.setHeader('X-RateLimit-Limit', limits.points);
    res.setHeader('X-RateLimit-Remaining', result.remainingPoints || limits.points);

    return true;
  } catch (err) {
    logger.error('[TenantRateLimit] Erro ao verificar rate limit por usuário', {
      tenantId,
      userId,
      error: err.message,
    });
    return true;
  }
}

module.exports = {
  tenantRateLimitMiddleware,
  tenantUserRateLimitMiddleware,
  RATE_LIMITS_BY_PLAN,
};
