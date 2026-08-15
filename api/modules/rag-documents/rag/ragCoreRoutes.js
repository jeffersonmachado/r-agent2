const {
  canHandlePrefix,
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureRagPermission,
  isRouteMatch,
  logRagAction,
  resolveScopedTenantId,
} = require('./ragRouteUtils');
const { getClassificationForAgent } = require('../../agent-os/experience-segregation');

const SENSITIVITY_BY_CLASSIFICATION = Object.freeze({
  PRODUCTION: Object.freeze(['PUBLIC', 'INTERNAL']),
  SUPPORT: Object.freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL']),
  DEVELOPMENT: Object.freeze(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']),
});

async function handleRagCoreRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota core do RAG:');

  if (isRouteMatch(method, pathname, 'GET', '/rag/documents')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;

      const filters = {
        tenantId,
        source: url.searchParams.get('source') || null,
        category: url.searchParams.get('category') || null,
        productId: url.searchParams.get('productId') || null,
        clientId: url.searchParams.get('clientId') || null,
        status: url.searchParams.get('status') || null,
        search: url.searchParams.get('search') || null,
        limit: url.searchParams.get('limit') || null,
        offset: url.searchParams.get('offset') || null,
      };

      deps.sendJson(res, 200, await deps.listDocuments(filters));
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao listar documentos:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'GET', '/rag/documents/stats')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;

      const stats = await deps.getDocumentsStats(tenantId);
      deps.sendJson(res, 200, stats);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter estatísticas:' });
    }
    return true;
  }

  if (canHandlePrefix(method, pathname, 'GET', '/rag/documents/') && pathname !== '/rag/documents/stats') {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      if (pathname.endsWith('/download')) {
        const tenantId = deps.requireTenant(req, res);
        if (!tenantId) return true;

        const rawId = decodeURIComponent(pathname.slice('/rag/documents/'.length).replace(/\/download$/, ''));
        const fileRow = await deps.ragDocumentsService.getDocumentFileFromDb(rawId, tenantId);
        if (!fileRow || !fileRow.data) {
          deps.sendJson(res, 404, { error: 'file_not_found', message: 'Arquivo original não encontrado no banco de dados' });
          return true;
        }

        const filename = (fileRow.filename || `documento-${rawId}`).replace(/[\r\n"]/g, '_');
        const mimeType = fileRow.mimeType || 'application/octet-stream';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        if (Number.isFinite(fileRow.sizeBytes)) {
          res.setHeader('Content-Length', String(fileRow.sizeBytes));
        }
        res.writeHead(200);
        res.end(fileRow.data);
        return true;
      }

      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;

      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const document = await deps.ragDocumentsService.getDocumentWithContent(documentId, tenantId);

      if (!document || (document.tenantId && document.tenantId !== tenantId)) {
        deps.sendJson(res, 404, { error: 'document_not_found' });
        return true;
      }

      try {
        const meta = document.metadata || {};
        const looksLikeFileUpload = meta.source === 'file' || !!meta.fileName || !!meta.filename;
        if (looksLikeFileUpload && (!meta.originalBinary || meta.originalBinary.stored !== true)) {
          const fileRow = await deps.ragDocumentsService.getDocumentFileFromDb(documentId, tenantId);
          if (fileRow && fileRow.data) {
            document.metadata = {
              ...meta,
              originalBinary: {
                stored: true,
                filename: fileRow.filename || meta.fileName || meta.filename || null,
                mimeType: fileRow.mimeType || meta.mime || meta.fileType || null,
                sizeBytes: Number.isFinite(fileRow.sizeBytes) ? fileRow.sizeBytes : null,
              },
            };
          }
        }
      } catch {
        // best-effort
      }

      deps.sendJson(res, 200, document);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter documento:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'POST', '/rag/documents')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'create' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    try {
      const body = await deps.parseJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        deps.badRequest(res, 'Corpo JSON deve ser um objeto');
        return true;
      }
      if (body && Object.prototype.hasOwnProperty.call(body, 'id')) {
        deps.badRequest(res, 'O campo id é gerado pelo servidor e não pode ser informado');
        return true;
      }
      // Segregação de domínios (docs/rag/domain-segregation.md §6): esta rota
      // é o pipeline OPERACIONAL — o cliente nunca declara domínio nem
      // classificação; qualquer valor forjado no payload é ignorado e o
      // servidor fixa OPERATIONAL/PRODUCTION. Ingestão SYSTEM só acontece
      // via endpoint interno do rag-service (token serviço-a-serviço).
      const actorClassification = String(
        req.agent?.classification || getClassificationForAgent(req.agent) || 'PRODUCTION'
      ).toUpperCase();
      const requestedSensitivity = String(body?.sensitivity || 'INTERNAL').trim().toUpperCase();
      const allowedSensitivities = SENSITIVITY_BY_CLASSIFICATION[actorClassification]
        || SENSITIVITY_BY_CLASSIFICATION.PRODUCTION;
      if (!allowedSensitivities.includes(requestedSensitivity)) {
        deps.sendJson(res, 403, { error: 'sensitivity_not_allowed', message: 'Sensibilidade do documento não autorizada para este perfil' });
        return true;
      }
      body.domain = 'OPERATIONAL';
      body.classification = 'PRODUCTION';
      body.sensitivity = requestedSensitivity;
      const requestTenantId = req.tenantId || req.agent?.tenantId || null;
      const isSuperAdminUser = deps.isSuperAdmin(req.agent);

      if (body && body.tenantId) {
        const bodyTenantId = String(body.tenantId).trim();
        if (requestTenantId && bodyTenantId && bodyTenantId !== String(requestTenantId)) {
          deps.badRequest(res, 'tenantId no body não é permitido (use X-Tenant-Id).');
          return true;
        }
        try { delete body.tenantId; } catch {}
      }

      const rawPersistTenantId = body?.persistTenantId || body?.targetTenantId || null;
      if (rawPersistTenantId && !isSuperAdminUser) {
        deps.sendJson(res, 403, { error: 'forbidden', message: 'persistTenantId é permitido apenas para super-admin' });
        return true;
      }
      if (rawPersistTenantId) {
        try { delete body.persistTenantId; } catch {}
        try { delete body.targetTenantId; } catch {}
      }

      const persistTenantId = rawPersistTenantId ? String(rawPersistTenantId).trim() : null;
      const finalTenantId = persistTenantId || requestTenantId;
      if (!finalTenantId) {
        deps.sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }

      const result = await deps.createDocument(body, finalTenantId);
      if (!result.success) {
        const persistenceUnavailable = result.errorCode === 'PERSISTENCE_REQUIRED';
        deps.sendJson(res, persistenceUnavailable ? 503 : 400, {
          error: persistenceUnavailable ? 'persistence_required' : (result.errorCode || 'creation_failed'),
          message: persistenceUnavailable ? 'Persistência PostgreSQL indisponível' : result.error,
        });
        return true;
      }

      if (result.indexing && result.indexing.attempted && result.indexing.success === false) {
        logRagAction({
          req,
          deps,
          action: 'rag_document_create_index_failed',
          resource: 'rag_document',
          resourceId: result.document.id,
        });

        deps.sendJson(res, 207, {
          ...result.document,
          indexing: result.indexing,
        });
        return true;
      }

      if (result.isDuplicate) {
        deps.logger.info('[RAGDocuments] Documento duplicado detectado no endpoint', {
          documentId: result.document.id,
          tenantId: finalTenantId,
          isDuplicate: true,
        });

        deps.sendJson(res, 200, {
          ...result.document,
          isDuplicate: true,
          message: result.existingDocument ? 'Documento já existe (duplicado detectado)' : 'Documento duplicado',
        });
        return true;
      }

      logRagAction({
        req,
        deps,
        action: 'rag_document_create',
        resource: 'rag_document',
        resourceId: result.document.id,
      });

      deps.sendJson(res, 201, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        return respondInternalError(err, { loggerMessage: 'Erro ao criar documento:' });
      }
    }
    return true;
  }

  if (canHandlePrefix(method, pathname, 'PUT', '/rag/documents/') && !pathname.endsWith('/reindex')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'update' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    try {
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const body = await deps.parseJsonBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        deps.badRequest(res, 'Corpo JSON deve ser um objeto');
        return true;
      }
      const currentDocument = await deps.ragDocumentsService.getDocumentWithContent(documentId, tenantId);
      if (!currentDocument) {
        deps.sendJson(res, 404, { error: 'document_not_found' });
        return true;
      }
      // Segregação de domínios (docs/rag/domain-segregation.md §6): domain e
      // classification nunca são alterados por esta rota (pipeline OPERACIONAL;
      // promoção SYSTEM → OPERATIONAL exige novo artefato, nunca troca de
      // metadado in-place). Valores forjados no payload são descartados.
      try { delete body.domain; } catch {}
      try { delete body.classification; } catch {}
      if (Object.prototype.hasOwnProperty.call(body || {}, 'sensitivity')) {
        const actorClassification = String(
          req.agent?.classification || getClassificationForAgent(req.agent) || 'PRODUCTION'
        ).toUpperCase();
        const requestedSensitivity = String(
          body.sensitivity || currentDocument.sensitivity || 'INTERNAL'
        ).trim().toUpperCase();
        const allowedSensitivities = SENSITIVITY_BY_CLASSIFICATION[actorClassification]
          || SENSITIVITY_BY_CLASSIFICATION.PRODUCTION;
        if (!allowedSensitivities.includes(requestedSensitivity)) {
          deps.sendJson(res, 403, { error: 'sensitivity_not_allowed', message: 'Sensibilidade do documento não autorizada para este perfil' });
          return true;
        }
        body.sensitivity = requestedSensitivity;
      }
      const result = await deps.updateDocument(documentId, body, tenantId);

      if (!result.success) {
        const status = result.errorCode === 'document_not_found'
          ? 404
          : (result.errorCode === 'PERSISTENCE_REQUIRED' ? 503 : 500);
        deps.sendJson(res, status, {
          error: result.errorCode === 'PERSISTENCE_REQUIRED' ? 'persistence_required' : (result.errorCode || 'update_failed'),
          message: result.errorCode === 'PERSISTENCE_REQUIRED' ? 'Persistência PostgreSQL indisponível' : result.error,
        });
        return true;
      }

      logRagAction({
        req,
        deps,
        action: 'rag_document_update',
        resource: 'rag_document',
        resourceId: documentId,
      });

      deps.sendJson(res, 200, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        return respondInternalError(err, { loggerMessage: 'Erro ao atualizar documento:' });
      }
    }
    return true;
  }

  if (canHandlePrefix(method, pathname, 'DELETE', '/rag/documents/')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'delete' })) return true;

    try {
      const tenantId = deps.requireTenant(req, res);
      if (!tenantId) return true;
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const result = await deps.deleteDocument(documentId, tenantId);

      if (!result.success) {
        const status = result.errorCode === 'document_not_found'
          ? 404
          : (result.errorCode === 'PERSISTENCE_REQUIRED' ? 503 : 400);
        deps.sendJson(res, status, {
          error: result.errorCode === 'PERSISTENCE_REQUIRED' ? 'persistence_required' : (result.errorCode || 'delete_failed'),
          message: result.errorCode === 'PERSISTENCE_REQUIRED' ? 'Persistência PostgreSQL indisponível' : result.error,
        });
        return true;
      }

      logRagAction({
        req,
        deps,
        action: 'rag_document_delete',
        resource: 'rag_document',
        resourceId: documentId,
      });

      deps.sendJson(res, 200, { success: true });
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao deletar documento:' });
    }
    return true;
  }

  if (isRouteMatch(method, pathname, 'GET', '/rag/domains')) {
    if (!ensureRagPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const queryParams = new URLSearchParams(req.url.split('?')[1] || '');
      const scope = resolveScopedTenantId({ req, res, deps, requestedTenantId: queryParams.get('tenantId') });
      if (scope.forbidden) return true;
      const finalTenantId = scope.tenantId;
      const domains = deps.ragService.getRagDomains(finalTenantId);

      const domainsInfo = {
        tenantId: finalTenantId,
        domains: {
          chatbot: {
            ...domains.chatbot,
            enabled: deps.ragService.isRagDomainEnabled(finalTenantId, 'chatbot'),
            sources: deps.ragService.getRagDomainSources(finalTenantId, 'chatbot'),
          },
          rpa: {
            ...domains.rpa,
            enabled: deps.ragService.isRagDomainEnabled(finalTenantId, 'rpa'),
            sources: deps.ragService.getRagDomainSources(finalTenantId, 'rpa'),
          },
        },
      };

      logRagAction({
        req,
        deps,
        action: 'rag_domains_read',
        resource: 'rag_domains',
        resourceId: finalTenantId,
      });

      deps.sendJson(res, 200, domainsInfo);
    } catch (err) {
      return respondInternalError(err, { loggerMessage: 'Erro ao obter configuração de domínios RAG:' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleRagCoreRoutes,
};
