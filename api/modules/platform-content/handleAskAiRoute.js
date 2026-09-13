'use strict';

/**
 * Rota "Perguntar à IA" (assistente global, disponível em todas as telas).
 *
 * POST /api/ask-ai
 * Body: {
 *   question: string,
 *   conversationId?: string,
 *   context?: { route?, module?, pageType?, actionContext?, entityType?, entityId?, workspaceEntityId? }
 * }
 * Resposta: {
 *   success, answer, sources, facts, intent, confidence, conversationId,
 *   provenance, context: { entityValidated }, tenantId
 * }
 *
 * O copiloto é multi-turno (conversa persistida por tenant+usuário), consulta
 * dados operacionais vivos via ferramentas registradas (read-only, com RBAC) e
 * combina com conhecimento operacional (RAG OPERATIONAL: global ∪ tenant).
 * Conteúdo técnico interno (domínio SYSTEM) nunca é acessível a um ator
 * PRODUCTION.
 *
 * Preservado integralmente: autenticação, permissão `rag:query`, tenant
 * isolation, rate limit e auditoria obrigatória fail-closed.
 */

const { normalizeAskAiPayload } = require('../../services/askAi/contextContract');
const { runAskAiTurn } = require('../../services/askAi/orchestrator');

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

  // Injeção do orquestrador para testes de boundary; produção usa o real.
  const runTurn = deps.runAskAiTurn || runAskAiTurn;

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
    const payloadResult = normalizeAskAiPayload(body);
    if (!payloadResult.ok) {
      badRequest(res, payloadResult.message);
      return true;
    }
    const payload = payloadResult.value;

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

    const turn = await runTurn({
      payload,
      tenantId,
      actor: req.agent,
      deps: { ragService },
    });

    // Normaliza para um contrato estável consumido pelo widget.
    sendJson(res, 200, {
      success: true,
      conversationId: turn.conversationId,
      answer: turn.answer,
      sources: turn.sources,
      facts: turn.facts,
      intent: turn.intent,
      confidence: turn.confidence,
      provenance: turn.provenance,
      // Leitura defensiva: um turno válido sem `policy` degrada o contexto
      // para "não validado" em vez de derrubar a resposta em 500.
      context: { entityValidated: turn.policy?.entityValidated === true },
      tenantId,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      badRequest(res, 'JSON inválido no corpo da requisição');
      return true;
    }
    if (error?.code === 'NOT_FOUND') {
      sendJson(res, 404, {
        success: false,
        error: 'conversation_not_found',
        answer: null,
        message: 'Conversa não encontrada. Inicie uma nova conversa.',
      });
      return true;
    }
    if (error?.code === 'PERSISTENCE_REQUIRED') {
      logger.error('Persistência obrigatória indisponível para a pergunta à IA', { error: error.message });
      sendJson(res, 503, {
        success: false,
        error: 'persistence_required',
        answer: null,
        message: 'Estado conversacional/auditoria indisponível; a pergunta não pode ser concluída agora.',
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
