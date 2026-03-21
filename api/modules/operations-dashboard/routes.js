'use strict';

const express = require('express');
const {
  computeSummary,
  listTimeline,
  listJobs,
  listNotifications,
  listInsights,
} = require('../../services/operationsDashboardService');
const { isSuperAdmin } = require('../../services/superAdminService');

function resolveTenantId(req, requestedTenantId) {
  const authTenant = req?.tenantId || req?.agent?.tenantId || null;
  const requested = requestedTenantId ? String(requestedTenantId).trim() : '';

  if (!requested) return authTenant;
  if (isSuperAdmin(req?.agent || null)) return requested;
  if (authTenant && requested === authTenant) return authTenant;

  const err = new Error('forbidden_tenant_override');
  err.code = 'forbidden_tenant_override';
  throw err;
}

function parseQuery(req) {
  const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
  return {
    tenantId: urlObj.searchParams.get('tenantId') || null,
    vertical: urlObj.searchParams.get('vertical') || 'all',
    startDate: urlObj.searchParams.get('startDate') || null,
    endDate: urlObj.searchParams.get('endDate') || null,
    subjectId: urlObj.searchParams.get('subjectId') || null,
    customerId: urlObj.searchParams.get('customerId') || null,
    membershipId: urlObj.searchParams.get('membershipId') || null,
    status: urlObj.searchParams.get('status') || null,
    channel: urlObj.searchParams.get('channel') || null,
    limit: urlObj.searchParams.get('limit') || null,
    page: urlObj.searchParams.get('page') || null,
  };
}

function createOperationsDashboardRoutes({ buildDeps }) {
  const router = express.Router();

  router.use('/api/operations-dashboard', async (req, res, next) => {
    const pathname = new URL(req.originalUrl || req.url || '/', 'http://localhost').pathname;
    const deps = buildDeps(req, res);

    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return;
    }

    const requiredTenant = deps.requireTenant(req, res);
    if (!requiredTenant) return;

    const permResult = deps.requirePermission(req, 'analytics', 'read');
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return;
    }

    const q = parseQuery(req);
    let tenantId;
    try {
      tenantId = resolveTenantId(req, q.tenantId);
    } catch (err) {
      if (err?.code === 'forbidden_tenant_override') {
        deps.sendJson(res, 403, {
          error: 'forbidden',
          message: 'tenantId override permitido apenas para super_admin/system owner.',
        });
        return;
      }
      next(err);
      return;
    }

    try {
      if (req.method === 'GET' && pathname === '/api/operations-dashboard/summary') {
        const out = await computeSummary({
          tenantId,
          vertical: q.vertical,
          startDate: q.startDate,
          endDate: q.endDate,
        });
        deps.sendJson(res, 200, { ok: true, ...out });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/operations-dashboard/timeline') {
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
        deps.sendJson(res, 200, { ok: true, ...out });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/operations-dashboard/jobs') {
        const out = await listJobs({
          tenantId,
          vertical: q.vertical,
          startDate: q.startDate,
          endDate: q.endDate,
          status: q.status,
          limit: q.limit,
          page: q.page,
        });
        deps.sendJson(res, 200, { ok: true, ...out });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/operations-dashboard/notifications') {
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
        deps.sendJson(res, 200, { ok: true, ...out });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/operations-dashboard/insights') {
        const out = await listInsights({
          tenantId,
          vertical: q.vertical,
          startDate: q.startDate,
          endDate: q.endDate,
          limit: q.limit,
        });
        deps.sendJson(res, 200, { ok: true, ...out });
        return;
      }

      next();
    } catch (err) {
      deps.logger.error('[OperationsDashboardRoutes] request failed', {
        method: req.method,
        pathname,
        tenantId,
        error: err?.message,
      });
      deps.sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro ao processar operations dashboard.',
      });
    }
  });

  return router;
}

module.exports = {
  createOperationsDashboardRoutes,
  resolveTenantId,
};
