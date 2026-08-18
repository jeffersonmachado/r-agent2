async function handleSystemGenerationContentRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    isSuperAdmin,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  // POST /system/generate-faq - Gera perguntas/FAQ agrupadas a partir do contexto do tenant
  if (method === 'POST' && pathname === '/system/generate-faq') {
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
      const tenantId = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const { requireExecutionId } = require('../../../middleware/requireExecutionId');
      const rawExecutionId = body?.executionId ? String(body.executionId).trim() : '';
      const executionId = rawExecutionId ? requireExecutionId(body, res, badRequest) : null;
      if (rawExecutionId && !executionId) {
        return true;
      }

      const { generateFaq } = require('../../../services/faqGeneratorService');
      const { ensureExecutionContext, updateStage, updateStatus } = require('../../../services/pipelineExecutionContext');

      let execution = null;
      const pipelineStage = String(body?.pipelineStage || '').trim();
      if (executionId) {
        execution = ensureExecutionContext(
          { executionId, tenantId, pipelineStage },
          { tenantId }
        );
        updateStatus(execution, 'running', {
          currentStage: pipelineStage || 'faqGenerated',
          message: pipelineStage === 'questionsGenerated' ? 'Gerando perguntas automaticamente' : 'Gerando FAQ do tenant',
          source: '/system/generate-faq',
        });
      }

      const result = await generateFaq({
        tenantId,
        name: body?.name ?? null,
        description: body?.description ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        executionId: executionId || null,
        contextMode: body?.contextMode ?? 'auto',
        rules: body?.rules ?? null,
        dryRun: body?.dryRun === true,
        questionMode: body?.questionMode === 'inferential' ? 'inferential' : 'extractive',
      });

      if (execution && pipelineStage) {
        updateStage(execution, pipelineStage, true);
        updateStatus(execution, 'running', {
          currentStage: pipelineStage,
          message: pipelineStage === 'questionsGenerated' ? 'Perguntas geradas' : 'FAQ gerado',
          source: '/system/generate-faq',
        });
      } else if (execution) {
        updateStage(execution, 'faqGenerated', true);
      }

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar FAQ:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar FAQ',
        });
      }
    }
    return true;
  }

  // POST /system/generate-faq-answers - Gera respostas para perguntas de FAQ
  if (method === 'POST' && pathname === '/system/generate-faq-answers') {
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
      const tenantId = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();

      if (!tenantId) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }

      const { generateFaqAnswers } = require('../../../services/faqAnswersService');
      const result = await generateFaqAnswers({
        tenantId,
        questions: Array.isArray(body?.questions) ? body.questions : [],
        executionId: body?.executionId ?? null,
        name: body?.name ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        contextMode: body?.contextMode ?? 'auto',
        dryRun: body?.dryRun === true,
      });

      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar respostas de FAQ:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar respostas de FAQ',
        });
      }
    }
    return true;
  }

  // POST /system/generate-initial-flow - Gera um fluxo inicial visual para tenant
  if (method === 'POST' && pathname === '/system/generate-initial-flow') {
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
      const tenantIdForAI = (body?.tenantId && isSuperAdmin(req.agent))
        ? String(body.tenantId).trim()
        : String(authResult.agent?.tenantId || '').trim();
      const targetTenantId = body?.targetTenantId ? String(body.targetTenantId).trim() : tenantIdForAI;

      if (!tenantIdForAI) {
        badRequest(res, 'tenantId é obrigatório');
        return true;
      }
      if (!targetTenantId) {
        badRequest(res, 'targetTenantId é obrigatório');
        return true;
      }

      const { requireExecutionId } = require('../../../middleware/requireExecutionId');
      const rawExecutionId = body?.executionId ? String(body.executionId).trim() : '';
      const executionId = rawExecutionId ? requireExecutionId(body, res, badRequest) : null;
      if (rawExecutionId && !executionId) {
        return true;
      }

      const { generateInitialGraph } = require('../../../services/initialGraphService');
      const { ensureExecutionContext, updateStage, updateStatus } = require('../../../services/pipelineExecutionContext');

      let execution = null;
      if (executionId) {
        execution = ensureExecutionContext(
          { executionId, tenantId: tenantIdForAI, targetTenantId },
          { tenantId: tenantIdForAI }
        );
        updateStatus(execution, 'running', {
          currentStage: 'initialFlowGenerated',
          message: 'Gerando fluxo inicial do tenant',
          source: '/system/generate-initial-flow',
        });
      }

      const result = await generateInitialGraph({
        tenantIdForAI,
        tenantIdTarget: targetTenantId,
        name: body?.name ?? null,
        description: body?.description ?? null,
        urls: Array.isArray(body?.urls) ? body.urls : [],
        fileNames: Array.isArray(body?.fileNames) ? body.fileNames : [],
        executionId: executionId || null,
        contextMode: body?.contextMode ?? 'auto',
        chunks: Array.isArray(body?.chunks) ? body.chunks : [],
        rules: body?.rules ?? null,
        dryRun: body?.dryRun === true || body?.persistFlow === false,
      });

      if (execution) {
        updateStage(execution, 'initialFlowGenerated', true);
        updateStatus(execution, 'running', {
          currentStage: 'initialFlowGenerated',
          message: 'Fluxo inicial gerado',
          source: '/system/generate-initial-flow',
        });
      }

      sendJson(res, 200, {
        initialFlow: result?.reteJson || null,
        entities: {
          categories: Array.isArray(result?.categories) ? result.categories : [],
          coverage: typeof result?.coverage === 'number' ? result.coverage : 0,
          excludedItemsCount: Number(result?.excludedItemsCount || 0),
        },
        persisted: !!result?.persisted,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('[System] Erro ao gerar fluxo inicial:', err);
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar fluxo inicial',
        });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleSystemGenerationContentRoutes };
