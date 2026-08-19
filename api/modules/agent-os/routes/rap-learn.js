'use strict';

const learningService = require('../../rap-learn/service');
const logger = require('../../../utils/logger');

async function handleRapLearnRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody } = deps;
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);
  // Fail-closed: requireAuth popula req.tenantId e req.agent.tenantId
  // (camelCase); req.tenant_id nunca é populado em produção, então o fallback
  // 'system' executava 100% das vezes. Tenant ausente → 400 tenant_required
  // (super_admin deve enviar X-Tenant-Id explicitamente, sem inferência).
  const resolveTenantId = () => req.tenantId || req.agent?.tenantId || null; // lazy: requireAuth popula req dentro de cada branch
  const tenantGuard = () => {
    if (resolveTenantId()) return true;
    sendJson({ error: 'tenant_required' }, 400);
    return false;
  };

  // GET /api/rap-learn/records
  if (method === 'GET' && pathname === '/api/rap-learn/records') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const filters = {};
    if (req.query.type) filters.type = req.query.type;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.classification) filters.classification = req.query.classification;

    const records = await learningService.listLearningRecords({ tenantId: resolveTenantId(), filters });
    sendJson({ records });
  }

  // GET /api/rap-learn/regressions
  if (method === 'GET' && pathname === '/api/rap-learn/regressions') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const windowHours = parseInt(req.query.windowHours) || 24;
    const regressions = await learningService.detectRegressions({ tenantId: resolveTenantId(), windowHours });
    sendJson({ regressions, windowHours });
  }

  // POST /api/rap-learn/failure - Record failure
  if (method === 'POST' && pathname === '/api/rap-learn/failure') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    const record = await learningService.recordFailure({
      tenantId: resolveTenantId(),
      source: body.source,
      sourceRef: body.sourceRef,
      classification: body.classification,
      metrics: body.metrics || {},
    });
    sendJson({ record }, 201);
  }

  // POST /api/rap-learn/classify/:id
  const classifyMatch = pathname.match(/^\/api\/rap-learn\/classify\/([a-f0-9-]+)$/);
  if (method === 'POST' && classifyMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    const record = await learningService.classifyFailure(classifyMatch[1], body.classification, body.rootCause, resolveTenantId());
    if (!record) return sendJson({ error: 'Record not found' }, 404);
    sendJson({ record });
  }

  // POST /api/rap-learn/suggest/:id
  const suggestMatch = pathname.match(/^\/api\/rap-learn\/suggest\/([a-f0-9-]+)$/);
  if (method === 'POST' && suggestMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    const record = await learningService.generateSuggestion(suggestMatch[1], body.suggestion, resolveTenantId());
    if (!record) return sendJson({ error: 'Record not found' }, 404);
    sendJson({ record });
  }

  // POST /api/rap-learn/validate/:id
  const validateMatch = pathname.match(/^\/api\/rap-learn\/validate\/([a-f0-9-]+)$/);
  if (method === 'POST' && validateMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    const record = await learningService.validateSuggestion(validateMatch[1], body.validationResult, resolveTenantId());
    if (!record) return sendJson({ error: 'Record not found' }, 404);
    sendJson({ record });
  }

  // POST /api/rap-learn/promote/:id
  const promoteMatch = pathname.match(/^\/api\/rap-learn\/promote\/([a-f0-9-]+)$/);
  if (method === 'POST' && promoteMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'approve'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const body = hasJsonContentType(req) ? await parseJsonBody(req) : {};
    // requireAuth popula req.agent (nunca req.user): o ator da promoção vem do
    // agente autenticado; ausente → principal_required (não criar actor fictício).
    const promotedBy = body.promotedBy || req.agent?.username || req.agent?.id || null;
    if (!promotedBy) { sendJson({ error: 'principal_required' }, 400); return true; }
    const record = await learningService.promoteToProduction(promoteMatch[1], promotedBy, resolveTenantId());
    if (!record) return sendJson({ error: 'Record not found' }, 404);
    sendJson({ record });
  }

  return false;
}

module.exports = { handleRapLearnRoutes };
