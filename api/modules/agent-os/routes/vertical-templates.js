'use strict';

const templateService = require('../../vertical-templates/service');
const logger = require('../../../utils/logger');

async function handleVerticalTemplateRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody, logAction } = deps;
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);
  // Fail-closed: requireAuth popula req.tenantId e req.agent.tenantId
  // (camelCase); req.tenant_id nunca é populado em produção, então o fallback
  // 'system' executava 100% das vezes. Tenant ausente → 400 tenant_required
  // (super_admin deve enviar X-Tenant-Id explicitamente, sem inferência).
  const tenantId = req.tenantId || req.agent?.tenantId || null;
  const tenantGuard = () => {
    if (tenantId) return true;
    sendJson({ error: 'tenant_required' }, 400);
    return false;
  };

  // GET /api/vertical-templates
  if (method === 'GET' && pathname === '/api/vertical-templates') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const filters = {};
    if (req.query.category) filters.category = req.query.category;
    if (req.query.status) filters.status = req.query.status;

    const templates = await templateService.listTemplates({ tenantId, filters });
    sendJson({ templates });
  }

  // GET /api/vertical-templates/:id
  const idMatch = pathname.match(/^\/api\/vertical-templates\/([a-f0-9-]+)$/);
  if (method === 'GET' && idMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const template = await templateService.getTemplateById(idMatch[1], tenantId);
    if (!template) return sendJson({ error: 'Template not found' }, 404);
    sendJson({ template });
  }

  // POST /api/vertical-templates
  if (method === 'POST' && pathname === '/api/vertical-templates') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.name || !body.slug || !body.category) return badRequest('name, slug and category are required');

    const template = await templateService.createTemplate({ ...body, tenantId });
    await logAction('vertical_template.create', { templateId: template.id, slug: template.slug });
    sendJson({ template }, 201);
  }

  // PUT /api/vertical-templates/:id
  const putMatch = pathname.match(/^\/api\/vertical-templates\/([a-f0-9-]+)$/);
  if (method === 'PUT' && putMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    const template = await templateService.updateTemplate(putMatch[1], body, tenantId);
    if (!template) return sendJson({ error: 'Template not found' }, 404);
    sendJson({ template });
  }

  // POST /api/vertical-templates/seed - Seed default templates
  if (method === 'POST' && pathname === '/api/vertical-templates/seed') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const templates = await templateService.seedDefaultTemplates(tenantId);
    sendJson({ templates, count: templates.length });
  }

  return false;
}

module.exports = { handleVerticalTemplateRoutes };
