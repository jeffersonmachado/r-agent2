'use strict';

function parseConversationId(req) {
  return decodeURIComponent(String(req.params.conversationId || ''));
}

function parseConversationsQuery(req) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  return {
    status: urlObj.searchParams.get('status'),
    queue: urlObj.searchParams.get('queue'),
    assignedTo: urlObj.searchParams.get('assignedTo'),
    limitRaw: urlObj.searchParams.get('limit'),
    offsetRaw: urlObj.searchParams.get('offset'),
  };
}

function buildAuditMeta(req) {
  return {
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  };
}

function buildInboxEventContext(req) {
  return { tenantId: req.tenantId };
}

function createInboxService(deps) {
  return {
    listConversations(req) {
      const { status, queue, assignedTo, limitRaw, offsetRaw } = parseConversationsQuery(req);
      const base = deps.listAllTickets({
        tenantId: req.tenantId,
        status: status && status !== 'open' ? status : undefined,
        queue,
        limit: 10000,
        offset: 0,
      });

      let list = Array.isArray(base.tickets) ? base.tickets : Array.isArray(base) ? base : [];

      if (!status || status === 'open') {
        list = list.filter((ticket) => ticket.status !== 'closed');
      }
      if (assignedTo) {
        list = list.filter((ticket) => ticket.assignedTo === assignedTo);
      }
      if (req.agent.role === 'agent') {
        list = list.filter((ticket) => deps.canAccessTicket(req.agent, ticket));
      }

      const total = list.length;
      const limit = Math.min(Math.max(1, parseInt(limitRaw, 10) || 200), 10000);
      const offset = Math.max(0, parseInt(offsetRaw, 10) || 0);
      const tickets = list.slice(offset, offset + limit);

      return { tickets, total, limit, offset };
    },

    getConversation(req) {
      const id = parseConversationId(req);
      const ticket = deps.getTicket(id);
      if (!ticket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        return { ok: false, status: 403, payload: { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' } };
      }
      if (!deps.canAccessTicket(req.agent, ticket)) {
        return {
          ok: false,
          status: 403,
          payload: { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' },
        };
      }
      return { ok: true, ticket };
    },

    async assignConversation(req, body) {
      const id = parseConversationId(req);
      const ticket = deps.getTicket(id);
      if (!ticket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        return { ok: false, status: 403, payload: { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' } };
      }

      let assignedTo = req.agent.id;
      if (body && body.assignedTo) {
        assignedTo = req.agent.role === 'admin' || req.agent.role === 'supervisor'
          ? String(body.assignedTo)
          : req.agent.id;
      }

      const updatedTicket = deps.assignTicket(id, assignedTo);
      if (!updatedTicket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }

      deps.triggerWebhooks(req.tenantId, 'ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
      }).catch((err) => {
        deps.logger.error('[Webhook] Erro ao disparar webhook para ticket.assigned (inbox):', err);
      });

      deps.emitEvent('ticket.assigned', {
        ticketId: id,
        assignedTo,
        assignedBy: req.agent.id,
        ticket: updatedTicket,
      }, { tenantId: req.tenantId, agentId: assignedTo });

      deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_assign',
        resource: 'ticket',
        resourceId: id,
        details: { assignedTo, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: 200, payload: updatedTicket };
    },

    async transferConversation(req, body) {
      const id = parseConversationId(req);
      const ticket = deps.getTicket(id);
      if (!ticket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        return { ok: false, status: 403, payload: { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' } };
      }
      if (!deps.canModifyTicket(req.agent, ticket)) {
        return {
          ok: false,
          status: 403,
          payload: { error: 'forbidden', message: 'Você não tem permissão para modificar este ticket' },
        };
      }

      const queue = body && body.queue ? String(body.queue).trim() : null;
      if (!queue) {
        return { ok: false, kind: 'bad_request', message: 'queue é obrigatório' };
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

      const updatedTicket = deps.transferTicket(id, { queue, assignedTo });
      if (!updatedTicket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }

      deps.emitEvent('ticket.updated', {
        ticketId: id,
        ticket: updatedTicket,
        updatedBy: req.agent.id,
      }, buildInboxEventContext(req));

      deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_transfer',
        resource: 'ticket',
        resourceId: id,
        details: { queue, assignedTo, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: 200, payload: updatedTicket };
    },

    async addNote(req, body) {
      const id = parseConversationId(req);
      const ticket = deps.getTicket(id);
      if (!ticket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }
      if (req.tenantId && ticket.tenantId !== req.tenantId) {
        return { ok: false, status: 403, payload: { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' } };
      }
      if (!deps.canModifyTicket(req.agent, ticket)) {
        return {
          ok: false,
          status: 403,
          payload: { error: 'forbidden', message: 'Você não tem permissão para modificar este ticket' },
        };
      }

      const note = body && body.note ? String(body.note).trim() : '';
      if (!note) {
        return { ok: false, kind: 'bad_request', message: 'note é obrigatório' };
      }

      const updatedTicket = deps.addTicketNote(id, note, req.agent);
      if (!updatedTicket) {
        return { ok: false, status: 404, payload: { error: 'ticket_not_found' } };
      }

      deps.emitEvent('ticket.updated', {
        ticketId: id,
        ticket: updatedTicket,
        updatedBy: req.agent.id,
      }, buildInboxEventContext(req));

      deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'ticket_note',
        resource: 'ticket',
        resourceId: id,
        details: { noteLength: note.length, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: 200, payload: updatedTicket };
    },
  };
}

module.exports = {
  createInboxService,
};
