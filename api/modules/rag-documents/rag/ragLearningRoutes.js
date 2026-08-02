const {
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureRagPermission,
  isRouteMatch,
  resolveScopedTenantId,
} = require('./ragRouteUtils');

async function handleRagLearningRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota de learning do RAG:');

  if (method === 'GET' && pathname.startsWith('/rag/learning/metrics/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: decodeURIComponent(pathname.slice('/rag/learning/metrics/'.length)) });
      if (scope.forbidden) return true;
      const metrics = await deps.ragService.getLearningMetrics(scope.tenantId);
      deps.sendJson(res, 200, metrics);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter métricas de aprendizado:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'POST', '/rag/learning/update-synonyms')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      const body = await deps.parseJsonBody(req);
      const { tenant_id, documents } = body;

      if (!tenant_id || !documents) {
        deps.sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id e documents são obrigatórios' });
        return true;
      }

      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: tenant_id });
      if (scope.forbidden) return true;
      const result = await deps.ragService.updateSynonymsFromDocuments(scope.tenantId, documents);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao atualizar sinônimos:' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/rag/learning/trigger-learning/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: decodeURIComponent(pathname.slice('/rag/learning/trigger-learning/'.length)) });
      if (scope.forbidden) return true;
      const result = await deps.ragService.triggerLearning(scope.tenantId);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao disparar aprendizado:' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/rag/learning/full-data/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: decodeURIComponent(pathname.slice('/rag/learning/full-data/'.length)) });
      if (scope.forbidden) return true;
      const result = await deps.ragService.getFullLearningData(scope.tenantId);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter dados completos de aprendizado:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'PUT', '/rag/learning/synonyms')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    try {
      const body = await deps.parseJsonBody(req);
      const { tenant_id, term, synonyms } = body;

      if (!tenant_id || !term || !synonyms) {
        deps.sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id, term e synonyms são obrigatórios' });
        return true;
      }

      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: tenant_id });
      if (scope.forbidden) return true;
      const result = await deps.ragService.updateSynonym(scope.tenantId, term, synonyms);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao atualizar sinônimo:' });
    }
    return true;
  }

  if (method === 'DELETE' && pathname.startsWith('/rag/learning/synonyms/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'delete' })) return true;

    try {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length < 5) {
        deps.sendJson(res, 400, { error: 'invalid_request', message: 'Caminho inválido' });
        return true;
      }

      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: decodeURIComponent(parts[3]) });
      if (scope.forbidden) return true;
      const term = decodeURIComponent(parts[4]);
      const result = await deps.ragService.deleteSynonym(scope.tenantId, term);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao remover sinônimo:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'GET', '/rag/learning/validation-rules')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const serviceUrl = deps.ragService.getRagServiceUrl(req.tenantId);
      deps.ragService.getRagTimeout(req.tenantId);

      const response = await fetch(`${serviceUrl}/rag/learning/validation-rules`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RAG learning service error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter regras de validação:' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/rag/learning/validation-rules/adapt/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: decodeURIComponent(pathname.slice('/rag/learning/validation-rules/adapt/'.length)) });
      if (scope.forbidden) return true;
      const tenantId = scope.tenantId;
      const serviceUrl = deps.ragService.getRagServiceUrl(tenantId);
      deps.ragService.getRagTimeout(tenantId);

      const response = await fetch(`${serviceUrl}/rag/learning/validation-rules/adapt/${tenantId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RAG learning service error: ${response.status} ${errorText}`);
      }

      const result = await response.json();
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao adaptar regras:' });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/rag/learning/clean-invalid-queries/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: decodeURIComponent(pathname.slice('/rag/learning/clean-invalid-queries/'.length)) });
      if (scope.forbidden) return true;
      const result = await deps.ragService.cleanInvalidQueries(scope.tenantId);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao limpar queries inválidas:' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleRagLearningRoutes,
};
