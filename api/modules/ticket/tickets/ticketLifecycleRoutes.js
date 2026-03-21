const {
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureTicketPermission,
  getTicketAndValidateAccess,
  logTicketAction,
  parseTicketRouteId,
} = require('./ticketRouteUtils');

async function parseOptionalReason(req, deps, fallbackReason) {
  if (!deps.hasJsonContentType(req)) {
    return fallbackReason;
  }

  try {
    const body = await deps.parseJsonBody(req);
    if (body?.reason) {
      return String(body.reason);
    }
  } catch {}

  return fallbackReason;
}

async function handleTicketLifecycleRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota de lifecycle de tickets');

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/assign')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'assign' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    const id = parseTicketRouteId(pathname, '/assign');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
    if (!ticket) return true;

    try {
      const body = await deps.parseJsonBody(req);
      let assignedTo = req.agent.id;

      if (body && body.assignedTo) {
        if (req.agent.role === 'admin' || req.agent.role === 'supervisor') {
          assignedTo = String(body.assignedTo);
        } else {
          assignedTo = req.agent.id;
        }
      }

      const updatedTicket = deps.assignTicket(id, assignedTo);
      if (!updatedTicket) {
        deps.sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }

      deps.triggerWebhooks(req.tenantId, 'ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
      }).catch((err) => {
        deps.logger.error('[Webhook] Erro ao disparar webhook para ticket.assigned:', err);
      });

      deps.emitEvent('ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
        ticket: updatedTicket,
      }, { tenantId: req.tenantId, agentId: assignedTo });

      logTicketAction({
        req,
        deps,
        action: 'ticket_assign',
        resourceId: id,
        details: { assignedTo },
      });

      deps.sendJson(res, 200, updatedTicket);
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        return respondInternalError(err, { logMessage: 'Erro ao atribuir ticket:' });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/takeover')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'update' })) return true;

    const id = parseTicketRouteId(pathname, '/takeover');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
    if (!ticket) return true;

    const reason = await parseOptionalReason(req, deps, 'agent_takeover');
    const result = await deps.takeOverTicket(id, req.agent, reason);
    if (!result.success) {
      deps.sendJson(res, 400, { error: result.error || 'handover_failed' });
      return true;
    }

    logTicketAction({
      req,
      deps,
      action: 'ticket_takeover',
      resourceId: id,
      details: { reason },
    });

    deps.sendJson(res, 200, result.ticket);
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/return-to-bot')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'update' })) return true;

    const id = parseTicketRouteId(pathname, '/return-to-bot');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
    if (!ticket) return true;

    const reason = await parseOptionalReason(req, deps, 'user_request');
    const result = await deps.returnTicketToBot(id, req.agent, reason);
    if (!result.success) {
      deps.sendJson(res, 400, { error: result.error || 'handover_failed' });
      return true;
    }

    logTicketAction({
      req,
      deps,
      action: 'ticket_return_to_bot',
      resourceId: id,
      details: { reason },
    });

    deps.sendJson(res, 200, result.ticket);
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/pause')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'update' })) return true;

    const id = parseTicketRouteId(pathname, '/pause');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
    if (!ticket) return true;

    const reason = await parseOptionalReason(req, deps, 'outside_window');
    const result = await deps.pauseTicket(id, req.agent, reason);
    if (!result.success) {
      deps.sendJson(res, 400, { error: result.error || 'handover_failed' });
      return true;
    }

    logTicketAction({
      req,
      deps,
      action: 'ticket_pause',
      resourceId: id,
      details: { reason },
    });

    deps.sendJson(res, 200, result.ticket);
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/resume')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'update' })) return true;

    const id = parseTicketRouteId(pathname, '/resume');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, allowWithoutAccessCheck: true });
    if (!ticket) return true;

    const reason = await parseOptionalReason(req, deps, 'resume');
    const result = await deps.resumeHumanTicket(id, req.agent, reason);
    if (!result.success) {
      deps.sendJson(res, 400, { error: result.error || 'handover_failed' });
      return true;
    }

    logTicketAction({
      req,
      deps,
      action: 'ticket_resume',
      resourceId: id,
      details: { reason },
    });

    deps.sendJson(res, 200, result.ticket);
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/close')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'close' })) return true;

    const id = parseTicketRouteId(pathname, '/close');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, requireModify: true });
    if (!ticket) return true;

    let closeReason = null;
    let closeReasonId = null;
    let closeReasonName = null;
    let closeTags = null;
    if (deps.hasJsonContentType(req)) {
      try {
        const body = await deps.parseJsonBody(req);
        closeReasonId = body?.closeReasonId ? String(body.closeReasonId) : null;
        closeReasonName = body?.closeReasonName ? String(body.closeReasonName) : null;
        if (Array.isArray(body?.tags)) {
          closeTags = body.tags.map((t) => String(t).trim()).filter(Boolean);
        } else if (typeof body?.tags === 'string') {
          closeTags = body.tags.split(',').map((t) => String(t).trim()).filter(Boolean);
        }
      } catch {}
    }

    try {
      await deps.closeReasonsService.ensureDefaultsForTenant(req.tenantId);
    } catch {}

    if (closeReasonId) {
      closeReason = deps.closeReasonsService.getCloseReason(closeReasonId);
    }
    if (!closeReason && closeReasonName) {
      try {
        const created = await deps.closeReasonsService.getOrCreateCloseReasonByName({
          tenantId: req.tenantId,
          name: closeReasonName,
          createdBy: req.agent.id,
        });
        if (created?.success) closeReason = created.reason;
      } catch {
        closeReason = { id: null, name: closeReasonName };
      }
    }
    if (!closeReason) {
      try {
        const created = await deps.closeReasonsService.getOrCreateCloseReasonByName({
          tenantId: req.tenantId,
          name: 'Sem motivo informado',
          createdBy: 'system',
        });
        if (created?.success) closeReason = created.reason;
      } catch {
        closeReason = { id: null, name: 'Sem motivo informado' };
      }
    }

    try {
      const { updateTicket } = require('../../../services/queueService');
      updateTicket(id, {
        context: {
          ...(ticket.context || {}),
          closeReason: closeReason ? { id: closeReason.id || null, name: closeReason.name } : null,
          closeReasonName: closeReason?.name || null,
          closedBy: { id: req.agent.id, username: req.agent.username },
          closedAt: new Date().toISOString(),
        },
      });
    } catch {}

    if (closeTags && Array.isArray(closeTags) && closeTags.length > 0) {
      try {
        const { addTagToTicket } = require('../../../services/segmentationService');
        const unique = Array.from(new Set(closeTags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))).slice(0, 20);
        for (const t of unique) {
          // eslint-disable-next-line no-await-in-loop
          addTagToTicket(id, t);
        }
      } catch {}
    }

    const closedTicket = deps.closeTicket(id);
    if (!closedTicket) {
      deps.sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    deps.triggerWebhooks(req.tenantId, 'ticket.closed', {
      ticketId: id,
      closedBy: req.agent.id,
    }).catch((err) => {
      deps.logger.error('[Webhook] Erro ao disparar webhook para ticket.closed:', err);
    });

    deps.emitEvent('ticket.closed', {
      ticketId: id,
      closedBy: req.agent.id,
      ticket: closedTicket,
    }, { tenantId: req.tenantId, agentId: closedTicket.assignedTo });

    logTicketAction({
      req,
      deps,
      action: 'ticket_close',
      resourceId: id,
    });

    deps.sendJson(res, 200, closedTicket);
    return true;
  }

  if (method === 'GET' && pathname === '/close-reasons') {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const activeOnly = urlObj.searchParams.get('activeOnly');
      const list = deps.closeReasonsService.listCloseReasons({
        tenantId: req.tenantId,
        activeOnly: activeOnly === null ? true : activeOnly !== 'false',
      });
      deps.sendJson(res, 200, { closeReasons: list });
    } catch (err) {
      return respondInternalError(err, { logMessage: 'Erro ao listar close reasons:' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleTicketLifecycleRoutes,
};
