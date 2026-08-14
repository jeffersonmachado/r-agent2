const {
  canHandlePrefix,
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureRagPermission,
  isRouteMatch,
  logRagAction,
  resolveScopedTenantId,
  sendRagApiError,
} = require('./ragRouteUtils');

async function handleRagOperationsRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota operacional do RAG:');

  if (isRouteMatch(method, pathname, 'GET', '/rag/health')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const requestedTenantId = url.searchParams.get('tenantId')
        ? String(url.searchParams.get('tenantId')).trim()
        : null;
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId });
      if (scope.forbidden) return true;
      const tenantId = scope.tenantId;
      if (!tenantId) {
        deps.badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const autoRepair = url.searchParams.get('autoRepair') === 'true';
      const health = await deps.ragDocumentsService.getRagHealth(tenantId, { autoRepair });
      deps.sendJson(res, 200, health);
    } catch (err) {
      return sendRagApiError(req, res, deps, {
        code: 'INTERNAL_ERROR',
        message: 'Erro ao obter health do RAG',
        httpStatus: 500,
        retryable: true,
      }, 'Erro ao obter rag health:', err);
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'POST', '/rag/documents/clean-orphans')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    try {
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;

      const body = await deps.parseJsonBody(req);
      const { documentIds } = body || {};

      if (Array.isArray(documentIds) && documentIds.length > 0) {
        const result = await deps.ragDocumentsService.cleanOrphanedDocuments(tenantId, documentIds.map(String));
        deps.sendJson(res, 200, result);
        return true;
      }

      const result = await deps.ragDocumentsService.detectAndCleanOrphanedVectorDocuments(tenantId);
      deps.sendJson(res, 200, result);
    } catch (err) {
      return sendRagApiError(req, res, deps, {
        code: 'INTERNAL_ERROR',
        message: 'Erro ao limpar documentos órfãos do vector store',
        httpStatus: 500,
        retryable: true,
      }, 'Erro ao limpar documentos órfãos:', err);
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'GET', '/rag/deduplication/stats')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;

      const stats = await deps.ragDeduplicationService.getDeduplicationStats(tenantId);
      deps.sendJson(res, 200, stats);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter estatísticas de deduplicação:' });
    }
    return true;
  }

  if (canHandlePrefix(method, pathname, 'POST', '/rag/documents/') && pathname.endsWith('/reindex')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length).replace('/reindex', ''));
      const result = await deps.reindexDocument(documentId, tenantId);

      if (!result.success) {
        if (result.errorCode === 'document_not_found') {
          deps.sendJson(res, 404, { error: 'document_not_found', message: 'Documento não encontrado' });
          return true;
        }
        if (result.errorCode === 'PERSISTENCE_REQUIRED') {
          deps.sendJson(res, 503, {
            error: 'persistence_required',
            message: 'Persistência PostgreSQL indisponível',
          });
          return true;
        }
        return sendRagApiError(req, res, deps, {
          code: result.errorCode || 'RAG_INDEX_FAILED',
          message: result.error || 'Falha ao reindexar documento no RAG',
          httpStatus: 500,
          retryable: true,
          details: { documentId, tenantId: req.tenantId || req.agent?.tenantId || null },
        }, 'Erro ao reindexar documento:', new Error(result.error || 'Falha ao reindexar documento'));
      }

      logRagAction({
        req,
        deps,
        action: 'rag_document_reindex',
        resource: 'rag_document',
        resourceId: documentId,
      });

      deps.sendJson(res, 200, {
        success: true,
        chunksCreated: result.chunksCreated,
      });
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao reindexar documento:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'POST', '/rag/documents/reindex-all')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      let requestedTenantId = null;
      let includeInconsistent = false;
      if (deps.hasJsonContentType(req) && req.headers['content-length'] && parseInt(req.headers['content-length'], 10) > 0) {
        const body = await deps.parseJsonBody(req);
        requestedTenantId = body?.tenantId || null;
        includeInconsistent = body?.includeInconsistent === true;
      }

      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId });
      if (scope.forbidden) return true;
      const result = await deps.reindexAllNotIndexed(scope.tenantId, includeInconsistent);
      logRagAction({
        req,
        deps,
        action: 'rag_documents_reindex_all',
        resource: 'rag_documents',
        resourceId: 'all',
      });

      deps.sendJson(res, 200, result);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao reindexar documentos em lote:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'POST', '/rag/reindex-all')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: url.searchParams.get('tenantId') });
      if (scope.forbidden) return true;
      const tenantId = scope.tenantId || deps.requireTenant(req, res);
      if (!tenantId) return true;

      const result = await deps.ragDocumentsService.reindexAllTenant(String(tenantId));
      deps.sendJson(res, 200, result);
    } catch (err) {
      return sendRagApiError(req, res, deps, {
        code: 'RAG_REINDEX_ALL_FAILED',
        message: 'Erro ao reindexar tenant',
        httpStatus: 500,
        retryable: true,
      }, 'Erro ao reindexar tenant:', err);
    }
    return true;
  }

  return false;
}

module.exports = {
  handleRagOperationsRoutes,
};
