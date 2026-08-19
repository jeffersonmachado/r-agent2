'use strict';

const kgService = require('../../knowledge-graph/service');
const getKnowledgeGraphNodeModel = require('../../../db/models/KnowledgeGraphNode');
const logger = require('../../../utils/logger');

const VALID_NODE_TYPES = getKnowledgeGraphNodeModel.NODE_TYPES;

async function handleKnowledgeGraphRoutes(ctx) {
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

  // GET /api/knowledge-graph - Query graph
  if (method === 'GET' && pathname === '/api/knowledge-graph') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const nodeTypes = req.query.types ? req.query.types.split(',') : null;
    const result = await kgService.queryGraph({ tenantId: resolveTenantId(), nodeTypes, maxDepth: parseInt(req.query.depth) || 3 });
    sendJson(result);
  }

  // GET /api/knowledge-graph/node/:id/related - Find related nodes
  const relatedMatch = pathname.match(/^\/api\/knowledge-graph\/node\/([a-f0-9-]+)\/related$/);
  if (method === 'GET' && relatedMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    const result = await kgService.findRelated({
      tenantId: resolveTenantId(),
      nodeId: relatedMatch[1],
      relationship: req.query.relationship || null,
      direction: req.query.direction || 'both',
    });
    sendJson(result);
  }

  // POST /api/knowledge-graph/node - Upsert node
  if (method === 'POST' && pathname === '/api/knowledge-graph/node') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.type || !body.label) return badRequest('type and label are required');
    if (!VALID_NODE_TYPES.includes(body.type)) {
      return badRequest(`type inválido: "${body.type}". Valores aceitos: ${VALID_NODE_TYPES.join(', ')}`);
    }

    const node = await kgService.upsertNode({
      tenantId: resolveTenantId(),
      type: body.type,
      label: body.label,
      properties: body.properties || {},
      externalRef: body.externalRef || null,
      externalType: body.externalType || null,
    });
    sendJson({ node }, 201);
  }

  // POST /api/knowledge-graph/edge - Create edge
  if (method === 'POST' && pathname === '/api/knowledge-graph/edge') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }
    if (!tenantGuard()) return true;

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.sourceNodeId || !body.targetNodeId || !body.relationship) {
      return badRequest('sourceNodeId, targetNodeId and relationship are required');
    }

    const edge = await kgService.createEdge({
      tenantId: resolveTenantId(),
      sourceNodeId: body.sourceNodeId,
      targetNodeId: body.targetNodeId,
      relationship: body.relationship,
      weight: body.weight || 1.0,
      properties: body.properties || {},
    });
    sendJson({ edge }, 201);
  }

  return false;
}

module.exports = { handleKnowledgeGraphRoutes };
