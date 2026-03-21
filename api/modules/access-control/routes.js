'use strict';

const express = require('express');
const accessControlService = require('./accessControlService');
const accessDecisionService = require('./accessDecisionService');
const { buildVendorCommand } = require('./integrations/accessIntegrationService');
const {
  getDecisionExecutionStatus,
  listDecisionExecutionStatuses,
  summarizeDecisionExecutionStatuses,
  getDecisionHealthSnapshot,
} = require('./decisions/decisionStatusService');

function createAccessControlRoutes({ buildDeps }) {
  const router = express.Router();

  function tenantId(req) {
    return req.tenantId || req.agent?.tenantId || null;
  }

  function ensureAuthAndPermission(req, res, deps, action = 'read') {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    const resolvedTenantId = deps.requireTenant(req, res);
    if (!resolvedTenantId) return false;
    const permResult = deps.requirePermission(req, 'config', action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  router.get('/api/access-control/devices', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    deps.sendJson(res, 200, { items: await accessControlService.listDevices({ tenantId: tenantId(req) }) });
  });

  router.post('/api/access-control/devices', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const body = await deps.parseJsonBody(req);
    const item = await accessControlService.createDevice({ tenantId: tenantId(req), payload: body });
    deps.logAction({ agentId: req.agent.id, username: req.agent.username, tenantId: tenantId(req), action: 'access_control_device_create', resource: 'access_device', resourceId: item.id });
    deps.sendJson(res, 201, { item });
  });

  router.patch('/api/access-control/devices/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const body = await deps.parseJsonBody(req);
    const item = await accessControlService.patchDevice({ tenantId: tenantId(req), id: decodeURIComponent(req.params.id), payload: body });
    if (!item) {
      deps.sendJson(res, 404, { error: 'access_device_not_found' });
      return;
    }
    deps.sendJson(res, 200, { item });
  });

  router.get('/api/access-control/credentials', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    deps.sendJson(res, 200, { items: await accessControlService.listCredentials({ tenantId: tenantId(req) }) });
  });

  router.post('/api/access-control/credentials', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const item = await accessControlService.createCredential({ tenantId: tenantId(req), payload: await deps.parseJsonBody(req) });
    deps.sendJson(res, 201, { item });
  });

  router.patch('/api/access-control/credentials/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const item = await accessControlService.patchCredential({
      tenantId: tenantId(req),
      id: decodeURIComponent(req.params.id),
      payload: await deps.parseJsonBody(req),
    });
    if (!item) {
      deps.sendJson(res, 404, { error: 'access_credential_not_found' });
      return;
    }
    deps.sendJson(res, 200, { item });
  });

  router.get('/api/access-control/policies', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    deps.sendJson(res, 200, { items: await accessControlService.listPolicies({ tenantId: tenantId(req) }) });
  });

  router.post('/api/access-control/policies', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const item = await accessControlService.createPolicy({ tenantId: tenantId(req), payload: await deps.parseJsonBody(req) });
    deps.sendJson(res, 201, { item });
  });

  router.patch('/api/access-control/policies/:id', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const item = await accessControlService.patchPolicy({
      tenantId: tenantId(req),
      id: decodeURIComponent(req.params.id),
      payload: await deps.parseJsonBody(req),
    });
    if (!item) {
      deps.sendJson(res, 404, { error: 'access_policy_not_found' });
      return;
    }
    deps.sendJson(res, 200, { item });
  });

  router.post('/api/access-control/decisions/resolve', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const result = await accessDecisionService.resolveDecision({
        tenantId: tenantId(req),
        action: body.action || 'enter',
        deviceId: body.device_id || body.deviceId || null,
        credentialValue: body.credential_value || body.credentialValue || null,
        credentialRef: body.credential_ref || body.credentialRef || null,
        credentialId: body.credential_id || body.credentialId || null,
        subjectId: body.subject_id || body.subjectId || null,
        customerId: body.customer_id || body.customerId || null,
        membershipId: body.membership_id || body.membershipId || null,
        vertical: body.vertical || 'fitness',
        biometricRef: body.biometric_ref || body.biometricRef || null,
        rawPayload: body,
      });
      const resolvedDeviceId = body.device_id || body.deviceId || null;
      const device = resolvedDeviceId ? await accessControlService.getDevice({ tenantId: tenantId(req), id: resolvedDeviceId }) : null;
      const executionCommand = device ? buildVendorCommand({ vendor: device.vendor, decision: result.decision, device, token: result.token }) : null;
      deps.sendJson(res, 200, { ok: true, ...result, execution_command: executionCommand });
    } catch (err) {
      deps.logger.error('[AccessControl] Erro ao resolver decisão', err);
      deps.sendJson(res, 500, { error: 'access_control_resolve_failed', message: err.message });
    }
  });

  router.post('/api/access-control/events', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const item = await accessControlService.createEvent({ tenantId: tenantId(req), payload: await deps.parseJsonBody(req) });
    deps.sendJson(res, 201, { item });
  });

  router.get('/api/access-control/events', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
    const items = await accessControlService.listEvents({
      tenantId: tenantId(req),
      filters: {
        subject_id: urlObj.searchParams.get('subject_id'),
        device_id: urlObj.searchParams.get('device_id'),
        event_type: urlObj.searchParams.get('event_type'),
        limit: urlObj.searchParams.get('limit'),
      },
    });
    deps.sendJson(res, 200, { items });
  });

  router.get('/api/access-control/decisions', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
    const includeStatus = urlObj.searchParams.get('include_status') !== 'false';
    const executionStatus = urlObj.searchParams.get('execution_status');
    const pendingCriticalOnly = urlObj.searchParams.get('pending_critical_only') === 'true';
    const decisions = await accessControlService.listDecisions({
      tenantId: tenantId(req),
      filters: {
        subject_id: urlObj.searchParams.get('subject_id'),
        device_id: urlObj.searchParams.get('device_id'),
        decision: urlObj.searchParams.get('decision'),
        reason_code: urlObj.searchParams.get('reason_code'),
        limit: urlObj.searchParams.get('limit'),
      },
    });
    const items = includeStatus
      ? await listDecisionExecutionStatuses({ tenantId: tenantId(req), decisions, executionStatus, pendingCriticalOnly })
      : decisions;
    const summary = includeStatus ? summarizeDecisionExecutionStatuses(items) : null;
    deps.sendJson(res, 200, { items, summary });
  });

  router.get('/api/access-control/health', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    const urlObj = new URL(req.originalUrl || req.url || '/', 'http://localhost');
    const snapshot = await getDecisionHealthSnapshot({
      tenantId: tenantId(req),
      limit: urlObj.searchParams.get('limit'),
    });
    deps.sendJson(res, 200, { ok: true, ...snapshot });
  });

  router.get('/api/access-control/decisions/:id/status', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    const status = await getDecisionExecutionStatus({
      tenantId: tenantId(req),
      decisionId: decodeURIComponent(req.params.id),
    });
    if (!status) {
      deps.sendJson(res, 404, { error: 'access_decision_not_found' });
      return;
    }
    deps.sendJson(res, 200, { ok: true, ...status });
  });

  router.post('/api/access-control/visitors/qrcode', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'update')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    const result = await accessDecisionService.issueVisitorQr({ tenantId: tenantId(req), payload: await deps.parseJsonBody(req) });
    deps.sendJson(res, 201, result);
  });

  router.post('/api/access-control/qrcode/resolve', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureAuthAndPermission(req, res, deps, 'read')) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await deps.parseJsonBody(req);
      const result = await accessDecisionService.resolveQrToken({
        tenantId: tenantId(req),
        token: body.qr_payload || body.qrPayload || body.token,
        deviceId: body.device_id || body.deviceId || null,
        action: body.action || 'enter',
      });
      const resolvedDeviceId = body.device_id || body.deviceId || null;
      const device = resolvedDeviceId ? await accessControlService.getDevice({ tenantId: tenantId(req), id: resolvedDeviceId }) : null;
      const executionCommand = device ? buildVendorCommand({ vendor: device.vendor, decision: result.decision, device, token: result.token }) : null;
      deps.sendJson(res, 200, { ok: true, ...result, execution_command: executionCommand });
    } catch (err) {
      const code = err && err.code ? String(err.code) : null;
      if (code === 'expired_qr_token') {
        deps.sendJson(res, 410, { error: 'expired_qr_token' });
        return;
      }
      if (code && code.startsWith('invalid_')) {
        deps.sendJson(res, 400, { error: code });
        return;
      }
      deps.logger.error('[AccessControl] Erro ao resolver QR', err);
      deps.sendJson(res, 500, { error: 'access_control_qr_resolve_failed', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createAccessControlRoutes,
};
