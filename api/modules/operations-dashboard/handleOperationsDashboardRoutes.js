'use strict';

const {
  computeSummary,
  listTimeline,
  listJobs,
  listNotifications,
  listInsights,
  listFinancialTransactions,
} = require('../../services/operationsDashboardService');
const { isSuperAdmin } = require('../../services/superAdminService');

function resolveTenantId(req, requestedTenantId) {
  const authTenant = req?.tenantId || req?.agent?.tenantId || null;
  const requested = requestedTenantId ? String(requestedTenantId).trim() : '';

  if (!requested) return authTenant;

  const superAdmin = isSuperAdmin(req?.agent || null);
  if (superAdmin) return requested;

  if (authTenant && requested === authTenant) return authTenant;

  const err = new Error('forbidden_tenant_override');
  err.code = 'forbidden_tenant_override';
  throw err;
}

function parseQuery(req) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  return {
    tenantId: urlObj.searchParams.get('tenantId') || null,
    vertical: urlObj.searchParams.get('vertical') || 'all',
    startDate: urlObj.searchParams.get('startDate') || null,
    endDate: urlObj.searchParams.get('endDate') || null,
    subjectId: urlObj.searchParams.get('subjectId') || null,
    customerId: urlObj.searchParams.get('customerId') || null,
    membershipId: urlObj.searchParams.get('membershipId') || null,
    jobId: urlObj.searchParams.get('jobId') || null,
    status: urlObj.searchParams.get('status') || null,
    provider: urlObj.searchParams.get('provider') || null,
    problemOnly: urlObj.searchParams.get('problemOnly') || null,
    channel: urlObj.searchParams.get('channel') || null,
    limit: urlObj.searchParams.get('limit') || null,
    page: urlObj.searchParams.get('page') || null,
  };
}

function sendTenantOverrideForbidden(sendJson, res) {
  sendJson(res, 403, {
    error: 'forbidden',
    message: 'tenantId override permitido apenas para super_admin/system owner.',
  });
}

async function handleOperationsDashboardRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    requireTenant,
    sendJson,
    logger,
  } = deps;

  if (!pathname.startsWith('/api/operations-dashboard')) return false;

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const requiredTenant = requireTenant(req, res);
  if (!requiredTenant) return true;

  const permResult = requirePermission(req, 'analytics', 'read');
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return true;
  }

  const q = parseQuery(req);

  let tenantId;
  try {
    tenantId = resolveTenantId(req, q.tenantId);
  } catch (err) {
    if (err?.code === 'forbidden_tenant_override') {
      sendTenantOverrideForbidden(sendJson, res);
      return true;
    }
    throw err;
  }

  try {
    if (method === 'GET' && pathname === '/api/operations-dashboard/summary') {
      const out = await computeSummary({
        tenantId,
        vertical: q.vertical,
        startDate: q.startDate,
        endDate: q.endDate,
      });
      sendJson(res, 200, { ok: true, ...out });
      return true;
    }

    if (method === 'GET' && pathname === '/api/operations-dashboard/timeline') {
      const out = await listTimeline({
        tenantId,
        vertical: q.vertical,
        startDate: q.startDate,
        endDate: q.endDate,
        subjectId: q.subjectId,
        customerId: q.customerId,
        membershipId: q.membershipId,
        status: q.status,
        limit: q.limit,
        page: q.page,
      });
      sendJson(res, 200, { ok: true, ...out });
      return true;
    }

    if (method === 'GET' && pathname === '/api/operations-dashboard/jobs') {
      const out = await listJobs({
        tenantId,
        vertical: q.vertical,
        startDate: q.startDate,
        endDate: q.endDate,
        jobId: q.jobId,
        status: q.status,
        limit: q.limit,
        page: q.page,
      });
      sendJson(res, 200, { ok: true, ...out });
      return true;
    }

    if (method === 'GET' && pathname === '/api/operations-dashboard/notifications') {
      const out = await listNotifications({
        tenantId,
        vertical: q.vertical,
        startDate: q.startDate,
        endDate: q.endDate,
        status: q.status,
        channel: q.channel,
        limit: q.limit,
        page: q.page,
      });
      sendJson(res, 200, { ok: true, ...out });
      return true;
    }

    if (method === 'GET' && pathname === '/api/operations-dashboard/insights') {
      const out = await listInsights({
        tenantId,
        vertical: q.vertical,
        startDate: q.startDate,
        endDate: q.endDate,
        limit: q.limit,
      });
      sendJson(res, 200, { ok: true, ...out });
      return true;
    }

    if (method === 'GET' && pathname === '/api/operations-dashboard/finance') {
      const out = await listFinancialTransactions({
        tenantId,
        vertical: q.vertical,
        startDate: q.startDate,
        endDate: q.endDate,
        status: q.status,
        provider: q.provider,
        problemOnly: String(q.problemOnly || '').toLowerCase() === 'true',
        limit: q.limit,
        page: q.page,
      });
      sendJson(res, 200, { ok: true, ...out });
      return true;
    }

    return false;
  } catch (err) {
    logger.error('[OperationsDashboardRoutes] request failed', {
      method,
      pathname,
      tenantId,
      error: err?.message,
    });

    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Erro ao processar operations dashboard.',
    });
    return true;
  }
}

module.exports = {
  handleOperationsDashboardRoutes,
  resolveTenantId,
};
