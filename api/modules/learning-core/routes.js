'use strict';

const learningCoreService = require('./service');
const competencyService = require('./competencyService');

const ADMIN_ROLES = new Set(['owner', 'admin', 'super_admin']);

/**
 * Rotas do Learning Core (boundary HTTP — delega ao service).
 *
 * POST /api/learning/interactions — ingere lote de interações de UI do
 * usuário autenticado (qualquer papel autenticado pode reportar as próprias
 * interações; o actor vem da sessão, nunca do body).
 *
 * GET  /api/learning/competencies/me        — competências do próprio usuário.
 * GET  /api/learning/competencies/:userId   — competências de outro usuário
 *                                             (apenas owner/admin/super_admin).
 * POST /api/learning/competencies/recompute — recomputa as do próprio usuário.
 * GET  /api/learning/skill-graph            — artefato do skill graph
 *                                             (404 explícito se não gerado).
 */
async function handleLearningCoreRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody } = deps;
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);

  if (method === 'POST' && pathname === '/api/learning/interactions') {
    const authCheck = requireAuth(req);
    if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }

    if (!hasJsonContentType(req)) { badRequest('Content-Type must be application/json'); return true; }
    const body = await parseJsonBody(req);

    const tenantId = req.tenantId || req.agent?.tenantId || req.agent?.tenant_id || 'system';
    try {
      const result = await learningCoreService.ingestInteractionBatch({
        tenantId,
        agentId: req.agent?.id,
        username: req.agent?.username,
        sessionId: body.sessionId,
        events: body.events,
      });
      sendJson(result, 201);
    } catch (error) {
      if (error.code === 'BAD_REQUEST') { badRequest(error.message); return true; }
      throw error;
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/learning/competencies/me') {
    const authCheck = requireAuth(req);
    if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }

    const tenantId = req.tenantId || req.agent?.tenantId || req.agent?.tenant_id || 'system';
    const result = await competencyService.getCompetencies({
      tenantId,
      agentId: req.agent?.id,
    });
    sendJson(result);
    return true;
  }

  if (method === 'POST' && pathname === '/api/learning/competencies/recompute') {
    const authCheck = requireAuth(req);
    if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }

    const tenantId = req.tenantId || req.agent?.tenantId || req.agent?.tenant_id || 'system';
    const result = await competencyService.recomputeCompetencies({
      tenantId,
      agentId: req.agent?.id,
      username: req.agent?.username,
    });
    sendJson(result);
    return true;
  }

  const competencyUserMatch = method === 'GET'
    ? pathname.match(/^\/api\/learning\/competencies\/([^/]+)$/)
    : null;
  if (competencyUserMatch && competencyUserMatch[1] !== 'me') {
    const authCheck = requireAuth(req);
    if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }

    if (!ADMIN_ROLES.has(req.agent?.role)) {
      sendJson({ error: 'forbidden' }, 403);
      return true;
    }

    const tenantId = req.tenantId || req.agent?.tenantId || req.agent?.tenant_id || 'system';
    const result = await competencyService.getCompetencies({
      tenantId,
      agentId: decodeURIComponent(competencyUserMatch[1]),
    });
    sendJson(result);
    return true;
  }

  if (method === 'GET' && pathname === '/api/learning/skill-graph') {
    const authCheck = requireAuth(req);
    if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }

    const artifact = competencyService.getSkillGraphArtifact();
    if (!artifact) {
      sendJson({
        error: 'skill_graph_not_generated',
        message: 'Artefato do skill graph ainda nao gerado. Rode `npm run learning:skill-graph:build`.',
      }, 404);
      return true;
    }
    sendJson(artifact);
    return true;
  }

  return false;
}

module.exports = { handleLearningCoreRoutes };
