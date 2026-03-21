const { createInternalErrorResponder, ensureJsonRequest, ensureRagPermission, isRouteMatch, logRagAction } = require('./ragRouteUtils');

async function handleRagQueryRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota de consulta do RAG:');

  if (!isRouteMatch(method, pathname, 'POST', '/rag/query')) {
    return false;
  }

  if (!ensureRagPermission({ req, res, deps, permission: 'query' })) return true;
  if (!ensureJsonRequest({ req, res, deps })) return true;

  try {
    const body = await deps.parseJsonBody(req);
    const { query, tenantId, options = {} } = body;

    if (!query || !query.trim()) {
      deps.sendJson(res, 400, { error: 'invalid_request', message: 'Query não pode ser vazia' });
      return true;
    }

    const finalTenantId = tenantId || req.tenantId;
    const filters = {
      topK: options.topK || 6,
      minScore: options.minScore || 0.45,
      maxTokens: options.maxTokens || 1000,
    };

    const result = await deps.ragService.queryRag(query, finalTenantId, {}, filters);
    logRagAction({
      req,
      deps,
      action: 'rag_query',
      resource: 'rag',
      resourceId: 'query',
    });

    deps.sendJson(res, 200, result);
  } catch (err) {
    deps.logger.error('Erro ao consultar RAG:', {
      error: err.message,
      stack: err.stack,
      originalError: err.originalError?.message,
    });

    let errorMessage = err.message || 'Erro desconhecido ao consultar RAG';
    if (err.message && (err.message.includes('não está acessível') || err.message.includes('não encontrado'))) {
      errorMessage = err.message;
    } else if (err.originalError) {
      errorMessage = err.originalError.message || errorMessage;
    }

    deps.sendJson(res, 500, {
      error: 'internal_error',
      message: errorMessage,
      success: false,
    });
  }

  return true;
}

module.exports = {
  handleRagQueryRoutes,
};
