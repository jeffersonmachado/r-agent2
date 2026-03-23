const {
  resolvePublicTokenByKind,
  enforcePublicRateLimit,
  getIpAddress,
} = require('./handlePhysicalPublicRouteUtils');

async function handlePhysicalAccessControlPublicRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    checkRateLimit,
    logAction,
  } = deps;

  if (method === 'POST' && pathname === '/physical/access/resolve') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const resolved = await resolvePublicTokenByKind(req, res, sendJson, 'access_control');
      if (!resolved) return true;

      const allowed = await enforcePublicRateLimit(
        resolved,
        req,
        res,
        sendJson,
        checkRateLimit,
        'PUBLIC_TOKEN_ACCESS_CONTROL',
      );
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const tokenMeta = (resolved && resolved.meta && typeof resolved.meta === 'object') ? resolved.meta : {};
      const boundDeviceId = tokenMeta.deviceId ? String(tokenMeta.deviceId) : null;
      const requestedDeviceId = body && (body.device_id || body.deviceId) ? String(body.device_id || body.deviceId) : null;
      const deviceId = boundDeviceId || requestedDeviceId;

      if (boundDeviceId && requestedDeviceId && boundDeviceId !== requestedDeviceId) {
        sendJson(res, 403, { error: 'forbidden', message: 'device_id divergente do token público' });
        return true;
      }

      const { resolveDecision } = require('../access-control/accessDecisionService');
      const accessControlService = require('../access-control/accessControlService');
      const { buildVendorCommand } = require('../access-control/integrations/accessIntegrationService');
      const result = await resolveDecision({
        tenantId: resolved.tenantId,
        action: body.action || 'enter',
        deviceId,
        credentialValue: body.credential_value || body.credentialValue || null,
        credentialRef: body.credential_ref || body.credentialRef || null,
        credentialId: body.credential_id || body.credentialId || null,
        subjectId: body.subject_id || body.subjectId || null,
        customerId: body.customer_id || body.customerId || null,
        membershipId: body.membership_id || body.membershipId || null,
        vertical: body.vertical || tokenMeta.vertical || 'fitness',
        biometricRef: body.biometric_ref || body.biometricRef || null,
        rawPayload: {
          ...body,
          public_token_id: resolved.tokenId,
          public_location_id: resolved.locationId || null,
          public_token_kind: resolved.kind,
        },
      });
      const device = deviceId
        ? await accessControlService.getDevice({ tenantId: resolved.tenantId, id: deviceId })
        : null;
      const executionCommand = device
        ? buildVendorCommand({
          vendor: device.vendor,
          decision: result.decision,
          device,
          token: result.token,
        })
        : null;

      try {
        logAction({
          agentId: 'public',
          username: 'public',
          tenantId: resolved.tenantId,
          action: 'physical_access_resolve',
          resource: 'access_decision',
          resourceId: result?.decision?.id || null,
          details: {
            publicTokenId: resolved.tokenId,
            deviceId: deviceId || null,
            decision: result?.decision?.decision || null,
            reasonCode: result?.decision?.reason_code || null,
          },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, ...result, execution_command: executionCommand });
    } catch (err) {
      logger.error('[Physical] Erro ao resolver acesso:', err);
      const code = err && err.code ? String(err.code) : null;
      if (code && code.startsWith('invalid_biometric_ref')) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Biometria inválida' });
        return true;
      }
      if (code === 'biometric_ref_expired') {
        sendJson(res, 401, { error: 'unauthorized', message: 'Biometria expirada' });
        return true;
      }
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao resolver acesso físico' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/access/events') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const resolved = await resolvePublicTokenByKind(req, res, sendJson, 'access_control');
      if (!resolved) return true;

      const allowed = await enforcePublicRateLimit(
        resolved,
        req,
        res,
        sendJson,
        checkRateLimit,
        'PUBLIC_TOKEN_ACCESS_CONTROL',
      );
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const tokenMeta = (resolved && resolved.meta && typeof resolved.meta === 'object') ? resolved.meta : {};
      const boundDeviceId = tokenMeta.deviceId ? String(tokenMeta.deviceId) : null;
      const requestedDeviceId = body && (body.device_id || body.deviceId) ? String(body.device_id || body.deviceId) : null;
      const deviceId = boundDeviceId || requestedDeviceId;

      if (boundDeviceId && requestedDeviceId && boundDeviceId !== requestedDeviceId) {
        sendJson(res, 403, { error: 'forbidden', message: 'device_id divergente do token público' });
        return true;
      }

      const { createEvent } = require('../access-control/accessControlService');
      const item = await createEvent({
        tenantId: resolved.tenantId,
        payload: {
          ...body,
          device_id: deviceId,
          metadata: {
            ...((body && body.metadata && typeof body.metadata === 'object') ? body.metadata : {}),
            publicTokenId: resolved.tokenId,
            publicLocationId: resolved.locationId || null,
            reportedBy: 'public_access_device',
          },
        },
      });

      try {
        logAction({
          agentId: 'public',
          username: 'public',
          tenantId: resolved.tenantId,
          action: 'physical_access_event',
          resource: 'access_event',
          resourceId: item?.id || null,
          details: {
            publicTokenId: resolved.tokenId,
            deviceId: deviceId || null,
            eventType: item?.event_type || body?.event_type || null,
          },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, item });
    } catch (err) {
      logger.error('[Physical] Erro ao registrar evento de acesso:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao registrar evento de acesso físico' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/access/ack') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const resolved = await resolvePublicTokenByKind(req, res, sendJson, 'access_control');
      if (!resolved) return true;

      const allowed = await enforcePublicRateLimit(
        resolved,
        req,
        res,
        sendJson,
        checkRateLimit,
        'PUBLIC_TOKEN_ACCESS_CONTROL',
      );
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const tokenMeta = (resolved && resolved.meta && typeof resolved.meta === 'object') ? resolved.meta : {};
      const boundDeviceId = tokenMeta.deviceId ? String(tokenMeta.deviceId) : null;
      const requestedDeviceId = body && (body.device_id || body.deviceId) ? String(body.device_id || body.deviceId) : null;
      const deviceId = boundDeviceId || requestedDeviceId;

      if (boundDeviceId && requestedDeviceId && boundDeviceId !== requestedDeviceId) {
        sendJson(res, 403, { error: 'forbidden', message: 'device_id divergente do token público' });
        return true;
      }

      const { createEvent } = require('../access-control/accessControlService');
      const ackStatus = body && body.status ? String(body.status).trim().toLowerCase() : 'unknown';
      const item = await createEvent({
        tenantId: resolved.tenantId,
        payload: {
          device_id: deviceId,
          subject_id: body.subject_id || body.subjectId || null,
          credential_id: body.credential_id || body.credentialId || null,
          decision_id: body.decision_id || body.decisionId || null,
          event_type: 'device_callback',
          direction: body.direction || null,
          reason_code: body.reason_code || body.reasonCode || null,
          occurred_at: body.occurred_at || body.occurredAt || new Date(),
          raw_payload: {
            ack: true,
            status: ackStatus,
            command: body.command || null,
            vendor: body.vendor || tokenMeta.vendor || null,
            hardware_response: body.hardware_response || body.hardwareResponse || null,
          },
          metadata: {
            ...((body && body.metadata && typeof body.metadata === 'object') ? body.metadata : {}),
            publicTokenId: resolved.tokenId,
            publicLocationId: resolved.locationId || null,
            reportedBy: 'public_access_device_ack',
          },
        },
      });

      try {
        logAction({
          agentId: 'public',
          username: 'public',
          tenantId: resolved.tenantId,
          action: 'physical_access_ack',
          resource: 'access_event',
          resourceId: item?.id || null,
          details: {
            publicTokenId: resolved.tokenId,
            deviceId: deviceId || null,
            ackStatus,
            decisionId: item?.decision_id || body?.decision_id || body?.decisionId || null,
          },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, item });
    } catch (err) {
      logger.error('[Physical] Erro ao registrar ack de acesso:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao registrar confirmação do hardware' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handlePhysicalAccessControlPublicRoutes,
};
