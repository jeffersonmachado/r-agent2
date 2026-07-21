'use strict';

const journeyService = require('../../journey-registry/service');
const logger = require('../../../utils/logger');

async function handleJourneyRegistryRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody, logAction } = deps;
  const tenantId = req.tenant_id || 'system';
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);

  // GET /api/journey-registry
  if (method === 'GET' && pathname === '/api/journey-registry') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const filters = {};
    if (req.query.domain) filters.domain = req.query.domain;
    if (req.query.status) filters.status = req.query.status;
    if (req.query.criticality) filters.criticality = req.query.criticality;

    const journeys = await journeyService.listJourneys({ tenantId, filters });
    sendJson({ journeys });
  }

  // GET /api/journey-registry/:id
  const idMatch = pathname.match(/^\/api\/journey-registry\/([a-f0-9-]+)$/);
  if (method === 'GET' && idMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const journey = await journeyService.getJourneyById(idMatch[1], tenantId);
    if (!journey) return sendJson({ error: 'Journey not found' }, 404);
    sendJson({ journey });
  }

  // POST /api/journey-registry
  if (method === 'POST' && pathname === '/api/journey-registry') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.domain || !body.name || !body.slug) return badRequest('domain, name and slug are required');

    const journey = await journeyService.createJourney({ ...body, tenantId });
    await logAction('journey_registry.create', { journeyId: journey.id, slug: journey.slug });
    sendJson({ journey }, 201);
  }

  // PUT /api/journey-registry/:id
  const putMatch = pathname.match(/^\/api\/journey-registry\/([a-f0-9-]+)$/);
  if (method === 'PUT' && putMatch) {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'update'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    const journey = await journeyService.updateJourney(putMatch[1], body, tenantId);
    if (!journey) return sendJson({ error: 'Journey not found' }, 404);
    sendJson({ journey });
  }

  // POST /api/journey-registry/seed - Seed default journeys
  if (method === 'POST' && pathname === '/api/journey-registry/seed') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const journeys = await journeyService.seedDefaultJourneys(tenantId);
    sendJson({ journeys, count: journeys.length });
  }

  return false;
}

module.exports = { handleJourneyRegistryRoutes };
