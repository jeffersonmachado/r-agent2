function ensureTicketPermission({ req, res, deps, permission }) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = deps.requirePermission(req, 'tickets', permission);
  if (!permResult.allowed) {
    deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function ensureQueuePermission({ req, res, deps, permission }) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = deps.requirePermission(req, 'queues', permission);
  if (!permResult.allowed) {
    deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function ensureJsonRequest({ req, res, deps }) {
  if (!deps.hasJsonContentType(req)) {
    deps.badRequest(res, 'Content-Type deve ser application/json');
    return false;
  }

  return true;
}

function createInternalErrorResponder(req, res, deps, fallbackMessage) {
  return (err, { logMessage = fallbackMessage, clientMessage = 'internal_error' } = {}) => {
    deps.logger.error(logMessage, err);
    if (clientMessage === 'internal_error') {
      deps.sendJson(res, 500, { error: 'internal_error' });
    } else {
      deps.sendJson(res, 500, {
        error: 'internal_error',
        message: clientMessage,
      });
    }
    return true;
  };
}

function logTicketAction({ req, deps, action, resource = 'ticket', resourceId, details }) {
  if (!deps.logAction || !req?.agent?.id) {
    return;
  }

  deps.logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    action,
    resource,
    resourceId,
    details,
    tenantId: req.tenantId,
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });
}

function getTicketAndValidateAccess({ req, res, deps, ticketId, requireModify = false, allowWithoutAccessCheck = false }) {
  const ticket = deps.getTicket(ticketId);
  if (!ticket) {
    deps.sendJson(res, 404, { error: 'ticket_not_found' });
    return null;
  }

  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    deps.sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return null;
  }

  if (!allowWithoutAccessCheck) {
    if (requireModify) {
      if (!deps.canModifyTicket(req.agent, ticket)) {
        deps.sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para modificar este ticket' });
        return null;
      }
    } else if (!deps.canAccessTicket(req.agent, ticket)) {
      deps.sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return null;
    }
  }

  return ticket;
}

function parseTicketRouteId(pathname, suffix = '') {
  const end = suffix ? -suffix.length : undefined;
  return decodeURIComponent(pathname.slice('/tickets/'.length, end));
}

module.exports = {
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureQueuePermission,
  ensureTicketPermission,
  getTicketAndValidateAccess,
  logTicketAction,
  parseTicketRouteId,
};
