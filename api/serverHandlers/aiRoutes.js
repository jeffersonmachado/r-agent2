/**
 * AI Routes Handler
 * Gerencia endpoints de geração de IA (/ai/chatbot/generate, /ai/rpa/generate, /api/ai/generate)
 */

module.exports = {
  handleAiRoutes,
};

/**
 * Verifica e trata rotas de geração de IA
 * @returns {boolean} true se a rota foi tratada, false caso contrário
 */
async function handleAiRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
  } = deps;

  // POST /ai/chatbot/generate - Alias do orquestrador (formato alinhado com /flows/generate)
  if (method === 'POST' && pathname === '/ai/chatbot/generate') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const body = await parseJsonBody(req);
      const { userInput, options = {} } = body || {};

      if (!userInput || typeof userInput !== 'string' || userInput.trim() === '') {
        badRequest(res, 'Campo "userInput" é obrigatório e deve ser uma string não vazia');
        return true;
      }

      const payload = {
        name: options.flowName || options.name || 'Fluxo Gerado',
        description: userInput,
        tenantId,
        useRag: options.useRag === true,
        ragSources: Array.isArray(options.ragSources) ? options.ragSources : [],
        useWebScraping: options.useWebScraping === true,
        scrapingTargets: Array.isArray(options.scrapingTargets) ? options.scrapingTargets : [],
        includeQuestions: options.includeQuestions === true,
        questions: Array.isArray(options.questions) ? options.questions : [],
        generateRpaTest: options.generateRpaTest === true,
        rpaMode: options.rpaMode,
      };

      const { orchestrateGeneration } = require('../services/generationOrchestratorService');
      const result = await orchestrateGeneration(payload, { tenantId });

      // Mantém compatibilidade com /flows/generate: validação warnings em top-level
      try {
        const flowValidation = result?.validation?.flow || null;
        if (flowValidation && flowValidation.valid === false && Array.isArray(flowValidation.errors)) {
          result.validationWarnings = {
            valid: false,
            errors: flowValidation.errors,
            codes: flowValidation.errors.map((e) => e && e.code).filter(Boolean),
          };
        } else {
          result.validationWarnings = { valid: true, errors: [], codes: [] };
        }
      } catch (_) {
        // best-effort
      }

      sendJson(res, result.success ? 200 : 400, result);
    } catch (err) {
      logger.error('[API] Erro ao gerar chatbot (alias do orquestrador)', { error: err.message, stack: err.stack });
      sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno ao gerar chatbot' });
    }
    return true;
  }

  // POST /ai/rpa/generate - Alias do orquestrador (formato alinhado com /flows/generate)
  if (method === 'POST' && pathname === '/ai/rpa/generate') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }
      const tenantId = requireTenant(req, res);
      if (!tenantId) return true;

      const body = await parseJsonBody(req);
      const { userInput, options = {} } = body || {};

      if (!userInput || typeof userInput !== 'string' || userInput.trim() === '') {
        badRequest(res, 'Campo "userInput" é obrigatório e deve ser uma string não vazia');
        return true;
      }

      // Alias: gera flow + rpaTest usando o mesmo orquestrador do /flows/generate
      const payload = {
        name: options.flowName || options.name || 'Fluxo Gerado',
        description: userInput,
        tenantId,
        useRag: options.useRag === true,
        ragSources: Array.isArray(options.ragSources) ? options.ragSources : [],
        useWebScraping: options.useWebScraping === true,
        scrapingTargets: Array.isArray(options.scrapingTargets) ? options.scrapingTargets : [],
        includeQuestions: options.includeQuestions === true,
        questions: Array.isArray(options.questions) ? options.questions : [],
        generateRpaTest: true,
        rpaMode: options.rpaMode || 'infer',
      };

      const { orchestrateGeneration } = require('../services/generationOrchestratorService');
      const result = await orchestrateGeneration(payload, { tenantId });
      try {
        const flowValidation = result?.validation?.flow || null;
        if (flowValidation && flowValidation.valid === false && Array.isArray(flowValidation.errors)) {
          result.validationWarnings = {
            valid: false,
            errors: flowValidation.errors,
            codes: flowValidation.errors.map((e) => e && e.code).filter(Boolean),
          };
        } else {
          result.validationWarnings = { valid: true, errors: [], codes: [] };
        }
      } catch (_) {
        // best-effort
      }

      sendJson(res, result.success ? 200 : 400, result);
    } catch (err) {
      logger.error('[API] Erro ao gerar RPA', { error: err.message, stack: err.stack });
      const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim())
        ? String(req.headers['x-request-id']).trim()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const { buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../engine/ai/aiEnvelope');
        const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope('rpa_test', {}, {
          valid: false,
          errors: [{ type: 'INTERNAL_ERROR', message: err.message || 'Erro interno ao gerar RPA' }],
          warnings: [],
          qualityScore: 0,
          riskFlags: ['INTERNAL_ERROR'],
        }, {
          provider: { name: null, model: null, temperature: null },
          input: { prompt_summary: 'rpa.generator.prompt.md', user_goal: null, context: {} },
          audit: { request_id: requestId, seed: null, tenant_id: req.tenantId || null, user_id: req.agent?.id || req.agent?.username || null },
        }));
        sendJson(res, 500, { envelope, error: { code: 'INTERNAL_ERROR', message: err.message || 'Erro interno ao gerar RPA' } });
      } catch (_) {
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno ao gerar RPA' });
      }
    }
    return true;
  }

  // POST /api/ai/generate - Gera resposta de IA
  if (method === 'POST' && pathname === '/api/ai/generate') {
    if (!hasJsonContentType(req)) {
      logger.warn('Requisição de IA sem Content-Type JSON');
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { prompt, sessionId, flowId, nodeId, tenantId, executionId } = body || {};
      const { requireExecutionId } = require('../middleware/requireExecutionId');
      const execIdForWs = requireExecutionId({ executionId }, res, badRequest);
      if (!execIdForWs) return true;

      logger.debug('Requisição de IA recebida', {
        promptLength: prompt?.length,
        sessionId,
        flowId,
        nodeId,
        tenantId,
        executionId: execIdForWs,
      });

      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        logger.warn('Prompt inválido na requisição de IA', { prompt, type: typeof prompt });
        badRequest(res, 'Campo "prompt" é obrigatório e deve ser uma string não vazia');
        return true;
      }

      const effectiveTenantId = tenantId || req.tenantId;
      logger.debug('Usando tenant para IA', { effectiveTenantId });

      try {
        // Emite etapa para feedback visual (toasts) via WS.
        try {
          const { createPipelineWs } = require('../ws/pipelineEmitter');
          const { emitPipelineStage } = require('../ws/emitPipelineStage');
          if (effectiveTenantId) {
            emitPipelineStage(createPipelineWs({ tenantId: effectiveTenantId }), execIdForWs, {
              stage: 'ai-generate',
              status: 'running',
              message: 'Executando IA...',
              meta: { flowId: flowId || null, nodeId: nodeId || null },
            });
          }
        } catch (_) {}

        logger.debug('Gerando resposta de IA...', {
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });

        const { generateAiResponse } = require('../services/aiService');
        const result = await generateAiResponse(prompt, effectiveTenantId, {
          sessionId,
          flowId,
          nodeId,
        });

        logger.debug('Resposta de IA gerada com sucesso', {
          hasText: !!result?.text,
          textLength: result?.text?.length,
          hasUsage: !!result?.usage,
        });

        try {
          const { createPipelineWs } = require('../ws/pipelineEmitter');
          const { emitPipelineStage } = require('../ws/emitPipelineStage');
          if (effectiveTenantId) {
            emitPipelineStage(createPipelineWs({ tenantId: effectiveTenantId }), execIdForWs, {
              stage: 'ai-generate',
              status: 'success',
              message: 'IA executada.',
              meta: { usage: result?.usage || null },
            });
          }
        } catch (_) {}

        sendJson(res, 200, {
          text: typeof result === 'string' ? result : result.text,
          usage: result.usage || null,
        });
      } catch (aiError) {
        logger.error('Erro ao gerar resposta de IA', {
          message: aiError.message,
          stack: aiError.stack,
          tenantId: effectiveTenantId,
          promptPreview: prompt.substring(0, 100),
        });
        const rawMessage = String(aiError?.message || 'Erro ao gerar resposta de IA');
        const rawCode = String(aiError?.code || aiError?.error?.code || '');
        const rawStatus = Number(aiError?.status || aiError?.response?.status || 0) || null;
        const isQuota =
          rawCode === 'insufficient_quota' ||
          /exceeded your current quota/i.test(rawMessage);
        const isRateLimit =
          (rawStatus === 429 && !isQuota) ||
          rawCode === 'rate_limit_exceeded' ||
          /rate limit/i.test(rawMessage);

        if (isQuota) {
          try {
            const { createPipelineWs } = require('../ws/pipelineEmitter');
            const { emitPipelineStage } = require('../ws/emitPipelineStage');
            if (effectiveTenantId) {
              emitPipelineStage(createPipelineWs({ tenantId: effectiveTenantId }), execIdForWs, {
                stage: 'ai-generate',
                status: 'error',
                message: rawMessage || 'Cota do provider excedida',
                meta: { code: 'PROVIDER_QUOTA_EXCEEDED' },
              });
            }
          } catch (_) {}
          const { sendApiError, buildApiError } = require('../middleware/apiErrorHandler');
          sendApiError(res, buildApiError({
            code: 'PROVIDER_QUOTA_EXCEEDED',
            message: rawMessage,
            httpStatus: 402,
            retryable: false,
            details: { tenantId: effectiveTenantId, providerErrorCode: rawCode || null },
            req,
          }), () => {});
          return true;
        }
        if (isRateLimit) {
          const retryAfter = Number(aiError?.retryAfter || aiError?.headers?.['retry-after'] || 60);
          try {
            const { createPipelineWs } = require('../ws/pipelineEmitter');
            const { emitPipelineStage } = require('../ws/emitPipelineStage');
            if (effectiveTenantId) {
              emitPipelineStage(createPipelineWs({ tenantId: effectiveTenantId }), execIdForWs, {
                stage: 'ai-generate',
                status: 'error',
                message: rawMessage || 'Rate limit excedido no provider de IA',
                meta: { code: 'RATE_LIMIT_EXCEEDED', retryAfter },
              });
            }
          } catch (_) {}
          const { sendApiError, buildApiError } = require('../middleware/apiErrorHandler');
          sendApiError(res, buildApiError({
            code: 'RATE_LIMIT_EXCEEDED',
            message: rawMessage,
            httpStatus: 429,
            retryable: true,
            details: { tenantId: effectiveTenantId, retryAfter },
            req,
          }), () => {});
          return true;
        }

        try {
          const { createPipelineWs } = require('../ws/pipelineEmitter');
          const { emitPipelineStage } = require('../ws/emitPipelineStage');
          if (effectiveTenantId) {
            emitPipelineStage(createPipelineWs({ tenantId: effectiveTenantId }), execIdForWs, {
              stage: 'ai-generate',
              status: 'error',
              message: rawMessage || 'Erro ao gerar resposta de IA',
              meta: { code: 'AI_GENERATION_FAILED', status: rawStatus || null, providerErrorCode: rawCode || null },
            });
          }
        } catch (_) {}

        const { sendApiError, buildApiError } = require('../middleware/apiErrorHandler');
        sendApiError(res, buildApiError({
          code: 'AI_GENERATION_FAILED',
          message: rawMessage,
          httpStatus: 500,
          retryable: true,
          details: {
            tenantId: effectiveTenantId,
            providerErrorCode: rawCode || null,
            status: rawStatus || null,
            ...(process.env.NODE_ENV === 'development' ? { stack: aiError?.stack } : {}),
          },
          req,
        }), () => {});
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        logger.warn('JSON inválido na requisição de IA', { message: err.message });
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao processar requisição de IA', {
          message: err.message,
          stack: err.stack,
        });
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao processar requisição',
        });
      }
    }
    return true;
  }

  // Nenhuma rota tratada
  return false;
}
