module.exports = { handleSegmentationRoutes };

async function handleSegmentationRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    getAllTags,
    getAllCategories,
    filterTickets,
    getSegmentationStats,
    getTicket,
    addTagToTicket,
    removeTagFromTicket,
    setTicketCategory,
  } = deps;

  if (method === 'GET' && pathname === '/segmentation/tags') {
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

    const tags = getAllTags({ tenantId: req.tenantId });
    sendJson(res, 200, { tags });
    return true;
  }

  if (method === 'GET' && pathname === '/segmentation/categories') {
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

    const categories = getAllCategories({ tenantId: req.tenantId });
    sendJson(res, 200, { categories });
    return true;
  }

  if (method === 'GET' && pathname === '/segmentation/tickets') {
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

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const filters = {
        tenantId: req.tenantId,
        tags: urlObj.searchParams.get('tags') ? urlObj.searchParams.get('tags').split(',') : undefined,
        category: urlObj.searchParams.get('category') || undefined,
        status: urlObj.searchParams.get('status') || undefined,
        queue: urlObj.searchParams.get('queue') || undefined,
        assignedTo: urlObj.searchParams.get('assignedTo') || undefined,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
        search: urlObj.searchParams.get('search') || undefined,
      };

      const tickets = filterTickets(filters);
      sendJson(res, 200, { tickets, count: tickets.length });
    } catch (err) {
      logger.error('Erro ao filtrar tickets:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/segmentation/stats') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'reports', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const filters = {
        tenantId: req.tenantId,
        tags: urlObj.searchParams.get('tags') ? urlObj.searchParams.get('tags').split(',') : undefined,
        category: urlObj.searchParams.get('category') || undefined,
        status: urlObj.searchParams.get('status') || undefined,
        queue: urlObj.searchParams.get('queue') || undefined,
        startDate: urlObj.searchParams.get('startDate') || undefined,
        endDate: urlObj.searchParams.get('endDate') || undefined,
      };

      const stats = getSegmentationStats(filters);
      sendJson(res, 200, stats);
    } catch (err) {
      logger.error('Erro ao obter estatísticas de segmentação:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/tags')) {
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

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/tags'.length));
      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return true;
      }
      const body = await parseJsonBody(req);
      const { tag } = body || {};

      if (!tag || typeof tag !== 'string') {
        badRequest(res, 'Campo "tag" é obrigatório');
        return true;
      }

      const result = addTagToTicket(id, tag);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, result.ticket);
    } catch (err) {
      logger.error('Erro ao adicionar tag:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'DELETE' && pathname.includes('/tickets/') && pathname.includes('/tags/')) {
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

    try {
      const parts = pathname.split('/');
      const ticketIndex = parts.indexOf('tickets');
      const tagIndex = parts.indexOf('tags');
      const ticketId = decodeURIComponent(parts[ticketIndex + 1]);
      const tag = decodeURIComponent(parts[tagIndex + 1]);

      const ticket = getTicket(ticketId);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return true;
      }

      const result = removeTagFromTicket(ticketId, tag);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, result.ticket);
    } catch (err) {
      logger.error('Erro ao remover tag:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'PUT' && pathname.startsWith('/tickets/') && pathname.endsWith('/category')) {
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

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/category'.length));
      const ticket = getTicket(id);
      if (!ticket) {
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
        return true;
      }
      const body = await parseJsonBody(req);
      const { category } = body || {};

      const result = setTicketCategory(id, category);
      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, result.ticket);
    } catch (err) {
      logger.error('Erro ao definir categoria:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}