'use strict';

async function handleRagRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    isSuperAdmin,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
    logger,
    listDocuments,
    getDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    reindexDocument,
    reindexAllNotIndexed,
    getDocumentsStats,
    ragService,
  } = deps;

  if (!pathname.startsWith('/rag/')) {
    return false;
  }

  // GET /rag/documents - Lista documentos
  if (method === 'GET' && pathname === '/rag/documents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const filters = {
        tenantId,
        source: url.searchParams.get('source') || null,
        category: url.searchParams.get('category') || null,
        productId: url.searchParams.get('productId') || null,
        clientId: url.searchParams.get('clientId') || null,
        status: url.searchParams.get('status') || null,
        search: url.searchParams.get('search') || null,
      };

      const documents = listDocuments(filters);
      sendJson(res, 200, documents);
    } catch (err) {
      logger.error('Erro ao listar documentos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/health - Health do RAG (Node): compara BD vs vector store e retorna warning se inconsistente
  if (method === 'GET' && pathname === '/rag/health') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const tenantId = url.searchParams.get('tenantId')
        ? String(url.searchParams.get('tenantId')).trim()
        : (req.agent?.tenantId ? String(req.agent.tenantId).trim() : null);
      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const autoRepair = url.searchParams.get('autoRepair') === 'true';
      const { getRagHealth } = require('../services/ragDocumentsService');
      const health = await getRagHealth(tenantId, { autoRepair });
      sendJson(res, 200, health);
    } catch (err) {
      logger.error('Erro ao obter rag health:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao obter health do RAG',
      });
    }
    return true;
  }

  // GET /rag/deduplication/stats - Estatísticas de deduplicação
  if (method === 'GET' && pathname === '/rag/deduplication/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const { getDeduplicationStats } = require('../services/ragDeduplicationService');
      const stats = getDeduplicationStats(tenantId);

      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas de deduplicação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/documents/stats - Estatísticas de documentos
  if (method === 'GET' && pathname === '/rag/documents/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;
      const stats = await getDocumentsStats(tenantId);
      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/documents/:id - Obtém documento específico
  if (method === 'GET' && pathname.startsWith('/rag/documents/') && pathname !== '/rag/documents/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const document = getDocument(documentId);

      if (!document) {
        sendJson(res, 404, { error: 'document_not_found' });
        return true;
      }

      sendJson(res, 200, document);
    } catch (err) {
      logger.error('Erro ao obter documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/documents - Cria documento
  if (method === 'POST' && pathname === '/rag/documents') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const tenantId = body.tenantId || req.tenantId;
      const result = await createDocument(body, tenantId);

      if (!result.success) {
        sendJson(res, 400, { error: 'creation_failed', message: result.error });
        return true;
      }

      // Se é duplicata, retorna 200 (OK) ao invés de 201 (Created)
      if (result.isDuplicate) {
        logger.info('[RAGDocuments] Documento duplicado detectado no endpoint', {
          documentId: result.document.id,
          tenantId,
          isDuplicate: true
        });

        sendJson(res, 200, {
          ...result.document,
          isDuplicate: true,
          message: result.existingDocument ? 'Documento já existe (duplicado detectado)' : 'Documento duplicado',
        });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_create',
        resource: 'rag_document',
        resourceId: result.document.id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar documento:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // PUT /rag/documents/:id - Atualiza documento
  if (method === 'PUT' && pathname.startsWith('/rag/documents/') && !pathname.endsWith('/reindex')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const body = await parseJsonBody(req);
      const result = await updateDocument(documentId, body);

      if (!result.success) {
        sendJson(res, 400, { error: 'update_failed', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_update',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.document);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar documento:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message });
      }
    }
    return true;
  }

  // DELETE /rag/documents/:id - Deleta documento
  if (method === 'DELETE' && pathname.startsWith('/rag/documents/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length));
      const result = await deleteDocument(documentId);

      if (!result.success) {
        sendJson(res, 400, { error: 'delete_failed', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_delete',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao deletar documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/documents/:id/reindex - Reindexa documento
  if (method === 'POST' && pathname.startsWith('/rag/documents/') && pathname.endsWith('/reindex')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const documentId = decodeURIComponent(pathname.slice('/rag/documents/'.length).replace('/reindex', ''));
      const result = await reindexDocument(documentId);

      if (!result.success) {
        sendJson(res, 400, { error: 'reindex_failed', message: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_document_reindex',
        resource: 'rag_document',
        resourceId: documentId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, {
        success: true,
        chunksCreated: result.chunksCreated,
      });
    } catch (err) {
      logger.error('Erro ao reindexar documento:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/documents/reindex-all - Reindexa todos os documentos não indexados
  if (method === 'POST' && pathname === '/rag/documents/reindex-all') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      let tenantId = null;
      // Body é opcional - se fornecido, parseia
      let includeInconsistent = false;
      if (hasJsonContentType(req) && req.headers['content-length'] && parseInt(req.headers['content-length']) > 0) {
        const body = await parseJsonBody(req);
        tenantId = body?.tenantId || null;
        includeInconsistent = body?.includeInconsistent === true;
      }

      const result = await reindexAllNotIndexed(tenantId, includeInconsistent);

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_documents_reindex_all',
        resource: 'rag_documents',
        resourceId: 'all',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao reindexar documentos em lote:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/ephemeral/context - Persiste contexto efêmero com TTL para dry-run
  if (method === 'POST' && pathname === '/rag/ephemeral/context') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { requireExecutionId } = require('../middleware/requireExecutionId');
      const executionId = requireExecutionId(body, res, badRequest);
      if (!executionId) {
        return true;
      }

      const requestedTenantId = body?.tenantId ? String(body.tenantId).trim() : '';
      const authenticatedTenantId = authResult.agent?.tenantId ? String(authResult.agent.tenantId).trim() : '';
      const isSuperAdminUser = isSuperAdmin(req.agent);
      const tenantId = isSuperAdminUser && requestedTenantId
        ? requestedTenantId
        : authenticatedTenantId;

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const { upsertEphemeralContext } = require('../services/ephemeralRagContextService');
      const result = await upsertEphemeralContext({
        tenantId,
        executionId,
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        ttlSeconds: body?.ttlSeconds,
        replace: body?.replace === true,
      });

      sendJson(res, 200, {
        ok: true,
        tenantId,
        executionId,
        ...result,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao persistir contexto efêmero RAG:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro ao persistir contexto efêmero' });
      }
    }
    return true;
  }

  // POST /rag/query - Faz uma pergunta ao sistema RAG
  if (method === 'POST' && pathname === '/rag/query') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'query');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { query, tenantId, options = {} } = body;

      if (!query || !query.trim()) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Query não pode ser vazia' });
        return true;
      }

      // Obtém tenantId do body ou do agente autenticado
      const finalTenantId = tenantId || req.tenantId;

      // Prepara filtros (pode ser expandido no futuro)
      const filters = {
        topK: options.topK || 6,  // Aumentado de 5 para 6 para melhor cobertura
        minScore: options.minScore || 0.45,  // Reduzido de 0.5 para 0.45 para melhor taxa de sucesso
        maxTokens: options.maxTokens || 1000,
      };

      const result = await ragService.queryRag(query, finalTenantId, {}, filters);

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_query',
        resource: 'rag',
        resourceId: 'query',
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao consultar RAG:', {
        error: err.message,
        stack: err.stack,
        originalError: err.originalError?.message,
      });

      // Melhora mensagens de erro para o usuário
      let errorMessage = err.message || 'Erro desconhecido ao consultar RAG';

      // Se o erro original contém informações sobre o serviço não estar disponível
      if (err.message && (err.message.includes('não está acessível') || err.message.includes('não encontrado'))) {
        errorMessage = err.message;
      } else if (err.originalError) {
        errorMessage = err.originalError.message || errorMessage;
      }

      sendJson(res, 500, {
        error: 'internal_error',
        message: errorMessage,
        success: false
      });
    }
    return true;
  }

  // GET /rag/learning/metrics/:tenantId - Obtém métricas de aprendizado
  if (method === 'GET' && pathname.startsWith('/rag/learning/metrics/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/metrics/'.length));
      const metrics = await ragService.getLearningMetrics(tenantId);
      sendJson(res, 200, metrics);
    } catch (err) {
      logger.error('Erro ao obter métricas de aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/update-synonyms - Atualiza sinônimos baseado em documentos
  if (method === 'POST' && pathname === '/rag/learning/update-synonyms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { tenant_id, documents } = body;

      if (!tenant_id || !documents) {
        sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id e documents são obrigatórios' });
        return true;
      }

      const result = await ragService.updateSynonymsFromDocuments(tenant_id, documents);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar sinônimos:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/trigger-learning/:tenantId - Dispara aprendizado completo
  if (method === 'POST' && pathname.startsWith('/rag/learning/trigger-learning/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/trigger-learning/'.length));
      const result = await ragService.triggerLearning(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao disparar aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/learning/full-data/:tenantId - Obtém todos os dados de aprendizado
  if (method === 'GET' && pathname.startsWith('/rag/learning/full-data/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/full-data/'.length));
      const result = await ragService.getFullLearningData(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao obter dados completos de aprendizado:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // PUT /rag/learning/synonyms - Atualiza sinônimo específico
  if (method === 'PUT' && pathname === '/rag/learning/synonyms') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { tenant_id, term, synonyms } = body;

      if (!tenant_id || !term || !synonyms) {
        sendJson(res, 400, { error: 'invalid_request', message: 'tenant_id, term e synonyms são obrigatórios' });
        return true;
      }

      const result = await ragService.updateSynonym(tenant_id, term, synonyms);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao atualizar sinônimo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // DELETE /rag/learning/synonyms/:tenantId/:term - Remove sinônimo específico
  if (method === 'DELETE' && pathname.startsWith('/rag/learning/synonyms/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/').filter(p => p);
      if (parts.length < 5) {
        sendJson(res, 400, { error: 'invalid_request', message: 'Caminho inválido' });
        return true;
      }

      const tenantId = decodeURIComponent(parts[3]);
      const term = decodeURIComponent(parts[4]);

      const result = await ragService.deleteSynonym(tenantId, term);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover sinônimo:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/learning/validation-rules - Obtém regras de validação
  if (method === 'GET' && pathname === '/rag/learning/validation-rules') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const serviceUrl = ragService.getRagServiceUrl(req.tenantId);
      const timeout = ragService.getRagTimeout(req.tenantId);

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
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao obter regras de validação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/validation-rules/adapt/:tenantId - Dispara adaptação de regras
  if (method === 'POST' && pathname.startsWith('/rag/learning/validation-rules/adapt/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/validation-rules/adapt/'.length));
      const serviceUrl = ragService.getRagServiceUrl(tenantId);
      const timeout = ragService.getRagTimeout(tenantId);

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
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao adaptar regras:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // POST /rag/learning/clean-invalid-queries/:tenantId - Remove queries inválidas
  if (method === 'POST' && pathname.startsWith('/rag/learning/clean-invalid-queries/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const tenantId = decodeURIComponent(pathname.slice('/rag/learning/clean-invalid-queries/'.length));
      const result = await ragService.cleanInvalidQueries(tenantId);
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao limpar queries inválidas:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // GET /rag/domains - Obtém configuração de domínios RAG para o tenant
  if (method === 'GET' && pathname === '/rag/domains') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'rag', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      // Obtém tenantId do agente autenticado ou do query param
      const queryParams = new URLSearchParams(req.url.split('?')[1] || '');
      const tenantIdParam = queryParams.get('tenantId');
      const finalTenantId = tenantIdParam || req.tenantId;

      // Obtém configuração de domínios
      const domains = ragService.getRagDomains(finalTenantId);

      // Adiciona informações detalhadas para cada domínio
      const domainsInfo = {
        tenantId: finalTenantId,
        domains: {
          chatbot: {
            ...domains.chatbot,
            enabled: ragService.isRagDomainEnabled(finalTenantId, 'chatbot'),
            sources: ragService.getRagDomainSources(finalTenantId, 'chatbot'),
          },
          rpa: {
            ...domains.rpa,
            enabled: ragService.isRagDomainEnabled(finalTenantId, 'rpa'),
            sources: ragService.getRagDomainSources(finalTenantId, 'rpa'),
          },
        },
      };

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'rag_domains_read',
        resource: 'rag_domains',
        resourceId: finalTenantId,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, domainsInfo);
    } catch (err) {
      logger.error('Erro ao obter configuração de domínios RAG:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message,
      });
    }
    return true;
  }

  return false;
}

module.exports = { handleRagRoutes };
