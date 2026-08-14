'use strict';

/**
 * Rota "Perguntar à IA" (assistente global, disponível em todas as telas).
 *
 * POST /api/ask-ai
 * Body: { question: string, context?: object }
 * Resposta: { success, answer, sources, confidence, tenantId, fromCache? }
 *
 * Reutiliza o RAG governado: tenant-scoped, domínio resolvido pela identidade
 * do ator (nunca pelo texto da pergunta), com cache e aprendizado adaptativo.
 */

module.exports = { handleAskAiRoute };

async function handleAskAiRoute({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    checkRateLimit,
    logActionRequired,
    ragService,
    logger,
  } = deps;

  // Forma positiva deliberada: além de legível, permite ao scanner canônico de
  // inventário registrar esta superfície HTTP.
  if (!(method === 'POST' && pathname === '/api/ask-ai')) {
    return false;
  }

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const permissionResult = requirePermission(req, 'rag', 'query');
  if (!permissionResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permissionResult.error });
    return true;
  }

  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;

    const rateLimitResult = await checkRateLimit({
      userId: `ask-ai:${tenantId}:${req.agent?.id || 'unknown'}`,
      operationType: 'GENERATION_REAL',
    });
    if (!rateLimitResult.allowed) {
      const retryAfter = rateLimitResult.retryAfter || 60;
      res.setHeader('Retry-After', retryAfter);
      sendJson(res, 429, { error: 'rate_limit_exceeded', retryAfter });
      return true;
    }

    const body = await parseJsonBody(req);
    if (!body || typeof body.question !== 'string') {
      badRequest(res, 'Campo "question" é obrigatório e deve ser uma string não vazia');
      return true;
    }
    const question = body.question.trim();
    if (!question) {
      badRequest(res, 'Campo "question" é obrigatório e deve ser uma string não vazia');
      return true;
    }
    if (question.length > 2000) {
      badRequest(res, 'Pergunta muito longa (máximo 2000 caracteres)');
      return true;
    }

    if (typeof logActionRequired !== 'function') {
      const auditError = new Error('audit_persistence_required');
      auditError.code = 'PERSISTENCE_REQUIRED';
      throw auditError;
    }
    await logActionRequired({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId,
      action: 'rag_query',
      resource: 'rag',
      resourceId: 'ask-ai',
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    const result = await ragService.queryRag(question, tenantId, { actor: req.agent }, {
      topK: 6,
      minScore: 0.45,
      maxTokens: 1000,
    });

    // Normaliza para um contrato estável consumido pelo widget.
    sendJson(res, 200, {
      success: result?.success === true,
      answer: result?.response || result?.answer || 'Não consegui encontrar uma resposta.',
      sources: Array.isArray(result?.sources) ? result.sources : [],
      confidence: Number.isFinite(result?.confidence) ? result.confidence : null,
      fromCache: !!result?.fromCache,
      tenantId,
      error: result?.error || null,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      badRequest(res, 'JSON inválido no corpo da requisição');
      return true;
    }
    if (error?.code === 'PERSISTENCE_REQUIRED') {
      logger.error('Auditoria durável indisponível para pergunta à IA', { error: error.message });
      sendJson(res, 503, {
        success: false,
        error: 'persistence_required',
        answer: null,
        message: 'Auditoria durável indisponível; a pergunta não pode ser concluída agora.',
      });
      return true;
    }
    logger.error('Erro ao processar pergunta à IA:', {
      error: error.message,
      stack: error.stack,
    });
    sendJson(res, 500, {
      success: false,
      error: 'internal_error',
      answer: null,
      message: 'Não foi possível processar a pergunta agora. Tente novamente.',
    });
  }

  return true;
}
