const path = require('path');

function loadRateLimitModule() {
  const candidates = [
    path.resolve(__dirname, '../../../../infra/rate-limit'),
    '../../../../infra/rate-limit',
    '../../../infra/rate-limit',
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (err) {
      const missingTarget = err && err.code === 'MODULE_NOT_FOUND'
        && typeof err.message === 'string'
        && err.message.includes(candidate);
      if (missingTarget) {
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Cannot find rate limit module. Tried: ${candidates.join(', ')}`);
}

async function handleSystemGenerationControlRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requireTenant,
    isSuperAdmin,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    STRICT_TENANT_MODE,
    generateAndValidate,
  } = deps;

  if (method !== 'POST') {
    return false;
  }

  // POST /system/check-rate-limit - Verifica rate limit sem consumir pontos
  if (pathname === '/system/check-rate-limit') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return true;
      }

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return true;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
        finalTenantId = finalTenantId.trim();
      }
      const userId = req.agent?.id || req.agent?.username || finalTenantId;

      // Determina tipo de operação baseado no payload.
      const isBootstrap = body.bootstrap === true;
      const isDryRun = body.executionMode === 'dry-run';
      let operationType;
      if (isBootstrap) {
        operationType = 'BOOTSTRAP';
      } else if (isDryRun) {
        operationType = 'DRY_RUN';
      } else {
        operationType = 'GENERATION_REAL';
      }

      // Verifica rate limit sem consumir pontos.
      const { checkRateLimitStatus } = loadRateLimitModule();
      const status = await checkRateLimitStatus({
        userId,
        operationType,
      });

      // Para super-admins, adiciona flag indicando que rate limit é apenas informativo.
      const isSuperAdminUser = req.agent ? isSuperAdmin(req.agent) : false;
      if (isSuperAdminUser) {
        status.isSuperAdmin = true;
        status.informativeOnly = true; // Rate limit é apenas informativo, não bloqueia
      }

      sendJson(res, 200, status);
    } catch (err) {
      logger.error('Erro ao verificar rate limit:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao verificar rate limit',
      });
    }
    return true;
  }

  // POST /system/generate-and-validate
  if (pathname === '/system/generate-and-validate') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return true;
      }

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return true;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
        finalTenantId = finalTenantId.trim();
      }
      const userId = req.agent?.id || req.agent?.username || finalTenantId;
      const agentId = req.agent?.id;

      // Callback para enviar atualizações de progresso via WebSocket.
      const { emitEvent } = require('../../../services/websocketService');
      const onProgress = (progress) => {
        if (agentId) {
          emitEvent('generation.progress', progress, { tenantId: finalTenantId, agentId });
        } else if (finalTenantId) {
          emitEvent('generation.progress', progress, { tenantId: finalTenantId });
        }
      };

      // Usa orquestrador único generate-and-validate.
      const result = await generateAndValidate(body, {
        tenantId: finalTenantId,
        userId,
        agent: req.agent, // Passa agente para verificação de super-admin
      }, onProgress);

      // Trata erro de rate limit no resultado.
      if (result.rateLimitExceeded) {
        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: result.errors[0] || 'Rate limit excedido',
          retryAfter: result.retryAfter,
        });
        return true;
      }

      // tenantPipeline safe-mode: non-critical errors -> 207 with warnings.
      const isTenantPipeline = body.tenantPipeline === true;
      if (isTenantPipeline && !result.success) {
        const originalErrors = Array.isArray(result.errors) ? result.errors : [];
        const safeWarnings = originalErrors.map((e) => ({
          type: 'TENANT_PIPELINE_NON_BLOCKING_ERROR',
          message: typeof e === 'string' ? e : String(e),
        }));
        const existingWarnings = Array.isArray(result.warnings) ? result.warnings : [];
        sendJson(res, 207, {
          ...result,
          success: true,
          tenantSafeMode: true,
          errors: [],
          warnings: [...existingWarnings, ...safeWarnings],
        });
      } else {
        sendJson(res, 200, result);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido.
        const retryAfter = (err.retryAfter && !isNaN(err.retryAfter) && err.retryAfter > 0)
          ? err.retryAfter
          : 60; // Fallback padrão de 60 segundos

        sendJson(res, 429, {
          error: 'rate_limit_exceeded',
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          retryAfter,
        });
      } else {
        logger.error('Erro em generate-and-validate:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno em generate-and-validate' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleSystemGenerationControlRoutes };
