'use strict';

const accessDecisionService = require('./accessDecisionService');
const accessControlService = require('./accessControlService');
const { buildVendorCommand } = require('./integrations/accessIntegrationService');
const {
  getDecisionExecutionStatus,
  listDecisionExecutionStatuses,
  summarizeDecisionExecutionStatuses,
  getDecisionHealthSnapshot,
} = require('./decisions/decisionStatusService');

function ensureAuthAndPermission(req, res, deps, action = 'read') {
  const { requireAuth, requirePermission, sendJson, requireTenant } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) {
    return false;
  }
  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }
  return true;
}

module.exports = { handleAccessControlDecisionRoutes };

async function handleAccessControlDecisionRoutes({ req, res, method, pathname, deps }) {
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireAuth,
    requirePermission,
    requireTenant,
    logger,
  } = deps;

  const tenantId = () => req.tenantId || req.agent?.tenantId || null;
  const authDeps = { requireAuth, requirePermission, sendJson, requireTenant };

  if (method === 'POST' && pathname === '/api/access-control/decisions/resolve') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const result = await accessDecisionService.resolveDecision({
        tenantId: tenantId(),
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
      const device = resolvedDeviceId
        ? await accessControlService.getDevice({ tenantId: tenantId(), id: resolvedDeviceId })
        : null;
      const executionCommand = device
        ? buildVendorCommand({
          vendor: device.vendor,
          decision: result.decision,
          device,
          token: result.token,
        })
        : null;
      sendJson(res, 200, { ok: true, ...result, execution_command: executionCommand });
    } catch (err) {
      logger.error('[AccessControl] Erro ao resolver decisão', err);
      sendJson(res, 500, { error: 'access_control_resolve_failed', message: err.message });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/access-control/events') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const body = await parseJsonBody(req);
    const item = await accessControlService.createEvent({ tenantId: tenantId(), payload: body });
    sendJson(res, 201, { item });
    return true;
  }

  if (method === 'GET' && pathname === '/api/access-control/events') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const items = await accessControlService.listEvents({
      tenantId: tenantId(),
      filters: {
        subject_id: urlObj.searchParams.get('subject_id'),
        device_id: urlObj.searchParams.get('device_id'),
        event_type: urlObj.searchParams.get('event_type'),
        limit: urlObj.searchParams.get('limit'),
      },
    });
    sendJson(res, 200, { items });
    return true;
  }

  if (method === 'GET' && pathname === '/api/access-control/decisions') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const includeStatus = urlObj.searchParams.get('include_status') !== 'false';
    const executionStatus = urlObj.searchParams.get('execution_status');
    const pendingCriticalOnly = urlObj.searchParams.get('pending_critical_only') === 'true';
    const decisions = await accessControlService.listDecisions({
      tenantId: tenantId(),
      filters: {
        subject_id: urlObj.searchParams.get('subject_id'),
        device_id: urlObj.searchParams.get('device_id'),
        decision: urlObj.searchParams.get('decision'),
        reason_code: urlObj.searchParams.get('reason_code'),
        limit: urlObj.searchParams.get('limit'),
      },
    });
    const items = includeStatus
      ? await listDecisionExecutionStatuses({
        tenantId: tenantId(),
        decisions,
        executionStatus,
        pendingCriticalOnly,
      })
      : decisions;
    const summary = includeStatus ? summarizeDecisionExecutionStatuses(items) : null;
    sendJson(res, 200, { items, summary });
    return true;
  }

  if (method === 'GET' && pathname === '/api/access-control/health') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const snapshot = await getDecisionHealthSnapshot({
      tenantId: tenantId(),
      limit: urlObj.searchParams.get('limit'),
    });
    sendJson(res, 200, { ok: true, ...snapshot });
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/access-control/decisions/') && pathname.endsWith('/status')) {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    const decisionId = decodeURIComponent(
      pathname.slice('/api/access-control/decisions/'.length, -'/status'.length),
    );
    const status = await getDecisionExecutionStatus({
      tenantId: tenantId(),
      decisionId,
    });
    if (!status) {
      sendJson(res, 404, { error: 'access_decision_not_found' });
      return true;
    }
    sendJson(res, 200, { ok: true, ...status });
    return true;
  }

  if (method === 'POST' && pathname === '/api/access-control/visitors/qrcode') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    const body = await parseJsonBody(req);
    const result = await accessDecisionService.issueVisitorQr({ tenantId: tenantId(), payload: body });
    sendJson(res, 201, result);
    return true;
  }

  if (method === 'POST' && pathname === '/api/access-control/qrcode/resolve') {
    if (!ensureAuthAndPermission(req, res, authDeps, 'read')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const result = await accessDecisionService.resolveQrToken({
        tenantId: tenantId(),
        token: body.qr_payload || body.qrPayload || body.token,
        deviceId: body.device_id || body.deviceId || null,
        action: body.action || 'enter',
      });
      const resolvedDeviceId = body.device_id || body.deviceId || null;
      const device = resolvedDeviceId
        ? await accessControlService.getDevice({ tenantId: tenantId(), id: resolvedDeviceId })
        : null;
      const executionCommand = device
        ? buildVendorCommand({
          vendor: device.vendor,
          decision: result.decision,
          device,
          token: result.token,
        })
        : null;
      sendJson(res, 200, { ok: true, ...result, execution_command: executionCommand });
    } catch (err) {
      const code = err && err.code ? String(err.code) : null;
      if (code === 'expired_qr_token') {
        sendJson(res, 410, { error: 'expired_qr_token' });
        return true;
      }
      if (code && code.startsWith('invalid_')) {
        sendJson(res, 400, { error: code });
        return true;
      }
      logger.error('[AccessControl] Erro ao resolver QR', err);
      sendJson(res, 500, { error: 'access_control_qr_resolve_failed', message: err.message });
    }
    return true;
  }

  return false;
}
