async function resolvePublicTokenByKind(req, res, sendJson, kind) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const token = urlObj.searchParams.get('token');
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
    return null;
  }

  const { resolvePublicToken } = require('../../services/publicAccessTokenService');
  const resolved = await resolvePublicToken({ token, allowedKinds: [kind] });
  if (!resolved.ok) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
    return null;
  }

  return resolved;
}

async function enforcePublicRateLimit(resolved, req, res, sendJson, checkRateLimit, operationType) {
  const rl = await checkRateLimit({
    userId: `publicToken:${resolved.tokenId}`,
    operationType,
  });
  if (!rl.allowed) {
    res.setHeader('Retry-After', rl.retryAfter || 60);
    sendJson(res, 429, {
      error: 'rate_limit_exceeded',
      message: `Limite de requisições excedido. Tente novamente em ${rl.retryAfter || 60} segundos.`,
      retryAfter: rl.retryAfter || 60,
    });
    return false;
  }

  return true;
}

function getIpAddress(req) {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
}

async function handlePhysicalPublicRoutes(ctx) {
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

  if (method === 'POST' && pathname === '/physical/kiosk/tickets') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const resolved = await resolvePublicTokenByKind(req, res, sendJson, 'kiosk');
      if (!resolved) return true;

      const allowed = await enforcePublicRateLimit(
        resolved,
        req,
        res,
        sendJson,
        checkRateLimit,
        'PUBLIC_TOKEN_KIOSK',
      );
      if (!allowed) return true;

      const body = await parseJsonBody(req);
      const priority = body && body.priority != null ? Number(body.priority) : 0;
      const queueId = body && body.queueId ? String(body.queueId).trim() : null;
      const context = body && typeof body.context === 'object' && body.context ? body.context : {};
      const biometricMode = body && body.biometricMode ? String(body.biometricMode).trim() : null;
      const biometricRef = body && body.biometricRef ? String(body.biometricRef).trim() : null;
      const customerIdInput = body && body.customerIdInput ? String(body.customerIdInput).trim() : null;

      const tokenMeta = (resolved && resolved.meta && typeof resolved.meta === 'object') ? resolved.meta : {};
      const mode = biometricMode || (tokenMeta.biometricMode ? String(tokenMeta.biometricMode) : null);
      const requireBiometric = tokenMeta.requireBiometric === true;
      const biometricSecret = tokenMeta.biometricSecret || tokenMeta.biobridgeSecret || null;

      let biometric = null;
      if (mode || requireBiometric || biometricRef) {
        if (!mode) {
          sendJson(res, 400, { error: 'bad_request', message: 'biometricMode obrigatório quando biometria está habilitada' });
          return true;
        }
        if (requireBiometric && !biometricRef) {
          sendJson(res, 400, { error: 'bad_request', message: 'biometricRef obrigatório' });
          return true;
        }
        if (biometricRef) {
          const { verifyBiometricRef } = require('../../services/biometricService');
          biometric = verifyBiometricRef({
            secret: biometricSecret,
            ref: biometricRef,
            expectedTokenId: resolved.tokenId,
            expectedLocationId: resolved.locationId || null,
            allowedModes: ['identify-1n', 'verify-1to1', 'dedupe-only'],
            maxAgeSec: 180,
          });

          if (mode && biometric.mode !== mode) {
            sendJson(res, 400, { error: 'bad_request', message: 'biometricRef não corresponde ao biometricMode atual' });
            return true;
          }

          if (biometric.mode === 'verify-1to1') {
            if (!customerIdInput) {
              sendJson(res, 400, { error: 'bad_request', message: 'customerIdInput obrigatório no modo verify-1to1' });
              return true;
            }
            const expectedSubject = `cust:${customerIdInput}`;
            if (biometric.subjectId !== expectedSubject) {
              sendJson(res, 401, { error: 'unauthorized', message: 'Biometria não corresponde ao identificador informado' });
              return true;
            }
          }

          if (biometric.mode === 'dedupe-only') {
            try {
              const { PhysicalTicket } = require('../../db/models');
              const TicketModel = PhysicalTicket();
              const sequelize = TicketModel.sequelize;
              const locationId = resolved.locationId || null;
              if (sequelize && locationId) {
                const [rows] = await sequelize.query(
                  `SELECT id, tenant_key, physical_queue_id, ticket_number, status, priority, called_at, started_at, finished_at, station_id, context, created_at, updated_at
                   FROM physical_tickets
                   WHERE tenant_key = :tenantKey
                     AND status IN ('waiting','called')
                     AND (context->>'locationId') = :locationId
                     AND (context->>'biometricSubjectId') = :subjectId
                     AND created_at::date = CURRENT_DATE
                   ORDER BY created_at DESC
                   LIMIT 1`,
                  {
                    replacements: {
                      tenantKey: resolved.tenantId,
                      locationId: String(locationId),
                      subjectId: String(biometric.subjectId),
                    },
                  },
                );
                if (Array.isArray(rows) && rows.length > 0 && rows[0] && rows[0].id) {
                  sendJson(res, 200, { ok: true, ticket: rows[0], idempotent: true });
                  return true;
                }
              }
            } catch (_) {
              // best-effort: nao bloquear emissao de senha por falha no dedupe
            }
          }
        }
      }

      const { createTicket } = require('../../services/physicalQueueService');
      const ticket = await createTicket({
        tenantId: resolved.tenantId,
        locationId: resolved.locationId,
        queueId,
        priority,
        context: {
          ...context,
          publicTokenId: resolved.tokenId,
          locationId: resolved.locationId || null,
          idempotencyKey: (context && context.idempotencyKey) ? String(context.idempotencyKey) : null,
          biometricMode: biometric ? biometric.mode : (mode || null),
          biometricSubjectId: biometric ? biometric.subjectId : null,
          customerIdInput: customerIdInput || null,
        },
      });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_ticket_create',
          resource: 'physical_ticket',
          resourceId: ticket?.id || null,
          details: {
            kind: 'kiosk',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            queueId: ticket?.physical_queue_id || queueId || null,
            ticketNumber: ticket?.ticket_number || null,
            priority,
            biometricMode: biometric ? biometric.mode : (mode || null),
            biometricSubjectId: biometric ? biometric.subjectId : null,
          },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, ticket });
    } catch (err) {
      logger.error('[Physical] Erro ao criar senha:', err);
      const code = err && err.code ? String(err.code) : null;
      if (code && String(code).startsWith('invalid_biometric_ref')) {
        sendJson(res, 401, { error: 'unauthorized', message: 'Biometria inválida' });
        return true;
      }
      if (code === 'biometric_ref_expired') {
        sendJson(res, 401, { error: 'unauthorized', message: 'Biometria expirada' });
        return true;
      }
      if (code === 'biometric_secret_missing') {
        sendJson(res, 500, { error: 'internal_error', message: 'Biometria habilitada sem secret configurado' });
        return true;
      }
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao criar senha' });
    }

    return true;
  }

  if (method === 'GET' && pathname === '/physical/panel/state') {
    try {
      const resolved = await resolvePublicTokenByKind(req, res, sendJson, 'panel');
      if (!resolved) return true;

      const allowed = await enforcePublicRateLimit(
        resolved,
        req,
        res,
        sendJson,
        checkRateLimit,
        'PUBLIC_TOKEN_PANEL',
      );
      if (!allowed) return true;

      const { getPanelState } = require('../../services/physicalQueueService');
      const state = await getPanelState({ tenantId: resolved.tenantId, locationId: resolved.locationId });
      sendJson(res, 200, { ok: true, ...state });
    } catch (err) {
      logger.error('[Physical] Erro ao obter estado do painel:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter estado do painel' });
    }

    return true;
  }

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
  handlePhysicalPublicRoutes,
};
