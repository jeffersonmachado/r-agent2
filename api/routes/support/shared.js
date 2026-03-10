'use strict';

function getUrl(req) {
  return new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
}

function decodeRouteParam(match, index) {
  return decodeURIComponent(match?.[index] || '').trim();
}

function buildOperationalPipelineService() {
  const { OperationalPipelineService } = require('../../core/operational-pipeline');
  return new OperationalPipelineService();
}

function buildOperationalContextQueryService() {
  const { OperationalContextQueryService } = require('../../core/operational-agent');
  return new OperationalContextQueryService();
}

function resolveQuickActionPermission(req, operation, requireAnyPermission) {
  const op = String(operation || 'list').toLowerCase();
  if (op === 'execute') {
    return requireAnyPermission(req, [
      { resource: 'tickets', action: 'update' },
      { resource: 'crm', action: 'update' },
      { resource: 'autonomous_scheduling', action: 'update' },
    ]);
  }
  return requireAnyPermission(req, [
    { resource: 'tickets', action: 'read' },
    { resource: 'analytics', action: 'read' },
    { resource: 'crm', action: 'read' },
  ]);
}

function sendQuickActionScopeError(sendJson, res, scopeOut) {
  const status = Number(scopeOut?.status) || 400;
  const code = String(scopeOut?.error?.code || 'quick_action_scope_error');
  const message = String(scopeOut?.error?.message || 'Falha ao validar escopo da quick action');
  sendJson(res, status, {
    ok: false,
    error: code,
    message,
  });
}

function resolveQuickActionExecutionStatus(out) {
  const code = String(out?.error?.code || '').toUpperCase();
  if (code === 'ACTION_NOT_FOUND' || code === 'ACTION_REQUIRED' || code === 'SOURCE_REQUIRED' || code === 'TENANT_REQUIRED') {
    return 422;
  }
  return 400;
}

function sanitizeQuickActionSupportContext(raw = {}) {
  const ticketId = String(raw?.ticketId || raw?.ticket_id || '').trim();
  const queueId = String(raw?.queueId || raw?.queue_id || raw?.queue || raw?.queueName || '').trim();
  const departmentId = String(raw?.departmentId || raw?.department_id || raw?.department || '').trim();

  const out = {};
  if (ticketId) out.ticketId = ticketId;
  if (queueId) out.queueId = queueId;
  if (departmentId) out.departmentId = departmentId;
  return Object.keys(out).length > 0 ? out : null;
}

function extractQuickActionSupportContext({ req, body = null } = {}) {
  const bodyContext = body && typeof body === 'object'
    ? (body.supportContext || body.context || body)
    : {};
  const fromBody = sanitizeQuickActionSupportContext(bodyContext || {});
  if (fromBody) return fromBody;

  try {
    const urlObj = getUrl(req);
    return sanitizeQuickActionSupportContext({
      ticketId: urlObj.searchParams.get('ticketId') || null,
      queueId: urlObj.searchParams.get('queueId') || null,
      departmentId: urlObj.searchParams.get('departmentId') || null,
    });
  } catch (_) {
    return null;
  }
}

function readSupportOutcomeFilters(searchParams) {
  const read = (key) => {
    const raw = searchParams?.get(key);
    if (raw == null) return null;
    const normalized = String(raw).trim();
    return normalized || null;
  };

  return {
    sourceType: read('sourceType') || read('source_type'),
    sourceId: read('sourceId') || read('source_id'),
    actionId: read('actionId') || read('action_id'),
    actionType: read('actionType') || read('action_type'),
    status: read('status'),
    contactId: read('contactId') || read('contact_id'),
    signalId: read('signalId') || read('signal_id'),
    recommendationId: read('recommendationId') || read('recommendation_id'),
    playbookExecutionId: read('playbookExecutionId') || read('playbook_execution_id'),
    outcomeType: read('outcomeType') || read('outcome_type'),
    from: read('from') || read('dateFrom') || read('startDate'),
    to: read('to') || read('dateTo') || read('endDate'),
  };
}

async function resolveQuickActionScopeForRequest({
  req,
  mode,
  operation,
  routeTenantId = null,
  contactId = null,
  sourceType,
  sourceId,
  actionId = null,
  supportContext = null,
  deps,
}) {
  const { quickActionAccess } = require('../../core/operational-quick-actions');
  const permission = resolveQuickActionPermission(req, operation, deps.requireAnyPermission);
  const superAdmin = deps.isSuperAdmin(req.agent);

  return quickActionAccess.resolveScope({
    mode,
    operation,
    actor: {
      isSuperAdmin: superAdmin,
      role: req.agent?.role || null,
      id: req.agent?.id || null,
      username: req.agent?.username || null,
      canRead: operation === 'list' ? permission.allowed : true,
      canExecute: operation === 'execute' ? permission.allowed : true,
    },
    actorTenantId: req.tenantId || req.agent?.tenantId || null,
    routeTenantId,
    contactId,
    sourceType,
    sourceId,
    actionId,
    supportContext,
  });
}

function resolveOperationalTenantFromRequest(req, isSuperAdmin, routeTenantId = null) {
  const normalize = (value) => {
    const out = value == null ? '' : String(value).trim();
    return out || null;
  };

  if (isSuperAdmin(req.agent)) {
    return normalize(routeTenantId)
      || normalize(req.tenantId)
      || normalize(req.agent?.tenantId)
      || null;
  }
  return normalize(req.tenantId) || null;
}

async function composeRouteHandlers(handlers = [], context = {}) {
  for (const handler of handlers) {
    if (typeof handler !== 'function') continue;
    const handled = await handler(context);
    if (handled) return true;
  }
  return false;
}

module.exports = {
  getUrl,
  decodeRouteParam,
  buildOperationalPipelineService,
  buildOperationalContextQueryService,
  sendQuickActionScopeError,
  resolveQuickActionExecutionStatus,
  extractQuickActionSupportContext,
  readSupportOutcomeFilters,
  resolveQuickActionScopeForRequest,
  resolveOperationalTenantFromRequest,
  composeRouteHandlers,
};
