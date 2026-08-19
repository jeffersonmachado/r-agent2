'use strict';

const service = require('./service');
const logger = require('../../utils/logger');

async function handleAgentRegistryRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson: _sendJson,
    badRequest: _badRequest,
    hasJsonContentType,
    parseJsonBody,
    logAction,
  } = deps;

  const sendJson = (data, code) => _sendJson(res, code || 200, data);
  const badRequest = (msg) => _badRequest(res, msg);

  // Fail-closed: req.tenant_id nunca existiu; o tenant real vem do middleware
  // de auth (req.tenantId) ou do agente autenticado. Sem tenant explicito → 400.
  const resolveTenantId = () => req.tenantId || (req.agent && req.agent.tenantId) || null;
  const requireTenant = () => {
    const resolved = resolveTenantId();
    if (!resolved) {
      sendJson({ error: 'tenant_required', message: 'Tenant explicito obrigatorio (X-Tenant-Id ou agente autenticado)' }, 400);
      return null;
    }
    return resolved;
  };

  // GET /api/agent-registry
  if (method === 'GET' && pathname === '/api/agent-registry') {
    const authResult = requireAuth(req);
    if (!authResult.valid) { sendJson({ error: 'unauthorized', message: authResult.error }, 401); return true; }
    const permResult = requirePermission(req, 'agents', 'list_all');
    if (!permResult.allowed) { sendJson({ error: 'forbidden', message: permResult.error }, 403); return true; }
    const tenantId = requireTenant();
    if (!tenantId) return true;

    const filters = {};
    if (req.query.classification) filters.classification = req.query.classification;
    if (req.query.lifecycle) filters.lifecycle = req.query.lifecycle;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.search) filters.search = req.query.search;

    try {
      const agents = await service.listCorporateAgents({ tenantId, filters });
      sendJson({ agents });
    } catch (err) {
      logger.error('[AgentRegistry] list error', err);
      sendJson({ error: 'internal_error', message: err.message }, 500);
    }
    return true;
  }

  // GET /api/agent-registry/:id
  const idMatch = pathname.match(/^\/api\/agent-registry\/([a-f0-9-]+)$/);
  if (method === 'GET' && idMatch) {
    const authResult = requireAuth(req);
    if (!authResult.valid) { sendJson({ error: 'unauthorized', message: authResult.error }, 401); return true; }
    const permResult = requirePermission(req, 'agents', 'read');
    if (!permResult.allowed) { sendJson({ error: 'forbidden', message: permResult.error }, 403); return true; }
    const tenantId = requireTenant();
    if (!tenantId) return true;

    try {
      const agent = await service.getCorporateAgentById(idMatch[1], tenantId);
      if (!agent) { sendJson({ error: 'Agent not found' }, 404); return true; }
      sendJson({ agent });
    } catch (err) {
      sendJson({ error: 'internal_error', message: err.message }, 500);
    }
    return true;
  }

  // POST /api/agent-registry
  if (method === 'POST' && pathname === '/api/agent-registry') {
    const authResult = requireAuth(req);
    if (!authResult.valid) { sendJson({ error: 'unauthorized', message: authResult.error }, 401); return true; }
    const permResult = requirePermission(req, 'agents', 'create');
    if (!permResult.allowed) { sendJson({ error: 'forbidden', message: permResult.error }, 403); return true; }
    if (!hasJsonContentType(req)) { badRequest('Content-Type must be application/json'); return true; }
    const tenantId = requireTenant();
    if (!tenantId) return true;

    try {
      const body = await parseJsonBody(req);
      if (!body.name || !body.slug) { badRequest('name and slug are required'); return true; }
      const agent = await service.createCorporateAgent({ ...body, tenantId });
      logAction('agent_registry.create', { agentId: agent.id, slug: agent.slug });
      sendJson({ agent }, 201);
    } catch (err) {
      sendJson({ error: 'internal_error', message: err.message }, 500);
    }
    return true;
  }

  // PUT /api/agent-registry/:id
  const putMatch = pathname.match(/^\/api\/agent-registry\/([a-f0-9-]+)$/);
  if (method === 'PUT' && putMatch) {
    const authResult = requireAuth(req);
    if (!authResult.valid) { sendJson({ error: 'unauthorized', message: authResult.error }, 401); return true; }
    const permResult = requirePermission(req, 'agents', 'update');
    if (!permResult.allowed) { sendJson({ error: 'forbidden', message: permResult.error }, 403); return true; }
    if (!hasJsonContentType(req)) { badRequest('Content-Type must be application/json'); return true; }
    const tenantId = requireTenant();
    if (!tenantId) return true;

    try {
      const body = await parseJsonBody(req);
      const agent = await service.updateCorporateAgent(putMatch[1], body, tenantId);
      if (!agent) { sendJson({ error: 'Agent not found' }, 404); return true; }
      logAction('agent_registry.update', { agentId: agent.id, slug: agent.slug });
      sendJson({ agent });
    } catch (err) {
      sendJson({ error: 'internal_error', message: err.message }, 500);
    }
    return true;
  }

  // DELETE /api/agent-registry/:id
  const deleteMatch = pathname.match(/^\/api\/agent-registry\/([a-f0-9-]+)$/);
  if (method === 'DELETE' && deleteMatch) {
    const authResult = requireAuth(req);
    if (!authResult.valid) { sendJson({ error: 'unauthorized', message: authResult.error }, 401); return true; }
    const permResult = requirePermission(req, 'agents', 'delete');
    if (!permResult.allowed) { sendJson({ error: 'forbidden', message: permResult.error }, 403); return true; }
    const tenantId = requireTenant();
    if (!tenantId) return true;

    try {
      const deleted = await service.deleteCorporateAgent(deleteMatch[1], tenantId);
      if (!deleted) { sendJson({ error: 'Agent not found' }, 404); return true; }
      logAction('agent_registry.delete', { agentId: deleteMatch[1] });
      sendJson({ success: true });
    } catch (err) {
      sendJson({ error: 'internal_error', message: err.message }, 500);
    }
    return true;
  }

  return false;
}

module.exports = { handleAgentRegistryRoutes };
