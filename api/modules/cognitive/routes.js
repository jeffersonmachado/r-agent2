'use strict';

/**
 * Rotas do Cognitive Core — ponto de entrada operacional do núcleo cognitivo.
 *
 * POST /api/cognitive/process      → executa o pipeline obrigatório (CONTEXT→INTENT→
 *                                    PLAN→EXECUTE→VALIDATE→LEARN) para o tenant autenticado
 * GET  /api/cognitive/intents      → taxonomia de intenções de negócio (vocabulário
 *                                    de negócio, sem internals — aberta a PRODUCTION)
 * GET  /api/cognitive/capabilities → BUSINESS CAPABILITY VIEW (id/name/description,
 *                                    filtrada por visibility do ator) — PRODUCTION/
 *                                    SUPPORT/DEVELOPMENT
 * GET  /api/cognitive/tools        → Tool Registry técnico (schemas, riskLevel,
 *                                    sideEffects, policies) — SOMENTE DEVELOPMENT
 *
 * A resposta contém apenas resultado de negócio (o orchestrator já sanitiza e
 * nunca expõe engines internas, QA, replay, seeds, mesh ou RPA).
 */

const logger = require('../../utils/logger');
const { getClassificationForAgent } = require('../agent-os/experience-segregation');
const { checkClassification } = require('../../middleware/requireClassification');
const { resolveActorToolPermissions } = require('../../utils/actorToolPermissions');

/**
 * Classificação de experiência do ator — delega à fonte única da política
 * (api/modules/agent-os/experience-segregation.js): platformClassification/
 * platformRole server-side primeiro; super_admin → DEVELOPMENT; demais
 * (inclui auditor de tenant) → PRODUCTION.
 */
function resolveActorClassification(agent) {
  return getClassificationForAgent(agent);
}

function buildActor(req) {
  return {
    userId: req.agent?.id || req.agent?.username || null,
    classification: resolveActorClassification(req.agent),
    permissions: resolveActorToolPermissions(req.agent),
  };
}

/**
 * Mensagem operacional curta derivada do desfecho de negócio.
 */
function businessMessage(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.status === 'human_handoff_requested' || result.humanHandoff === true) {
    return 'Solicitação encaminhada para atendimento humano.';
  }
  if (result.requiresConfirmation === true) return 'Ação pendente de confirmação explícita.';
  if (result.businessOutcome === 'outcome_not_achieved') return 'A ação solicitada não foi concluída.';
  return null;
}

/**
 * DTO de resultado de negócio (HARD-014 / INVARIANTE 9).
 *
 * PRODUCTION recebe apenas o resultado de negócio (status, outcome, message,
 * data) — nunca internals de execução (`outputs` com ids de steps e saídas
 * brutas de tools, nem razões técnicas de falha do outcome). SUPPORT e
 * DEVELOPMENT recebem os detalhes técnicos para diagnóstico.
 *
 * Nada é destruído: o execution record completo segue persistido no ledger
 * pelo orchestrator; apenas a apresentação é segregada. A classificação vem
 * do principal autenticado (req.agent → role), nunca do payload do cliente.
 */
function buildBusinessResultDTO(result, classification) {
  const dto = {
    executionId: result.executionId,
    tenantId: result.tenantId,
    status: result.status,
    intent: result.intent,
    confidence: result.confidence,
    humanHandoff: result.humanHandoff,
    fallback: result.fallback,
    requiresConfirmation: result.requiresConfirmation,
    outcome: result.businessOutcome,
    message: businessMessage(result),
    data: { evidence: result.businessEvidence || {} },
    latencyMs: result.latencyMs,
  };
  if (String(classification || '').toUpperCase() !== 'PRODUCTION') {
    dto.businessFailures = result.businessFailures || [];
    dto.outputs = result.outputs || [];
  }
  return dto;
}

