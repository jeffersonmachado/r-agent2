/**
 * Flow Generation Routes Handler
 * Handles: POST /flows/generate, POST /flows/generate/dry-run
 * Manages: AI-driven flow generation, orchestration, audit logging
 */

async function handleFlowGenerationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    orchestrateGeneration,
    registerGeneration,
    generateAuditReport,
    STRICT_TENANT_MODE,
    requireAuth,
    requireTenant,
  } = deps;

  if (!pathname.startsWith('/flows/generate')) {
    return false;
  }

  if (method === 'POST' && pathname === '/flows/generate') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto valido');
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

      const result = await orchestrateGeneration(body, {
        tenantId: finalTenantId,
        autoResolveDependencies: body.autoResolveDependencies || false,
      });

      if (!result.success) {
        badRequest(res, result.error || 'Erro na orquestracao de geracao');
        return true;
      }

      if (result.metadata) {
        const auditId = await registerGeneration(result.metadata);
        result.metadata.auditId = auditId;
        const auditReport = await generateAuditReport({ ...result.metadata, auditId }, { format: 'json' });
        result.metadata.auditId = auditId;
        result.metadata.reportId = auditReport.reportId;
      }

      if (!result.validationWarnings) {
        const flowValidation = result?.validation?.flow || null;
        const validationErrors = Array.isArray(flowValidation?.errors) ? flowValidation.errors : [];
        const codes = validationErrors
          .map((errItem) => (errItem && (errItem.code || errItem.type)) ? String(errItem.code || errItem.type) : null)
          .filter(Boolean);

        result.validationWarnings = {
          valid: flowValidation?.valid !== false,
          errors: validationErrors,
          codes,
        };
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else if (err && (err.code === 'BAD_REQUEST' || err.code === 'VALIDATION_ERROR')) {
        sendJson(res, 400, { error: 'bad_request', message: err.message, details: err.details });
      } else if (err && err.code === 'NOT_FOUND') {
        sendJson(res, 404, { error: 'not_found', message: err.message });
      } else {
        logger.error('Erro ao gerar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno ao gerar fluxo' });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname === '/flows/generate/dry-run') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto valido');
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

      const result = await orchestrateGeneration(body, {
        tenantId: finalTenantId,
        dryRun: true,
      });

      if (!result.success) {
        badRequest(res, result.error || 'Erro na orquestracao de geracao (DRY-RUN)');
        return true;
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else if (err && (err.code === 'BAD_REQUEST' || err.code === 'VALIDATION_ERROR')) {
        sendJson(res, 400, { error: 'bad_request', message: err.message, details: err.details });
      } else if (err && err.code === 'NOT_FOUND') {
        sendJson(res, 404, { error: 'not_found', message: err.message });
      } else {
        logger.error('Erro no DRY-RUN de geracao:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno no DRY-RUN' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleFlowGenerationRoutes };
