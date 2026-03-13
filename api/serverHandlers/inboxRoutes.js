async function handleInboxRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    listAllTickets,
    getTicket,
    canAccessTicket,
    canModifyTicket,
    assignTicket,
    transferTicket,
    addTicketNote,
    triggerWebhooks,
    emitEvent,
    logAction,
    logger,
  } = deps;

  if (!pathname.startsWith('/inbox/')) {
    return false;
  }

  // GET /inbox/conversations
  if (method === 'GET' && pathname === '/inbox/conversations') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status');
    const queue = urlObj.searchParams.get('queue');
    const assignedTo = urlObj.searchParams.get('assignedTo');
    const limitRaw = urlObj.searchParams.get('limit');
    const offsetRaw = urlObj.searchParams.get('offset');

    const base = listAllTickets({
      tenantId: req.tenantId,
      status: status && status !== 'open' ? status : undefined,
      queue,
      limit: 10000,
      offset: 0,
    });

    let list = Array.isArray(base.tickets) ? base.tickets : [];

    if (!status || status === 'open') {
      list = list.filter((ticket) => ticket.status !== 'closed');
    }

    if (assignedTo) {
      list = list.filter((ticket) => ticket.assignedTo === assignedTo);
    }

    if (req.agent.role === 'agent') {
      list = list.filter((ticket) => canAccessTicket(req.agent, ticket));
    }

    const total = list.length;
    const limit = Math.min(Math.max(1, parseInt(limitRaw, 10) || 200), 10000);
    const offset = Math.max(0, parseInt(offsetRaw, 10) || 0);
    const paginated = list.slice(offset, offset + limit);

    sendJson(res, 200, { tickets: paginated, total, limit, offset });
    return true;
  }

  // GET /inbox/conversations/:id
  if (
    method === 'GET' &&
    pathname.startsWith('/inbox/conversations/') &&
    !pathname.endsWith('/assign') &&
    !pathname.endsWith('/transfer') &&
    !pathname.endsWith('/notes')
  ) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/inbox/conversations/'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    if (!canAccessTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return true;
    }

    sendJson(res, 200, ticket);
    return true;
  }

  // POST /inbox/conversations/:id/assign
  if (method === 'POST' && pathname.startsWith('/inbox/conversations/') && pathname.endsWith('/assign')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'assign');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/inbox/conversations/'.length, -'/assign'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      let assignedTo = req.agent.id;
      if (body && body.assignedTo) {
        if (req.agent.role === 'admin' || req.agent.role === 'supervisor') {
          assignedTo = String(body.assignedTo);
        } else {
          assignedTo = req.agent.id;
        }
      }

      const updatedTicket = assignTicket(id, assignedTo);
      if (!updatedTicket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }

      const tenantId = req.tenantId;
      triggerWebhooks(tenantId, 'ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para ticket.assigned (inbox):', err);
      });

      emitEvent('ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
        ticket: updatedTicket,
      }, { tenantId, agentId: assignedTo });

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_assign',
        resource: 'ticket',
        resourceId: id,
        details: { assignedTo, source: 'inbox' },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, updatedTicket);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atribuir ticket (inbox):', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /inbox/conversations/:id/transfer
  if (method === 'POST' && pathname.startsWith('/inbox/conversations/') && pathname.endsWith('/transfer')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/inbox/conversations/'.length, -'/transfer'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    if (!canModifyTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para modificar este ticket' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const queue = body && body.queue ? String(body.queue).trim() : null;
      if (!queue) {
        badRequest(res, 'queue é obrigatório');
        return true;
      }

      let assignedTo;
      if (Object.prototype.hasOwnProperty.call(body || {}, 'assignedTo')) {
        if (body.assignedTo === null || body.assignedTo === '') {
          assignedTo = null;
        } else if (req.agent.role === 'admin' || req.agent.role === 'supervisor') {
          assignedTo = String(body.assignedTo);
        } else {
          assignedTo = req.agent.id;
        }
      } else {
        assignedTo = null;
      }

      const updatedTicket = transferTicket(id, { queue, assignedTo });
      if (!updatedTicket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }

      emitEvent('ticket.updated', {
        ticketId: id,
        ticket: updatedTicket,
        updatedBy: req.agent.id,
      }, { tenantId: req.tenantId });

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_transfer',
        resource: 'ticket',
        resourceId: id,
        details: { queue, assignedTo, source: 'inbox' },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, updatedTicket);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao transferir ticket (inbox):', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /inbox/conversations/:id/notes
  if (method === 'POST' && pathname.startsWith('/inbox/conversations/') && pathname.endsWith('/notes')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'tickets', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/inbox/conversations/'.length, -'/notes'.length));
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    if (!canModifyTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para modificar este ticket' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const note = body && body.note ? String(body.note).trim() : '';
      if (!note) {
        badRequest(res, 'note é obrigatório');
        return true;
      }

      const updatedTicket = addTicketNote(id, note, req.agent);
      if (!updatedTicket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }

      emitEvent('ticket.updated', {
        ticketId: id,
        ticket: updatedTicket,
        updatedBy: req.agent.id,
      }, { tenantId: req.tenantId });

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_note',
        resource: 'ticket',
        resourceId: id,
        details: { noteLength: note.length, source: 'inbox' },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, updatedTicket);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao adicionar nota (inbox):', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleInboxRoutes };
