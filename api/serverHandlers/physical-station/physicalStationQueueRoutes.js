const { resolveStationToken, enforceStationRateLimit, getIpAddress } = require('./physicalStationHelpers');

async function handlePhysicalStationQueueRoutes(ctx) {
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

  // POST /physical/station/call-next
  if (method === 'POST' && pathname === '/physical/station/call-next') {
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
      const stationId = body && body.stationId ? String(body.stationId).trim() : null;
      const { callNext } = require('../../services/physicalQueueService');
      const ticket = await callNext({ tenantId: resolved.tenantId, locationId: resolved.locationId, stationId });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_call_next',
          resource: 'physical_ticket',
          resourceId: ticket?.id || null,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            stationId: stationId || null,
            ticketFound: !!ticket,
            ticketNumber: ticket?.ticket_number || null,
          },
          ipAddress: getIpAddress(req),
          userAgent: req.headers['user-agent'] || 'unknown',
        });
      } catch (_) {}

      sendJson(res, 200, { ok: true, ticket });
    } catch (err) {
      logger.error('[Physical] Erro ao chamar próximo:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao chamar próximo' });
    }

    return true;
  }

  // POST /physical/station/transfer
  if (method === 'POST' && pathname === '/physical/station/transfer') {
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
      const toQueueId = body && body.toQueueId ? String(body.toQueueId).trim() : '';
      const idempotencyKey = body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null;
      if (!ticketId || !toQueueId) {
        badRequest(res, 'Campos "ticketId" e "toQueueId" são obrigatórios');
        return true;
      }

      const { transferTicket } = require('../../services/physicalQueueService');
      const ticket = await transferTicket({ tenantId: resolved.tenantId, ticketId, toQueueId, idempotencyKey });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_transfer',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
            toQueueId,
            idempotencyKey: idempotencyKey || null,
          },
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
      logger.error('[Physical] Erro ao transferir senha:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao transferir senha' });
    }

    return true;
  }

  return false;
}

module.exports = { handlePhysicalStationQueueRoutes };
