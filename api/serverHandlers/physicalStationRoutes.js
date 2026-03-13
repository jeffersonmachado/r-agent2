async function resolveStationToken(req, res, sendJson) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const token = urlObj.searchParams.get('token');
  if (!token) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token obrigatório' });
    return null;
  }

  const { resolvePublicToken } = require('../services/publicAccessTokenService');
  const resolved = await resolvePublicToken({ token, allowedKinds: ['station'] });
  if (!resolved.ok) {
    sendJson(res, 401, { error: 'unauthorized', message: 'Token inválido' });
    return null;
  }

  return resolved;
}

async function enforceStationRateLimit(resolved, req, res, sendJson, checkRateLimit) {
  const rl = await checkRateLimit({
    userId: `publicToken:${resolved.tokenId}`,
    operationType: 'PUBLIC_TOKEN_STATION',
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

async function handlePhysicalStationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    checkRateLimit,
    logAction,
    createTicket,
  } = deps;

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
      const { callNext } = require('../services/physicalQueueService');
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

  if (method === 'POST' && pathname === '/physical/station/finish') {
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
      if (!ticketId) {
        badRequest(res, 'Campo "ticketId" é obrigatório');
        return true;
      }

      const { finishTicket } = require('../services/physicalQueueService');
      const ticket = await finishTicket({ tenantId: resolved.tenantId, ticketId });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_finish',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
            stationId: ticket?.station_id || null,
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
      if (err && err.code === 'physical_ticket_invalid_transition') {
        sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
        return true;
      }
      logger.error('[Physical] Erro ao finalizar atendimento:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao finalizar atendimento' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/station/start') {
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
      const idempotencyKey = body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null;
      if (!ticketId) {
        badRequest(res, 'Campo "ticketId" é obrigatório');
        return true;
      }

      const { startService } = require('../services/physicalQueueService');
      const ticket = await startService({ tenantId: resolved.tenantId, ticketId, stationId, idempotencyKey });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_start_service',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            stationId: stationId || ticket?.station_id || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
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
      if (err && err.code === 'physical_ticket_invalid_transition') {
        sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
        return true;
      }
      logger.error('[Physical] Erro ao iniciar atendimento:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao iniciar atendimento' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/station/skip') {
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

      const { skipTicket } = require('../services/physicalQueueService');
      const ticket = await skipTicket({ tenantId: resolved.tenantId, ticketId, stationId, reason, idempotencyKey });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_skip',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            stationId: stationId || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
            reason: reason || null,
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
      if (err && err.code === 'physical_ticket_invalid_transition') {
        sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
        return true;
      }
      logger.error('[Physical] Erro ao pular senha:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao pular senha' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/station/pause') {
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

      const { pauseService } = require('../services/physicalQueueService');
      const ticket = await pauseService({ tenantId: resolved.tenantId, ticketId, stationId, reason, idempotencyKey });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_pause',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            stationId: stationId || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
            reason: reason || null,
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
      if (err && err.code === 'physical_ticket_invalid_transition') {
        sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
        return true;
      }
      logger.error('[Physical] Erro ao pausar atendimento:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao pausar atendimento' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/station/resume') {
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
      const idempotencyKey = body && body.idempotencyKey ? String(body.idempotencyKey).trim() : null;
      if (!ticketId) {
        badRequest(res, 'Campo "ticketId" é obrigatório');
        return true;
      }

      const { resumeService } = require('../services/physicalQueueService');
      const ticket = await resumeService({ tenantId: resolved.tenantId, ticketId, stationId, idempotencyKey });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_resume',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            stationId: stationId || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
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
      if (err && err.code === 'physical_ticket_invalid_transition') {
        sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
        return true;
      }
      logger.error('[Physical] Erro ao retomar atendimento:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao retomar atendimento' });
    }

    return true;
  }

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

      const { transferTicket } = require('../services/physicalQueueService');
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

  if (method === 'POST' && pathname === '/physical/station/abandon') {
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

      const { abandonTicket } = require('../services/physicalQueueService');
      const ticket = await abandonTicket({ tenantId: resolved.tenantId, ticketId, stationId, reason, idempotencyKey });

      try {
        logAction({
          agentId: null,
          username: null,
          tenantId: resolved.tenantId,
          action: 'physical_station_abandon',
          resource: 'physical_ticket',
          resourceId: ticket?.id || ticketId,
          details: {
            kind: 'station',
            publicTokenId: resolved.tokenId,
            locationId: resolved.locationId || null,
            stationId: stationId || null,
            ticketId,
            ticketNumber: ticket?.ticket_number || null,
            reason: reason || null,
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
      if (err && err.code === 'physical_ticket_invalid_transition') {
        sendJson(res, 409, { error: 'invalid_transition', message: 'Transição de estado inválida' });
        return true;
      }
      logger.error('[Physical] Erro ao abandonar senha:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao abandonar senha' });
    }

    return true;
  }

  if (method === 'POST' && pathname === '/physical/station/open-support-ticket') {
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
      const physicalTicketId = body && body.ticketId ? String(body.ticketId).trim() : '';
      const queue = body && body.queue ? String(body.queue).trim() : 'FastService';
      const message = body && body.message ? String(body.message).trim() : 'Atendimento físico: suporte solicitado';
      if (!physicalTicketId) {
        badRequest(res, 'Campo "ticketId" é obrigatório');
        return true;
      }

      const { PhysicalTicket } = require('../db/models');
      const TicketModel = PhysicalTicket();
      const row = await TicketModel.findOne({ where: { tenant_key: resolved.tenantId, id: physicalTicketId } });
      if (!row) {
        sendJson(res, 404, { error: 'ticket_not_found', message: 'Senha não encontrada' });
        return true;
      }
      const json = row.toJSON ? row.toJSON() : row;

      const existingSupportId = json?.context?.supportTicketId || null;
      if (existingSupportId) {
        sendJson(res, 200, { ok: true, idempotent: true, ticketId: existingSupportId });
        return true;
      }

      const sessionId = `physical_${physicalTicketId}`;
      const ticket = createTicket({
        tenantId: resolved.tenantId,
        sessionId,
        queue,
        lastUserMessage: message,
        context: {
          escalationReason: 'physical_support_ticket',
          metadata: {
            kind: 'physical_support_ticket',
            physicalTicketId,
            ticketNumber: json.ticket_number,
            locationId: json?.context?.locationId || resolved.locationId || null,
            correlationId: json?.context?.correlationId || null,
          },
        },
        tags: ['fast_service', 'physical'],
      });

      try {
        await row.update({
          context: { ...(json.context || {}), supportTicketId: ticket.id },
        });
      } catch (_) {}

      try {
        const { appendEventV1 } = require('../services/eventLedgerService');
        await appendEventV1({
          tenantId: resolved.tenantId,
          type: 'SupportTicketOpened',
          source: 'physical.station',
          occurredAt: new Date(),
          correlationId: json?.context?.correlationId || null,
          subject: { type: 'physical_ticket', id: physicalTicketId },
          actor: { type: 'public_token', id: String(resolved.tokenId) },
          idempotencyKey: `physical_support_ticket:${resolved.tenantId}:${physicalTicketId}:${ticket.id}`,
          payload: {
            ticketId: ticket.id,
            queue,
            physicalTicketId,
          },
        });
      } catch (_) {}

      sendJson(res, 201, { ok: true, ticket });
    } catch (err) {
      logger.error('[Physical] Erro ao abrir ticket digital:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao abrir ticket digital' });
    }

    return true;
  }

  return false;
}

module.exports = {
  handlePhysicalStationRoutes,
};
