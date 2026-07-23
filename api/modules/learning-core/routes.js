'use strict';

const learningCoreService = require('./service');

/**
 * Rotas do Learning Core (boundary HTTP — delega ao service).
 *
 * POST /api/learning/interactions — ingere lote de interações de UI do
 * usuário autenticado (qualquer papel autenticado pode reportar as próprias
 * interações; o actor vem da sessão, nunca do body).
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

  return false;
}

module.exports = { handleLearningCoreRoutes };
