const { resolveStationToken, enforceStationRateLimit, getIpAddress } = require('./physicalStationHelpers');

async function handlePhysicalStationServiceRoutes(ctx) {
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

  const stationActionHandlers = {
    '/physical/station/finish': {
      action: 'physical_station_finish',
      serviceMethod: 'finishTicket',
      errorMessage: 'Erro ao finalizar atendimento',
      detailsMapper: ({ ticket, ticketId, resolved }) => ({
        kind: 'station',
        publicTokenId: resolved.tokenId,
        locationId: resolved.locationId || null,
        ticketId,
        ticketNumber: ticket?.ticket_number || null,
        stationId: ticket?.station_id || null,
      }),
    },
    '/physical/station/start': {
      action: 'physical_station_start_service',
      serviceMethod: 'startService',
      errorMessage: 'Erro ao iniciar atendimento',
      detailsMapper: ({ ticket, ticketId, stationId, idempotencyKey, resolved }) => ({
        kind: 'station',
        publicTokenId: resolved.tokenId,
        locationId: resolved.locationId || null,
        stationId: stationId || ticket?.station_id || null,
        ticketId,
        ticketNumber: ticket?.ticket_number || null,
        idempotencyKey: idempotencyKey || null,
      }),
    },
    '/physical/station/skip': {
      action: 'physical_station_skip',
      serviceMethod: 'skipTicket',
      errorMessage: 'Erro ao pular senha',
      detailsMapper: ({ ticket, ticketId, stationId, reason, idempotencyKey, resolved }) => ({
        kind: 'station',
        publicTokenId: resolved.tokenId,
        locationId: resolved.locationId || null,
        stationId: stationId || null,
        ticketId,
        ticketNumber: ticket?.ticket_number || null,
        reason: reason || null,
        idempotencyKey: idempotencyKey || null,
      }),
    },
    '/physical/station/pause': {
      action: 'physical_station_pause',
      serviceMethod: 'pauseService',
      errorMessage: 'Erro ao pausar atendimento',
      detailsMapper: ({ ticket, ticketId, stationId, reason, idempotencyKey, resolved }) => ({
        kind: 'station',
        publicTokenId: resolved.tokenId,
        locationId: resolved.locationId || null,
        stationId: stationId || null,
        ticketId,
        ticketNumber: ticket?.ticket_number || null,
        reason: reason || null,
        idempotencyKey: idempotencyKey || null,
      }),
    },
    '/physical/station/resume': {
      action: 'physical_station_resume',
      serviceMethod: 'resumeService',
      errorMessage: 'Erro ao retomar atendimento',
      detailsMapper: ({ ticket, ticketId, stationId, idempotencyKey, resolved }) => ({
        kind: 'station',
        publicTokenId: resolved.tokenId,
        locationId: resolved.locationId || null,
        stationId: stationId || null,
        ticketId,
        ticketNumber: ticket?.ticket_number || null,
        idempotencyKey: idempotencyKey || null,
      }),
    },
    '/physical/station/abandon': {
      action: 'physical_station_abandon',
      serviceMethod: 'abandonTicket',
      errorMessage: 'Erro ao abandonar senha',
      detailsMapper: ({ ticket, ticketId, stationId, reason, idempotencyKey, resolved }) => ({
        kind: 'station',
        publicTokenId: resolved.tokenId,
        locationId: resolved.locationId || null,
        stationId: stationId || null,
        ticketId,
        ticketNumber: ticket?.ticket_number || null,
        reason: reason || null,
        idempotencyKey: idempotencyKey || null,
      }),
    },
  };

  const routeConfig = stationActionHandlers[pathname];
  if (method !== 'POST' || !routeConfig) {
    return false;
  }

  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const resolved = await resolveStationToken(req, res, sendJson);
    if (!resolved) return true;

    const allowed = await enforceStationRateLimit(resolved, req, res, sendJson, checkRateLimit);
    if (!allowed) return true;

    const body = await parseJsonBody(req);
    const ticketId = body && body.ticketId ? String(body.ticketId).trim() : '';
    const stationId = body && body.stationId ? String(body.stationId).trim() : null;
    const reason = body && body.reason ? String(body.reason).trim() : null;
    const idempotencyKey = body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null;

    if (!ticketId) {
      badRequest(res, 'Campo "ticketId" é obrigatório');
      return true;
    }

    const serviceArgs = { tenantId: resolved.tenantId, ticketId };
    if (routeConfig.serviceMethod !== 'finishTicket') {
      if (stationId) serviceArgs.stationId = stationId;
      if (idempotencyKey) serviceArgs.idempotencyKey = idempotencyKey;
    }
    if (routeConfig.serviceMethod === 'skipTicket' || routeConfig.serviceMethod === 'pauseService' || routeConfig.serviceMethod === 'abandonTicket') {
      if (reason) serviceArgs.reason = reason;
    }

    const physicalQueue = require('../../services/physicalQueueService');
    const ticket = await physicalQueue[routeConfig.serviceMethod](serviceArgs);

    try {
      logAction({
        agentId: null,
        username: null,
        tenantId: resolved.tenantId,
        action: routeConfig.action,
        resource: 'physical_ticket',
        resourceId: ticket?.id || ticketId,
        details: routeConfig.detailsMapper({ ticket, ticketId, stationId, reason, idempotencyKey, resolved }),
        ipAddress: getIpAddress(req),
        userAgent: req.headers['user-agent'] || 'unknown',
      });
    } catch (_) {}

    sendJson(res, 200, { ok: true, ticket });
  } catch (err) {
    if (err && err.code === 'physical_ticket_not_found') {
      sendJson(res, 404, { error: 'ticket_not_found', message: 'Senha não encontrada' });
      return true;
    }
    if (err && err.code === 'physical_ticket_invalid_transition') {
      sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
      return true;
    }
    logger.error(`[Physical] ${routeConfig.errorMessage}:`, err);
    sendJson(res, 500, { error: 'internal_error', message: routeConfig.errorMessage });
  }

  return true;
}

module.exports = { handlePhysicalStationServiceRoutes };
