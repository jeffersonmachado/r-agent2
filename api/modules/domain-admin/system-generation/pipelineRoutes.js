async function handleSystemPipelineRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    getAIConfig,
    getDecryptedAPIKey,
  } = deps;

  if (!(method === 'POST' && pathname === '/system/pipeline/validate-prereqs')) {
    return false;
  }

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const body = await parseJsonBody(req);
    const { requireExecutionId } = require('../../../middleware/requireExecutionId');
    const executionId = requireExecutionId(body, res, badRequest);
    if (!executionId) {
      return true;
    }

    const tenantId = (authResult.agent?.tenantId && String(authResult.agent.tenantId).trim())
      ? String(authResult.agent.tenantId).trim()
      : null;
    if (!tenantId) {
      sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente para validar pré-requisitos do pipeline' });
      return true;
    }

    const { ensureExecutionContext, updateStage, updateStatus } = require('../../../services/pipelineExecutionContext');
    const { checkRagServiceStatus } = require('../../../services/systemStatusService');

    const pipelineExecution = ensureExecutionContext(
      { executionId, tenantId, useRag: body?.useRag === true },
      { tenantId }
    );
    updateStatus(pipelineExecution, 'running', {
      currentStage: 'providerValidated',
      message: 'Validando pré-requisitos do pipeline',
      source: '/system/pipeline/validate-prereqs',
    });

    const aiConfig = await getAIConfig(tenantId);
    const provider = aiConfig?.primary || aiConfig?.provider || null;
    const hasConfiguredProvider = !!(aiConfig?.configured && provider);
    const apiKey = hasConfiguredProvider ? await getDecryptedAPIKey(tenantId, provider) : null;
    const providerValidated = !!(hasConfiguredProvider && apiKey && String(apiKey).trim());

    if (!providerValidated) {
      sendJson(res, 422, {
        error: 'provider_not_configured',
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Provider de IA não configurado para este tenant. Configure um provider e suas credenciais antes de continuar.',
        details: {
          tenantId,
          provider: provider || null,
          configured: !!aiConfig?.configured,
        },
      });
      return true;
    }

    updateStage(pipelineExecution, 'providerValidated', true);

    const shouldValidateRag = body?.useRag !== false;
    let ragValidated = true;
    let ragStatus = null;

    if (shouldValidateRag) {
      ragStatus = await checkRagServiceStatus();
      ragValidated = ragStatus?.status === 'healthy';
      if (!ragValidated) {
        sendJson(res, 422, {
          error: 'rag_unavailable',
          code: 'RAG_UNAVAILABLE',
          message: ragStatus?.error || 'Serviço RAG indisponível. Verifique a saúde do serviço antes de continuar.',
          details: {
            tenantId,
            ragStatus,
          },
        });
        return true;
      }
    }

    updateStage(pipelineExecution, 'ragValidated', true);
    updateStatus(pipelineExecution, 'running', {
      currentStage: shouldValidateRag ? 'ragValidated' : 'providerValidated',
      message: shouldValidateRag
        ? 'Pré-requisitos do pipeline validados'
        : 'Pré-requisitos do pipeline validados (RAG não solicitado)',
      source: '/system/pipeline/validate-prereqs',
    });

    sendJson(res, 200, {
      ok: true,
      executionId,
      tenantId,
      providerValidated: true,
      ragValidated,
      provider,
    });
  } catch (err) {
    logger.error('[System] Erro ao validar pré-requisitos do pipeline', err);
    if (err instanceof SyntaxError) {
      badRequest(res, 'JSON inválido no corpo da requisição');
    } else {
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao validar pré-requisitos do pipeline',
      });
    }
  }

  return true;
}

module.exports = { handleSystemPipelineRoutes };
