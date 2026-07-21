'use strict';

/**
 * Rotas do Cognitive Core — ponto de entrada operacional do núcleo cognitivo.
 *
 * POST /api/cognitive/process  → executa o pipeline obrigatório (CONTEXT→INTENT→
 *                                PLAN→EXECUTE→VALIDATE→LEARN) para o tenant autenticado
 * GET  /api/cognitive/intents  → taxonomia de intenções de negócio
 * GET  /api/cognitive/tools    → tools visíveis para o ator (filtradas por visibility)
 *
 * A resposta contém apenas resultado de negócio (o orchestrator já sanitiza e
 * nunca expõe engines internas, QA, replay, seeds, mesh ou RPA).
 */

const { hasPermission } = require('../../services/rbacService');
const logger = require('../../utils/logger');

/**
 * Classificação de experiência do ator (mesma política do Agent OS):
 * super_admin → DEVELOPMENT; auditor → SUPPORT; demais papéis → PRODUCTION.
 */
function resolveActorClassification(agent) {
  const role = String(agent?.role || '').toLowerCase();
  if (role === 'super_admin') return 'DEVELOPMENT';
  if (role === 'auditor') return 'SUPPORT';
  return 'PRODUCTION';
}

/**
 * Traduz RBAC → permissões de tools do Cognitive Core.
 *
 * Baseline (quem tem ai/execute pode operar a IA de negócio): agenda, canal,
 * tickets, transferência e chamadas. Permissões com recurso RBAC equivalente
 * (crm, campanhas, workspace) são derivadas do papel real do usuário.
 */
function resolveActorToolPermissions(agent) {
  if (String(agent?.role || '').toLowerCase() === 'super_admin') return ['*'];

  const granted = [];
  if (hasPermission(agent, 'ai', 'execute')) {
    granted.push('agenda.write', 'channel.send', 'ticket.write', 'conversation.transfer', 'pbx.call');
  }
  if (hasPermission(agent, 'crm', 'read')) granted.push('crm.read');
  if (hasPermission(agent, 'crm', 'create') || hasPermission(agent, 'crm', 'update')) granted.push('crm.write');
  if (hasPermission(agent, 'bulk_messaging', 'create') || hasPermission(agent, 'bulk_messaging', 'update')) granted.push('campaign.write');
  if (hasPermission(agent, 'workspace', 'write') || hasPermission(agent, 'workspace', 'action')) granted.push('workspace.write');
  return granted;
}

function buildActor(req) {
  return {
    userId: req.agent?.id || req.agent?.username || null,
    classification: resolveActorClassification(req.agent),
    permissions: resolveActorToolPermissions(req.agent),
  };
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
      const result = await orchestrator.process({
        tenantId,
        channel: body.channel || 'workspace',
        userId: req.agent?.id || null,
        message: body.message || null,
        eventType: body.eventType || null,
        payload: body.payload || {},
        actor: buildActor(req),
      });
      sendJson({ ok: true, result });
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

  // GET /api/cognitive/tools — tools visíveis para o ator (visibility-filtered)
  if (method === 'GET' && pathname === '/api/cognitive/tools') {
    const permCheck = requirePermission(req, 'ai', 'execute');
    if (!permCheck.allowed) {
      sendJson({ error: 'forbidden', message: permCheck.error }, 403);
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
  _internal: { resolveActorClassification, resolveActorToolPermissions },
};