async function handleCognitiveRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody } = deps;
  const sendJson = (data, code) => _s(res, code || 200, data);
  const badRequest = (message) => _b(res, message);

  if (!pathname.startsWith('/api/cognitive')) return false;

  const authCheck = requireAuth(req);
  if (!authCheck.valid) {
    sendJson({ error: 'unauthorized' }, 401);
    return true;
  }

  const orchestrator = deps.cognitiveOrchestrator
    || require('../../../src/core/cognitive').getCognitiveOrchestrator();

  // POST /api/cognitive/process — pipeline cognitivo completo
  if (method === 'POST' && pathname === '/api/cognitive/process') {
    const permCheck = requirePermission(req, 'ai', 'execute');
    if (!permCheck.allowed) {
      sendJson({ error: 'forbidden', message: permCheck.error }, 403);
      return true;
    }
    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');

    const body = await parseJsonBody(req);
    const tenantId = String(req.tenant_id || req.agent?.tenantId || '').trim();
    if (!tenantId) return badRequest('tenant_required');
    if (!body || (!body.message && !body.eventType)) {
      return badRequest('message or eventType is required');
    }

    try {
      const actor = buildActor(req);
      const result = await orchestrator.process({
        tenantId,
        channel: body.channel || 'workspace',
        userId: req.agent?.id || null,
        message: body.message || null,
        eventType: body.eventType || null,
        payload: body.payload || {},
        actor,
      });
      sendJson({ ok: true, result: buildBusinessResultDTO(result, actor.classification) });
    } catch (error) {
      logger.error('[CognitiveRoutes] process failed', {
        tenantId,
        error: error.message,
      });
      sendJson({ ok: false, error: 'cognitive_process_failed', message: error.message }, 500);
    }
    return true;
  }

  // GET /api/cognitive/intents — taxonomia de negócio
  if (method === 'GET' && pathname === '/api/cognitive/intents') {
    const permCheck = requirePermission(req, 'ai', 'execute');
    if (!permCheck.allowed) {
      sendJson({ error: 'forbidden', message: permCheck.error }, 403);
      return true;
    }
    const { INTENTS } = require('../../../src/core/cognitive');
    sendJson({ intents: INTENTS });
    return true;
  }

  // GET /api/cognitive/capabilities — visão de capacidades de NEGÓCIO
  // (BLOCKER 7): expõe apenas { id, name, description } por capability,
  // filtrada pela visibility do ator. Nunca vaza tool ids, schemas,
  // riskLevel, sideEffects, policies ou permissions internas.
  if (method === 'GET' && pathname === '/api/cognitive/capabilities') {
    const permCheck = requirePermission(req, 'ai', 'execute');
    if (!permCheck.allowed) {
      sendJson({ error: 'forbidden', message: permCheck.error }, 403);
      return true;
    }
    const actor = buildActor(req);
    const capabilityRegistry = deps.capabilityRegistry
      || require('../../../src/core/cognitive').getCapabilityRegistry();
    const capabilities = capabilityRegistry.list(actor).map((cap) => ({
      id: cap.id,
      name: cap.name,
      description: cap.description || null,
    }));
    sendJson({ classification: actor.classification, capabilities });
    return true;
  }

  // GET /api/cognitive/tools — Tool Registry técnico (schemas, riskLevel,
  // sideEffects, policies). Restrito a DEVELOPMENT (BLOCKER 7): a visão de
  // negócio para PRODUCTION/SUPPORT é GET /api/cognitive/capabilities.
  if (method === 'GET' && pathname === '/api/cognitive/tools') {
    const permCheck = requirePermission(req, 'ai', 'execute');
    if (!permCheck.allowed) {
      sendJson({ error: 'forbidden', message: permCheck.error }, 403);
      return true;
    }
    const classCheck = checkClassification(req, 'DEVELOPMENT');
    if (!classCheck.allowed) {
      sendJson(
        { error: 'classification_required', required: classCheck.required, classification: classCheck.classification },
        403,
      );
      return true;
    }
    const actor = buildActor(req);
    sendJson({ classification: actor.classification, tools: orchestrator.toolRegistry.list(actor) });
    return true;
  }

  return false;
}

module.exports = {
  handleCognitiveRoutes,
  _internal: { resolveActorClassification, resolveActorToolPermissions, buildBusinessResultDTO },
};
