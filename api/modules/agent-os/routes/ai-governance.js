'use strict';

const governanceService = require('../../ai-governance/service');
const getAiGovernanceRecordModel = require('../../../db/models/AiGovernanceRecord');
const logger = require('../../../utils/logger');

const VALID_EVENT_TYPES = getAiGovernanceRecordModel.EVENT_TYPES;

async function handleAiGovernanceRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { requireAuth, requirePermission, sendJson: _s, badRequest: _b, hasJsonContentType, parseJsonBody, logAction } = deps;
  const tenantId = req.tenant_id || 'system';
  const sendJson = (d, c) => _s(res, c || 200, d);
  const badRequest = (m) => _b(res, m);

  // GET /api/ai-governance/audit-trail
  if (method === 'GET' && pathname === '/api/ai-governance/audit-trail') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const eventTypes = req.query.eventTypes ? req.query.eventTypes.split(',') : null;
    const trail = await governanceService.getAuditTrail({
      tenantId,
      agentId: req.query.agentId || null,
      eventTypes,
      limit: parseInt(req.query.limit) || 100,
    });
    sendJson({ auditTrail: trail });
  }

  // GET /api/ai-governance/decision-log
  if (method === 'GET' && pathname === '/api/ai-governance/decision-log') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const log = await governanceService.getDecisionLog({
      tenantId,
      agentId: req.query.agentId || null,
      limit: parseInt(req.query.limit) || 100,
    });
    sendJson({ decisionLog: log });
  }

  // GET /api/ai-governance/compliance-report
  if (method === 'GET' && pathname === '/api/ai-governance/compliance-report') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'read'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    const report = await governanceService.generateComplianceReport({
      tenantId,
      startDate: req.query.startDate || null,
      endDate: req.query.endDate || null,
    });
    sendJson({ report });
  }

  // POST /api/ai-governance/event - Log governance event
  if (method === 'POST' && pathname === '/api/ai-governance/event') {
    const authCheck = requireAuth(req); if (!authCheck.valid) { sendJson({ error: 'unauthorized' }, 401); return true; }
    const permCheck = requirePermission(req, 'agents', 'create'); if (!permCheck.allowed) { sendJson({ error: 'forbidden' }, 403); return true; }

    if (!hasJsonContentType(req)) return badRequest('Content-Type must be application/json');
    const body = await parseJsonBody(req);

    if (!body.eventType) return badRequest('eventType is required');
    if (!VALID_EVENT_TYPES.includes(body.eventType)) {
      return badRequest(`eventType inválido: "${body.eventType}". Valores aceitos: ${VALID_EVENT_TYPES.join(', ')}`);
    }

    const record = await governanceService.logGovernanceEvent({
      tenantId,
      agentId: body.agentId,
      eventType: body.eventType,
      // requireAuth popula req.agent (nunca req.user): derivar o ator do
      // agente autenticado para não persistir actor null na trilha de auditoria.
      actor: body.actor || req.agent?.username || req.agent?.id || null,
      actorRole: body.actorRole || req.agent?.role || null,
      description: body.description,
      metadata: body.metadata || {},
      decision: body.decision,
      dataAccessed: body.dataAccessed || [],
      toolsUsed: body.toolsUsed || [],
      cost: body.cost || 0,
      riskLevel: body.riskLevel || 'low',
    });

    await logAction('ai_governance.event', { eventType: body.eventType, agentId: body.agentId });
    sendJson({ record }, 201);
  }

  return false;
}

module.exports = { handleAiGovernanceRoutes };
