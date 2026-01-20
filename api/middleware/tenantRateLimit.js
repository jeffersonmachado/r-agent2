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
const { getTenant } = require('../services/tenantService');
const { requireTenant } = require('./tenantValidation');
const { isSuperAdmin } = require('../services/superAdminService');
const logger = require('../utils/logger');

/**
 * Limites de requisições por minuto por plano.
 */
const RATE_LIMITS_BY_PLAN = {
  // Alias "basic" (SaaS) -> limites similares ao trial
  basic: {
    points: 500,
    duration: 60,
  },
  free: {
    points: 100,
    duration: 60, // 60 segundos
  },
  trial: {
    points: 500,
    duration: 60,
  },
  pro: {
    points: 2000,
    duration: 60,
  },
  enterprise: {
    points: 10000,
    duration: 60,
  },
};

/**
 * Middleware que aplica rate limiting por tenant.
 * 
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Function} sendJson - Função helper para enviar JSON
 * @returns {Promise<boolean>} true se permitido, false se bloqueado
 */
async function tenantRateLimitMiddleware(req, res, sendJson) {
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
      
      try {
        const operationType = `TENANT_API_${tenant.plan}_${limits.points}_${limits.duration}`;
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

  try {
    // Usa operação específica para rate limiting por tenant
    const operationType = `TENANT_API_${tenant.plan}_${limits.points}_${limits.duration}`;
    
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
  const userLimits = {
    basic: { points: 100, duration: 60 },
    free: { points: 20, duration: 60 },
    trial: { points: 100, duration: 60 },
    pro: { points: 500, duration: 60 },
    enterprise: { points: 2000, duration: 60 },
  };

  const limits = userLimits[tenant.plan] || userLimits.trial;

  try {
    const operationType = `TENANT_USER_API_${tenant.plan}_${limits.points}_${limits.duration}`;
    
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
