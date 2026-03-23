'use strict';

const fitnessAttendanceService = require('../../services/vertical/fitnessAttendanceService');

async function handleFitnessAttendanceRoutes(ctx) {
  const { req, res, method, pathname, deps, ensureAuth, tenantId } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireAuth,
    requireTenant,
  } = deps;

  // GET /api/fitness/subject/:subjectId/attendance
  if (method === 'GET' && pathname.match(/^\/api\/fitness\/subject\/([^/]+)\/attendance$/)) {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const subjectId = decodeURIComponent(pathname.split('/')[4]);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const windowDays = Number(urlObj.searchParams.get('windowDays')) || 90;
    const limit = Number(urlObj.searchParams.get('limit')) || 100;
    const result = await fitnessAttendanceService.getAttendanceHistory({ tenantId: tenantId(req), subjectId, windowDays, limit });
    sendJson(res, 200, result);
    return true;
  }

  // POST /api/fitness/attendance/check-in
  if (method === 'POST' && pathname === '/api/fitness/attendance/check-in') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const body = await parseJsonBody(req);
    if (!body?.subjectId) {
      badRequest(res, 'subjectId required');
      return true;
    }

    const att = await fitnessAttendanceService.recordCheckIn({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      membershipId: body.membershipId || null,
      accessDecisionId: body.accessDecisionId || null,
      unitId: body.unitId || null,
      deviceId: body.deviceId || null,
      metadata: body.metadata || {},
    });

    sendJson(res, 201, { item: att });
    return true;
  }

  // POST /api/fitness/attendance/check-out
  if (method === 'POST' && pathname === '/api/fitness/attendance/check-out') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const body = await parseJsonBody(req);
    if (!body?.subjectId) {
      badRequest(res, 'subjectId required');
      return true;
    }

    const att = await fitnessAttendanceService.recordCheckOut({
      tenantId: tenantId(req),
      subjectId: body.subjectId,
      accessDecisionId: body.accessDecisionId || null,
      attendanceId: body.attendanceId || null,
      deviceId: body.deviceId || null,
      metadata: body.metadata || {},
    });
    if (!att) {
      sendJson(res, 404, { error: 'open_attendance_not_found' });
      return true;
    }

    sendJson(res, 200, { item: att });
    return true;
  }

  // GET /api/fitness/attendance/open
  if (method === 'GET' && pathname === '/api/fitness/attendance/open') {
    if (!ensureAuth(req, res, { requireAuth, sendJson, requireTenant })) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const unitId = urlObj.searchParams.get('unitId') || null;
    const limit = Number(urlObj.searchParams.get('limit')) || 50;
    const result = await fitnessAttendanceService.listOpenAttendances({ tenantId: tenantId(req), unitId, limit });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

module.exports = {
  handleFitnessAttendanceRoutes,
};
