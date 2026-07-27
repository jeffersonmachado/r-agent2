'use strict';

module.exports = { handleAiChatbotOrchestratorRoutes };

async function handleAiChatbotOrchestratorRoutes({ req, res, method, pathname, deps }) {
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

      const { orchestrateGeneration } = require('../../services/generationOrchestrator');
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

      const { orchestrateGeneration } = require('../../services/generationOrchestrator');
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
      if (err && (err.code === 'BAD_REQUEST' || err.code === 'VALIDATION_ERROR')) {
        sendJson(res, 400, { error: 'bad_request', message: err.message, details: err.details });
        return true;
      }
      logger.error('[API] Erro ao gerar RPA', { error: err.message, stack: err.stack });
      const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim())
        ? String(req.headers['x-request-id']).trim()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const { buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../../engine/ai/aiEnvelope');
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

  return false;
}
