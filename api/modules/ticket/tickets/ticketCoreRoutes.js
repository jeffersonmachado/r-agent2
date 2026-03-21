const {
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureTicketPermission,
  getTicketAndValidateAccess,
  logTicketAction,
  parseTicketRouteId,
} = require('./ticketRouteUtils');

async function handleTicketCoreRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota core de tickets');

  if (method === 'POST' && pathname === '/tickets') {
    if (!ensureTicketPermission({ req, res, deps, permission: 'create' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    try {
      const body = await deps.parseJsonBody(req);
      const phoneNumber = body && body.phoneNumber ? String(body.phoneNumber).trim() : null;
      const queue = body && body.queue ? String(body.queue).trim() : null;
      const initialMessage = body && body.initialMessage ? String(body.initialMessage).trim() : null;

      if (!phoneNumber || phoneNumber === '') {
        deps.badRequest(res, 'Campo "phoneNumber" é obrigatório');
        return true;
      }

      if (!queue || queue === '') {
        deps.badRequest(res, 'Campo "queue" é obrigatório');
        return true;
      }

      const phoneRegex = /^\+?[1-9]\d{10,14}$/;
      const cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      if (!phoneRegex.test(cleanPhone)) {
        deps.badRequest(res, 'Número de telefone inválido. Use formato: +5511999999999 ou 5511999999999');
        return true;
      }

      const sessionId = `whatsapp_${cleanPhone.replace(/^\+/, '')}`;
      const existingTicket = deps.getTicketBySession(sessionId);
      if (existingTicket && existingTicket.status !== 'closed') {
        deps.sendJson(res, 409, {
          error: 'ticket_already_exists',
          message: 'Já existe um ticket ativo para este número',
          ticket: existingTicket,
        });
        return true;
      }

      try {
        const { checkLimit } = require('../../../services/planLimitsService');
        const limitCheck = await checkLimit(req.tenantId, 'max_conversas_mes', 1);
        if (!limitCheck.allowed) {
          deps.sendJson(res, 403, {
            error: 'limit_exceeded',
            message: limitCheck.error,
            limit: limitCheck.limit,
            current: limitCheck.current,
          });
          return true;
        }
      } catch {}

      const ticket = deps.createTicket({
        tenantId: req.tenantId,
        sessionId,
        queue,
        lastUserMessage: null,
        context: {
          flowId: null,
          escalationReason: 'manual_agent_initiated',
          escalationAttempt: 0,
          botHistory: [],
          variables: {},
          allowReturnToBot: false,
          safeReturnNode: null,
          metadata: {
            initiatedBy: 'agent',
            initiatedByAgentId: req.agent.id,
            initiatedByAgentUsername: req.agent.username,
            channel: 'whatsapp',
          },
        },
      });

      deps.autoAssignTicket(ticket.id).catch(() => null);

      if (initialMessage && initialMessage !== '') {
        try {
          const clientMessageId = `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          deps.addAgentMessage(ticket.id, initialMessage, req.agent.id, { clientMessageId, deliveryStatus: 'pending' });
          await deps.outboundQueueService.enqueueOutbound({
            tenantId: req.tenantId,
            channelType: 'whatsapp',
            conversationId: ticket.conversationId || null,
            message: { to: cleanPhone, type: 'text', body: { text: initialMessage }, meta: { ticketId: ticket.id, clientMessageId } },
          });
          deps.logger.info('[Ticket] Ticket criado e mensagem inicial enfileirada', {
            ticketId: ticket.id,
            phoneNumber: cleanPhone,
            agentId: req.agent.id,
          });
        } catch (whatsappError) {
          deps.logger.warn('[Ticket] Ticket criado mas falha ao enfileirar mensagem inicial', {
            ticketId: ticket.id,
            phoneNumber: cleanPhone,
            error: whatsappError.message,
          });
        }
      }

      deps.triggerWebhooks(req.tenantId, 'ticket.created', {
        ticketId: ticket.id,
        queue: ticket.queue,
        phoneNumber: cleanPhone,
        agentId: req.agent.id,
      }).catch((err) => {
        deps.logger.error('[Webhook] Erro ao disparar webhook para ticket.created:', err);
      });

      deps.emitEvent('ticket.created', {
        ticketId: ticket.id,
        queue: ticket.queue,
        phoneNumber: cleanPhone,
        agentId: req.agent.id,
        ticket,
      }, { tenantId: req.tenantId });

      logTicketAction({
        req,
        deps,
        action: 'ticket_create_manual',
        resourceId: ticket.id,
        details: {
          phoneNumber: cleanPhone,
          queue,
          hasInitialMessage: !!initialMessage,
        },
      });

      deps.sendJson(res, 201, ticket);
    } catch (err) {
      deps.logger.error('[Ticket] Erro ao criar ticket manualmente', {
        error: err.message,
        stack: err.stack,
      });
      deps.sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro ao criar ticket',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/tickets') {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const status = urlObj.searchParams.get('status');
    const queue = urlObj.searchParams.get('queue');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    deps.logger.debug('[Server] GET /tickets chamado', {
      agentId: req.agent?.id,
      username: req.agent?.username,
      status,
      queue,
      limit,
      offset,
      userAgent: req.headers['user-agent']?.substring(0, 50),
      referer: req.headers['referer']?.substring(0, 50),
    });

    const result = deps.listAllTickets({
      tenantId: req.tenantId,
      status,
      queue,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    if (req.agent.role === 'agent') {
      result.tickets = result.tickets.filter((ticket) => deps.canAccessTicket(req.agent, ticket));
      result.total = result.tickets.length;
    }

    deps.logger.info('Tickets retornados', {
      total: result.total,
      ticketsCount: result.tickets?.length || 0,
      limit: result.limit,
      offset: result.offset,
      agentRole: req.agent.role,
    });

    deps.sendJson(res, 200, result);
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/tickets/session/')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    const sessionId = decodeURIComponent(pathname.slice('/tickets/session/'.length));
    const ticket = deps.getTicketBySession(sessionId);
    if (!ticket) {
      deps.sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (!deps.canAccessTicket(req.agent, ticket)) {
      deps.sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
      return true;
    }

    deps.sendJson(res, 200, ticket);
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/messages')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    const id = parseTicketRouteId(pathname, '/messages');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id });
    if (!ticket) return true;

    const messages = deps.getTicketMessages(id);
    let timeline = null;
    let events = null;

    try {
      const conversationId = ticket.conversationId || null;
      if (conversationId && req.tenantId) {
        const channelRes = await deps.listConversationMessages({
          tenantId: req.tenantId,
          conversationId,
          limit: '1000',
          offset: '0',
        });
        const channelItems = (channelRes?.items || []).map((m) => ({
          source: 'channel',
          channelType: ticket.channelType || null,
          direction: m.direction,
          type: m.type,
          text: typeof m.body?.text === 'string' ? m.body.text : null,
          body: m.body || {},
          externalMessageId: m.externalMessageId || null,
          status: m.status || null,
          timestamp: m.createdAt || null,
        }));
        const ticketItems = (messages || []).map((m) => ({
          source: 'ticket',
          channelType: ticket.channelType || null,
          direction: m.sender === 'agent' || m.sender === 'bot' ? 'out' : 'in',
          type: 'text',
          text: m.text || '',
          body: { text: m.text || '' },
          externalMessageId: m.externalMessageId || m.id || null,
          status: m.status || (m.sender === 'agent' || m.sender === 'bot' ? 'sent' : 'received'),
          timestamp: m.timestamp || null,
        }));

        timeline = [...ticketItems, ...channelItems].sort((a, b) => {
          const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return ta - tb;
        });
      }
    } catch {
      timeline = null;
    }

    try {
      if (req.tenantId) {
        const { TicketEvent } = require('../../../db/models');
        const Model = typeof TicketEvent === 'function' ? TicketEvent() : TicketEvent;
        const rows = await Model.findAll({
          where: { tenant_key: req.tenantId, ticket_id: id },
          order: [['created_at', 'DESC']],
          limit: 100,
        });
        events = rows.map((r) => ({
          id: r.id,
          type: r.type,
          payload: r.payload || {},
          createdBy: r.created_by || null,
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
        }));
      }
    } catch {
      events = null;
    }

    deps.sendJson(res, 200, { ticketId: id, messages, timeline, events });
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/delivery-failures')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    const id = parseTicketRouteId(pathname, '/delivery-failures');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id });
    if (!ticket) return true;

    try {
      const tenantId = req.tenantId;
      const conversationId = ticket.conversationId || null;

      if (!tenantId || !conversationId) {
        deps.sendJson(res, 200, {
          ticketId: id,
          conversationId,
          outboundQueue: [],
          channelMessages: [],
        });
        return true;
      }

      const { OutboundQueueItem, ChannelMessage } = require('../../../db/models');
      const OutModel = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
      const MsgModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
      const sequelize = OutModel?.sequelize || MsgModel?.sequelize || null;

      if (!sequelize) {
        deps.sendJson(res, 200, {
          ticketId: id,
          conversationId,
          outboundQueue: [],
          channelMessages: [],
        });
        return true;
      }

      const [outboundQueue] = await sequelize.query(
        `SELECT id, channel_type, status, attempts, next_attempt_at, last_error, reason_code, external_message_id, message, created_at, updated_at
         FROM outbound_queue
         WHERE tenant_key = :t
           AND (status = 'failed' OR last_error IS NOT NULL)
           AND (message->'meta'->>'ticketId') = :ticketId
         ORDER BY updated_at DESC
         LIMIT 50`,
        { replacements: { t: tenantId, ticketId: id } }
      );

      const [channelMessages] = await sequelize.query(
        `SELECT id, conversation_id, channel_type, direction, type, body, external_message_id, status, created_at
         FROM channel_messages
         WHERE tenant_key = :t
           AND conversation_id = :c
           AND direction = 'out'
           AND status = 'failed'
         ORDER BY created_at DESC
         LIMIT 50`,
        { replacements: { t: tenantId, c: conversationId } }
      );

      deps.sendJson(res, 200, {
        ticketId: id,
        conversationId,
        outboundQueue: Array.isArray(outboundQueue) ? outboundQueue : [],
        channelMessages: Array.isArray(channelMessages) ? channelMessages : [],
      });
    } catch (err) {
      deps.logger.error('Erro ao obter delivery-failures:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/tickets/')
    && !pathname.endsWith('/messages')
    && !pathname.endsWith('/assign')
    && !pathname.endsWith('/close')
    && !pathname.endsWith('/mark-read')
    && !pathname.endsWith('/message')
    && !pathname.endsWith('/ai-summary')
    && !pathname.endsWith('/takeover')
    && !pathname.endsWith('/return-to-bot')
    && !pathname.endsWith('/pause')
    && !pathname.endsWith('/resume')
    && !pathname.endsWith('/delivery-failures')
    && !pathname.startsWith('/tickets/session/')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    const id = parseTicketRouteId(pathname);
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id });
    if (!ticket) return true;

    deps.sendJson(res, 200, ticket);
    return true;
  }

  return false;
}

module.exports = {
  handleTicketCoreRoutes,
};
