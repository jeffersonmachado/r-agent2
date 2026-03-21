const { resolveStationToken, enforceStationRateLimit } = require('./physicalStationHelpers');

async function handlePhysicalStationSupportRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    checkRateLimit,
    createTicket,
  } = deps;

  if (method !== 'POST' || pathname !== '/physical/station/open-support-ticket') {
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
    const physicalTicketId = body && body.ticketId ? String(body.ticketId).trim() : '';
    const queue = body && body.queue ? String(body.queue).trim() : 'FastService';
    const message = body && body.message ? String(body.message).trim() : 'Atendimento físico: suporte solicitado';
    if (!physicalTicketId) {
      badRequest(res, 'Campo "ticketId" é obrigatório');
      return true;
    }

    const { PhysicalTicket } = require('../../../db/models');
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
      const { appendEventV1 } = require('../../../services/eventLedgerService');
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

module.exports = { handlePhysicalStationSupportRoutes };
