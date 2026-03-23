const {
  resolvePublicTokenByKind,
  enforcePublicRateLimit,
  getIpAddress,
} = require('./handlePhysicalPublicRouteUtils');

async function handlePhysicalKioskPanelRoutes(ctx) {
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

  return false;
}

module.exports = {
  handlePhysicalKioskPanelRoutes,
};
