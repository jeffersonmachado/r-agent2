'use strict';

const kgService = require('../../knowledge-graph/service');
const logger = require('../../../utils/logger');

async function handleKnowledgeGraphRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody } = deps;
  const tenantId = req.tenant_id || 'system';
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);

  // GET /api/knowledge-graph - Query graph
  if (method === 'GET' && pathname === '/api/knowledge-graph') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const nodeTypes = req.query.types ? req.query.types.split(',') : null;
    const result = await kgService.queryGraph({ tenantId, nodeTypes, maxDepth: parseInt(req.query.depth) || 3 });
    sendJson(result);
  }

  // GET /api/knowledge-graph/node/:id/related - Find related nodes
  const relatedMatch = pathname.match(/^\/api\/knowledge-graph\/node\/([a-f0-9-]+)\/related$/);
  if (method === 'GET' && relatedMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const result = await kgService.findRelated({
      tenantId,
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

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.type || !body.label) return badRequest('type and label are required');

    const node = await kgService.upsertNode({
      tenantId,
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

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.sourceNodeId || !body.targetNodeId || !body.relationship) {
      return badRequest('sourceNodeId, targetNodeId and relationship are required');
    }

    const edge = await kgService.createEdge({
      tenantId,
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
