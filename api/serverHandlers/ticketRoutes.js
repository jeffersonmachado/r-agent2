async function handleTicketRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    createTicket,
    getTicket,
    getTicketBySession,
    closeTicket,
    listAllTickets,
    listQueues,
    getMetrics,
    addAgentMessage,
    updateOutboundMessageMeta,
    markMessagesAsRead,
    getTicketMessages,
    canAccessTicket,
    canModifyTicket,
    assignTicket,
    triggerWebhooks,
    emitEvent,
    logAction,
    outboundQueueService,
    listConversationMessages,
    takeOverTicket,
    returnTicketToBot,
    pauseTicket,
    resumeHumanTicket,
    autoAssignTicket,
    closeReasonsService,
    ticketInsightService,
    logger,
  } = deps;

if (method === 'POST' && pathname === '/tickets') {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const permResult = requirePermission(req, 'tickets', 'create');
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return true;
  }

  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const body = await parseJsonBody(req);
    const phoneNumber = body && body.phoneNumber ? String(body.phoneNumber).trim() : null;
    const queue = body && body.queue ? String(body.queue).trim() : null;
    const initialMessage = body && body.initialMessage ? String(body.initialMessage).trim() : null;

    if (!phoneNumber || phoneNumber === '') {
      badRequest(res, 'Campo "phoneNumber" é obrigatório');
      return true;
    }

    if (!queue || queue === '') {
      badRequest(res, 'Campo "queue" é obrigatório');
      return true;
    }

    // Valida formato do número de telefone (aceita apenas números e +)
    const phoneRegex = /^\+?[1-9]\d{10,14}$/;
    const cleanPhone = phoneNumber.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (!phoneRegex.test(cleanPhone)) {
      badRequest(res, 'Número de telefone inválido. Use formato: +5511999999999 ou 5511999999999');
      return true;
    }

    // Cria sessionId no formato padrão: whatsapp_5511999999999
    const sessionId = `whatsapp_${cleanPhone.replace(/^\+/, '')}`;

    // Verifica se já existe ticket ativo para este número
    const existingTicket = getTicketBySession(sessionId);
    if (existingTicket && existingTicket.status !== 'closed') {
      sendJson(res, 409, {
        error: 'ticket_already_exists',
        message: 'Já existe um ticket ativo para este número',
        ticket: existingTicket,
      });
      return true;
    }

    // Quota: max_conversas_mes (best-effort)
    try {
      const { checkLimit } = require('../services/planLimitsService');
      const limitCheck = await checkLimit(req.tenantId, 'max_conversas_mes', 1);
      if (!limitCheck.allowed) {
        sendJson(res, 403, { error: 'limit_exceeded', message: limitCheck.error, limit: limitCheck.limit, current: limitCheck.current });
        return true;
      }
    } catch (e) {
      // não bloqueia se falhar a contagem
    }

    // Cria o ticket
    const ticket = createTicket({
      tenantId: req.tenantId, // Usa tenantId do agente autenticado
      sessionId,
      queue,
      lastUserMessage: null, // Não há mensagem do usuário ainda
      context: {
        flowId: null,
        escalationReason: 'manual_agent_initiated',
        escalationAttempt: 0,
        botHistory: [], // Sem histórico do bot, pois foi iniciado por agente
        variables: {},
        allowReturnToBot: false, // Conversas iniciadas por agente não retornam ao bot
        safeReturnNode: null,
        metadata: {
          initiatedBy: 'agent',
          initiatedByAgentId: req.agent.id,
          initiatedByAgentUsername: req.agent.username,
          channel: 'whatsapp',
        },
      },
    });

    // Auto-assign best-effort (se a fila estiver configurada com estratégia automática)
    autoAssignTicket(ticket.id).catch(() => null);

    // Se há mensagem inicial, envia e adiciona ao histórico
    if (initialMessage && initialMessage !== '') {
      try {
        const clientMessageId = `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // Adiciona mensagem do agente ao histórico
        addAgentMessage(ticket.id, initialMessage, req.agent.id, { clientMessageId, deliveryStatus: 'pending' });

        // Envia mensagem via Outbound Queue (retry/backoff)
        await outboundQueueService.enqueueOutbound({
          tenantId: req.tenantId,
          channelType: 'whatsapp',
          conversationId: ticket.conversationId || null,
          message: { to: cleanPhone, type: 'text', body: { text: initialMessage }, meta: { ticketId: ticket.id, clientMessageId } },
        });
        logger.info('[Ticket] Ticket criado e mensagem inicial enfileirada', {
          ticketId: ticket.id,
          phoneNumber: cleanPhone,
          agentId: req.agent.id,
        });
      } catch (whatsappError) {
        // Se falhar ao enviar, ainda retorna o ticket criado
        logger.warn('[Ticket] Ticket criado mas falha ao enfileirar mensagem inicial', {
          ticketId: ticket.id,
          phoneNumber: cleanPhone,
          error: whatsappError.message,
        });
      }
    }

    // Dispara webhooks e WebSocket
    const tenantId = req.tenantId;
    triggerWebhooks(tenantId, 'ticket.created', {
      ticketId: ticket.id,
      queue: ticket.queue,
      phoneNumber: cleanPhone,
      agentId: req.agent.id,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para ticket.created:', err);
    });

    // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
    emitEvent('ticket.created', {
      ticketId: ticket.id,
      queue: ticket.queue,
      phoneNumber: cleanPhone,
      agentId: req.agent.id,
      ticket: ticket, // Ticket completo para atualização local sem requisição HTTP
    }, { tenantId });

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'ticket_create_manual',
      resource: 'ticket',
      resourceId: ticket.id,
      details: {
        phoneNumber: cleanPhone,
        queue,
        hasInitialMessage: !!initialMessage,
      },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 201, ticket);
    return true;
  } catch (err) {
    logger.error('[Ticket] Erro ao criar ticket manualmente', {
      error: err.message,
      stack: err.stack,
    });
    sendJson(res, 500, {
      error: 'internal_error',
      message: 'Erro ao criar ticket',
    });
    return true;
  }
}
// GET /tickets - Lista todos os tickets (com filtros opcionais e paginação)
if (method === 'GET' && pathname === '/tickets') {
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
  const limit = urlObj.searchParams.get('limit');
  const offset = urlObj.searchParams.get('offset');

  // Log para identificar origem das requisições
  logger.debug('[Server] GET /tickets chamado', {
    agentId: req.agent?.id,
    username: req.agent?.username,
    status,
    queue,
    limit,
    offset,
    userAgent: req.headers['user-agent']?.substring(0, 50),
    referer: req.headers['referer']?.substring(0, 50),
  });

  const result = listAllTickets({ 
    tenantId: req.tenantId, // Filtro por tenant
    status, 
    queue,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  });
  
  // Filtra tickets por permissão (agent só vê próprios ou não atribuídos)
  if (req.agent.role === 'agent') {
    result.tickets = result.tickets.filter((ticket) => 
      canAccessTicket(req.agent, ticket)
    );
    result.total = result.tickets.length;
  }
  
  // Log para debug
  logger.info('Tickets retornados', {
    total: result.total,
    ticketsCount: result.tickets?.length || 0,
    limit: result.limit,
    offset: result.offset,
    agentRole: req.agent.role,
  });
  
  sendJson(res, 200, result);
  return true;
}

// GET /tickets/session/:sessionId - Obtém ticket ativo de uma sessão (verificar antes de /tickets/:id)
if (method === 'GET' && pathname.startsWith('/tickets/session/')) {
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

  const sessionId = decodeURIComponent(pathname.slice('/tickets/session/'.length));
  const ticket = getTicketBySession(sessionId);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Verifica se pode acessar o ticket
  if (!canAccessTicket(req.agent, ticket)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
    return true;
  }

  sendJson(res, 200, ticket);
  return true;
}

// GET /tickets/:id/messages - Obtém histórico de mensagens de um ticket (verificar antes de /tickets/:id)
if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/messages')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/messages'.length));
  const ticket = getTicket(id);
  
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  // Verifica se pode acessar o ticket
  if (!canAccessTicket(req.agent, ticket)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
    return true;
  }

  const messages = getTicketMessages(id);

  // Omnichannel timeline (fase 1):
  // - Mantém compatibilidade retornando "messages" (ledger do ticket)
  // - Adiciona "timeline" com mensagens do canal (channel_messages) quando houver conversationId
  let timeline = null;
  let events = null;
  try {
    const conversationId = ticket.conversationId || null;
    if (conversationId && req.tenantId) {
      const channelRes = await listConversationMessages({
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
  } catch (_) {
    timeline = null; // best-effort
  }

  // Ticket Events (best-effort): timeline operacional consultável
  try {
    if (req.tenantId) {
      const { TicketEvent } = require('../db/models');
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
  } catch (_) {
    events = null;
  }

  sendJson(res, 200, { ticketId: id, messages, timeline, events });
  return true;
}

// GET /tickets/:id/delivery-failures - Lista falhas de entrega (outbound + channel_messages)
if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/delivery-failures')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/delivery-failures'.length));
  const ticket = getTicket(id);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  // Verifica se pode acessar o ticket
  if (!canAccessTicket(req.agent, ticket)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
    return true;
  }

  try {
    const tenantId = req.tenantId;
    const conversationId = ticket.conversationId || null;

    // Best-effort: sem DB ou sem conversationId, retorna vazio
    if (!tenantId || !conversationId) {
      sendJson(res, 200, {
        ticketId: id,
        conversationId,
        outboundQueue: [],
        channelMessages: [],
      });
      return true;
    }

    const { OutboundQueueItem, ChannelMessage } = require('../db/models');
    const OutModel = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
    const MsgModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
    const sequelize = OutModel?.sequelize || MsgModel?.sequelize || null;

    if (!sequelize) {
      sendJson(res, 200, {
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

    sendJson(res, 200, {
      ticketId: id,
      conversationId,
      outboundQueue: Array.isArray(outboundQueue) ? outboundQueue : [],
      channelMessages: Array.isArray(channelMessages) ? channelMessages : [],
    });
  } catch (err) {
    logger.error('Erro ao obter delivery-failures:', err);
    sendJson(res, 500, { error: 'internal_error', message: err.message });
  }
  return true;
}

// POST /tickets/:id/assign - Atribui um ticket para um atendente
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/assign')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/assign'.length));
  const ticket = getTicket(id);
  
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
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
    // Se não especificar assignedTo, atribui para o agente autenticado
    // Se especificar, verifica permissão (apenas admin/supervisor podem atribuir para outros)
    let assignedTo = req.agent.id;
    
    if (body && body.assignedTo) {
      // Admin e supervisor podem atribuir para qualquer agente
      if (req.agent.role === 'admin' || req.agent.role === 'supervisor') {
        assignedTo = String(body.assignedTo);
      } else {
        // Agent comum só pode atribuir para si mesmo
        assignedTo = req.agent.id;
      }
    }

    const updatedTicket = assignTicket(id, assignedTo);
    if (!updatedTicket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    // Dispara webhooks e WebSocket
    const tenantId = req.tenantId;
    triggerWebhooks(tenantId, 'ticket.assigned', {
      ticketId: id,
      assignedTo,
      assignedBy: req.agent.id,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para ticket.assigned:', err);
    });

    // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
    emitEvent('ticket.assigned', {
      ticketId: id,
      assignedTo,
      assignedBy: req.agent.id,
      ticket: updatedTicket, // Ticket completo para atualização local sem requisição HTTP
    }, { tenantId, agentId: assignedTo });

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'ticket_assign',
      resource: 'ticket',
      resourceId: id,
      details: { assignedTo },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, updatedTicket);
  } catch (err) {
    if (err instanceof SyntaxError) {
      badRequest(res, 'JSON inválido no corpo da requisição');
    } else {
      logger.error('Erro ao atribuir ticket:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
  }
  return true;
}

// POST /tickets/:id/takeover - Assumir atendimento humano (handover bot -> humano)
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/takeover')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/takeover'.length));
  const ticket = getTicket(id);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  let reason = 'agent_takeover';
  if (hasJsonContentType(req)) {
    try {
      const body = await parseJsonBody(req);
      if (body?.reason) reason = String(body.reason);
    } catch (e) {
      // ignora body inválido e usa default
    }
  }

  const result = await takeOverTicket(id, req.agent, reason);
  if (!result.success) {
    sendJson(res, 400, { error: result.error || 'handover_failed' });
    return true;
  }

  // Auditoria
  logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    tenantId: req.tenantId,
    action: 'ticket_takeover',
    resource: 'ticket',
    resourceId: id,
    details: { reason },
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });

  sendJson(res, 200, result.ticket);
  return true;
}

// POST /tickets/:id/return-to-bot - Devolver atendimento ao bot (handover humano -> bot)
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/return-to-bot')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/return-to-bot'.length));
  const ticket = getTicket(id);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  let reason = 'user_request';
  if (hasJsonContentType(req)) {
    try {
      const body = await parseJsonBody(req);
      if (body?.reason) reason = String(body.reason);
    } catch (e) {
      // ignora
    }
  }

  const result = await returnTicketToBot(id, req.agent, reason);
  if (!result.success) {
    sendJson(res, 400, { error: result.error || 'handover_failed' });
    return true;
  }

  // Auditoria
  logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    tenantId: req.tenantId,
    action: 'ticket_return_to_bot',
    resource: 'ticket',
    resourceId: id,
    details: { reason },
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });

  sendJson(res, 200, result.ticket);
  return true;
}

// POST /tickets/:id/pause - Pausar atendimento (ex.: fora janela 24h / compliance)
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/pause')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/pause'.length));
  const ticket = getTicket(id);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  let reason = 'outside_window';
  if (hasJsonContentType(req)) {
    try {
      const body = await parseJsonBody(req);
      if (body?.reason) reason = String(body.reason);
    } catch (e) {
      // ignora
    }
  }

  const result = await pauseTicket(id, req.agent, reason);
  if (!result.success) {
    sendJson(res, 400, { error: result.error || 'handover_failed' });
    return true;
  }

  logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    tenantId: req.tenantId,
    action: 'ticket_pause',
    resource: 'ticket',
    resourceId: id,
    details: { reason },
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });

  sendJson(res, 200, result.ticket);
  return true;
}

// POST /tickets/:id/resume - Retomar atendimento humano (remove paused)
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/resume')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/resume'.length));
  const ticket = getTicket(id);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  let reason = 'resume';
  if (hasJsonContentType(req)) {
    try {
      const body = await parseJsonBody(req);
      if (body?.reason) reason = String(body.reason);
    } catch (e) {
      // ignora
    }
  }

  const result = await resumeHumanTicket(id, req.agent, reason);
  if (!result.success) {
    sendJson(res, 400, { error: result.error || 'handover_failed' });
    return true;
  }

  logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    tenantId: req.tenantId,
    action: 'ticket_resume',
    resource: 'ticket',
    resourceId: id,
    details: { reason },
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });

  sendJson(res, 200, result.ticket);
  return true;
}

// POST /tickets/:id/close - Fecha um ticket
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/close')) {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const permResult = requirePermission(req, 'tickets', 'close');
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return true;
  }

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/close'.length));
  const ticket = getTicket(id);
  
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  // Verifica se pode modificar o ticket
  if (!canModifyTicket(req.agent, ticket)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para fechar este ticket' });
    return true;
  }

  // Motivo de encerramento:
  // - UI exige, mas mantemos compatibilidade para chamadas antigas sem body.
  // - Se não vier motivo, usamos/garantimos um motivo padrão do tenant ("Sem motivo informado").
  let closeReason = null;
  let closeReasonId = null;
  let closeReasonName = null;
  let closeTags = null;
  if (hasJsonContentType(req)) {
    try {
      const body = await parseJsonBody(req);
      closeReasonId = body?.closeReasonId ? String(body.closeReasonId) : null;
      closeReasonName = body?.closeReasonName ? String(body.closeReasonName) : null;
      // tags podem vir como array ["vip","cobranca"] ou string "vip,cobranca"
      if (Array.isArray(body?.tags)) {
        closeTags = body.tags.map(t => String(t).trim()).filter(Boolean);
      } else if (typeof body?.tags === 'string') {
        closeTags = body.tags.split(',').map(t => String(t).trim()).filter(Boolean);
      }
    } catch (e) {
      // ignora body inválido
    }
  }

  // Garante que o tenant tenha motivos padrão (best-effort)
  try {
    await closeReasonsService.ensureDefaultsForTenant(req.tenantId);
  } catch (_) {}

  if (closeReasonId) {
    closeReason = closeReasonsService.getCloseReason(closeReasonId);
  }
  if (!closeReason && closeReasonName) {
    // Garante persistência para o tenant quando o usuário digita um motivo livre
    try {
      const created = await closeReasonsService.getOrCreateCloseReasonByName({
        tenantId: req.tenantId,
        name: closeReasonName,
        createdBy: req.agent.id,
      });
      if (created?.success) closeReason = created.reason;
    } catch (_) {
      closeReason = { id: null, name: closeReasonName };
    }
  }
  if (!closeReason) {
    // Compatibilidade: sempre encerra com um motivo consistente
    try {
      const created = await closeReasonsService.getOrCreateCloseReasonByName({
        tenantId: req.tenantId,
        name: 'Sem motivo informado',
        createdBy: 'system',
      });
      if (created?.success) closeReason = created.reason;
    } catch (_) {
      closeReason = { id: null, name: 'Sem motivo informado' };
    }
  }

  // Atualiza ticket para que closeTicket escreva system message com motivo
  try {
    const { updateTicket } = require('../services/queueService');
    updateTicket(id, {
      context: {
        ...(ticket.context || {}),
        closeReason: closeReason ? { id: closeReason.id || null, name: closeReason.name } : null,
        closeReasonName: closeReason?.name || null,
        closedBy: { id: req.agent.id, username: req.agent.username },
        closedAt: new Date().toISOString(),
      },
    });
  } catch (_) {}

  // Tags no fechamento (opcional): aplica antes de fechar (best-effort)
  if (closeTags && Array.isArray(closeTags) && closeTags.length > 0) {
    try {
      const { addTagToTicket } = require('../services/segmentationService');
      const unique = Array.from(new Set(closeTags.map(t => String(t).trim().toLowerCase()).filter(Boolean))).slice(0, 20);
      for (const t of unique) {
        // eslint-disable-next-line no-await-in-loop
        addTagToTicket(id, t);
      }
    } catch (_) {}
  }

  const closedTicket = closeTicket(id);
  if (!closedTicket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Dispara webhooks e WebSocket
  const tenantId = req.tenantId;
  triggerWebhooks(tenantId, 'ticket.closed', {
    ticketId: id,
    closedBy: req.agent.id,
  }).catch((err) => {
    logger.error('[Webhook] Erro ao disparar webhook para ticket.closed:', err);
  });

  // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
  emitEvent('ticket.closed', {
    ticketId: id,
    closedBy: req.agent.id,
    ticket: closedTicket, // Ticket completo para atualização local sem requisição HTTP
  }, { tenantId, agentId: closedTicket.assignedTo });

  // Registra ação de auditoria
  logAction({
    agentId: req.agent.id,
    username: req.agent.username,
    action: 'ticket_close',
    resource: 'ticket',
    resourceId: id,
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  });

  sendJson(res, 200, closedTicket);
  return true;
}

// -----------------------------------------------------------------------
// Close Reasons
// -----------------------------------------------------------------------

// GET /close-reasons - Lista motivos de encerramento do tenant
if (method === 'GET' && pathname === '/close-reasons') {
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
    const activeOnly = urlObj.searchParams.get('activeOnly');
    const list = closeReasonsService.listCloseReasons({
      tenantId: req.tenantId,
      activeOnly: activeOnly === null ? true : activeOnly !== 'false',
    });
    sendJson(res, 200, { closeReasons: list });
  } catch (err) {
    logger.error('Erro ao listar close reasons:', err);
    sendJson(res, 500, { error: 'internal_error' });
  }
  return true;
}

// -----------------------------------------------------------------------
// Ticket Insights (Resumo IA)
// -----------------------------------------------------------------------

// GET /tickets/:id/ai-summary - Retorna resumo IA (cache)
if (method === 'GET' && pathname.startsWith('/tickets/') && pathname.endsWith('/ai-summary')) {
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
    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/ai-summary'.length));
    const { getTicket } = require('../services/queueService');
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    const result = ticketInsightService.getAiSummary(id);
    if (!result.success) {
      sendJson(res, 404, { error: result.error });
      return true;
    }
    sendJson(res, 200, { summary: result.summary });
  } catch (err) {
    logger.error('Erro ao obter ai-summary:', err);
    sendJson(res, 500, { error: 'internal_error' });
  }
  return true;
}

// POST /tickets/:id/ai-summary - Gera/atualiza resumo IA
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/ai-summary')) {
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
    const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/ai-summary'.length));
    const { getTicket } = require('../services/queueService');
    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    const result = await ticketInsightService.generateAiSummary({
      ticketId: id,
      tenantId: req.tenantId,
      agent: req.agent,
    });

    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    sendJson(res, 200, { summary: result.summary });
  } catch (err) {
    logger.error('Erro ao gerar ai-summary:', err);
    sendJson(res, 500, { error: 'internal_error' });
  }
  return true;
}

// POST /queues/reload - Recarrega tickets e filas do arquivo JSON
if (method === 'POST' && pathname === '/queues/reload') {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const permResult = requirePermission(req, 'queues', 'admin');
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return true;
  }

  try {
    logger.info('Recarregando dados de filas e tickets do arquivo...');
    
    // Obtém estado atual antes de recarregar
    const allTicketsBefore = listAllTickets();
    const queuesBefore = listQueues();
    const ticketsBefore = allTicketsBefore.tickets.length;
    const queuesCountBefore = queuesBefore.length;
    
    // Recarrega dados do arquivo
    // Dados agora estão no banco de dados PostgreSQL
    
    // Obtém estado após recarregar
    const allTicketsAfter = listAllTickets();
    const queuesAfter = listQueues();
    const ticketsAfter = allTicketsAfter.tickets.length;
    const queuesCountAfter = queuesAfter.length;
    
    logger.info('Dados recarregados com sucesso', {
      ticketsAntes: ticketsBefore,
      ticketsDepois: ticketsAfter,
      filasAntes: queuesCountBefore,
      filasDepois: queuesCountAfter,
    });

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'queue_reload',
      resource: 'queue',
      details: {
        before: { tickets: ticketsBefore, queues: queuesCountBefore },
        after: { tickets: ticketsAfter, queues: queuesCountAfter },
      },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });
    
    sendJson(res, 200, {
      success: true,
      message: 'Dados recarregados com sucesso',
      before: {
        tickets: ticketsBefore,
        queues: queuesCountBefore,
      },
      after: {
        tickets: ticketsAfter,
        queues: queuesCountAfter,
      },
    });
    return true;
  } catch (error) {
    logger.error('Erro ao recarregar dados', error);
    sendJson(res, 500, {
      success: false,
      error: 'Erro ao recarregar dados',
      message: error.message,
    });
    return true;
  }
}

// GET /metrics/queues - Obtém métricas do sistema de filas
if (method === 'GET' && pathname === '/metrics/queues') {
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const permResult = requirePermission(req, 'queues', 'read');
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return true;
  }

  // eslint-disable-next-line no-console
  console.log('========================================');
  // eslint-disable-next-line no-console
  console.log('[Server] ⚡ Endpoint /metrics/queues CHAMADO!');
  // eslint-disable-next-line no-console
  console.log('========================================');
  logger.info('Endpoint /metrics/queues chamado');
  try {
    // eslint-disable-next-line no-console
    console.log('[Server] Chamando getMetrics()...');
    logger.info('Chamando getMetrics()...');
    const metrics = getMetrics();
    // Log para debug
    // eslint-disable-next-line no-console
    console.log('[Server] ✅ Métricas retornadas:', JSON.stringify({
      totalTickets: metrics.totalTickets,
      ticketsByStatus: metrics.ticketsByStatus,
      ticketsByQueue: metrics.ticketsByQueue,
    }, null, 2));
    logger.info('Métricas retornadas', {
      totalTickets: metrics.totalTickets,
      ticketsByStatus: metrics.ticketsByStatus,
      ticketsByQueue: Object.keys(metrics.ticketsByQueue).length,
      queueDetails: metrics.ticketsByQueue,
    });
    
    // Adiciona timestamp para evitar cache
    const responseData = {
      ...metrics,
      _timestamp: Date.now(),
    };
    
    // eslint-disable-next-line no-console
    console.log('[Server] 📤 Enviando resposta:', JSON.stringify(responseData, null, 2));
    
    sendJson(res, 200, responseData);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Server] ❌ Erro ao obter métricas:', error);
    logger.error('Erro ao obter métricas', error);
    sendJson(res, 500, { error: 'Erro ao obter métricas', message: error.message });
  }
  return true;
}

// GET /tickets/:id - Obtém um ticket específico (verificar por último, após todas as rotas específicas)
if (method === 'GET' && pathname.startsWith('/tickets/') && 
    !pathname.endsWith('/messages') && 
    !pathname.endsWith('/assign') && 
    !pathname.endsWith('/close') && 
    !pathname.endsWith('/mark-read') && 
    !pathname.endsWith('/message') &&
    !pathname.startsWith('/tickets/session/')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length));
  const ticket = getTicket(id);
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  // Verifica se pode acessar o ticket
  if (!canAccessTicket(req.agent, ticket)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
    return true;
  }

  sendJson(res, 200, ticket);
  return true;
}

// POST /tickets/:id/mark-read - Marca mensagens como lidas
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/mark-read')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/mark-read'.length));
  const ticket = getTicket(id);
  
  if (!ticket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  // Valida tenant
  if (req.tenantId && ticket.tenantId !== req.tenantId) {
    sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
    return true;
  }

  // Verifica se pode acessar o ticket
  if (!canAccessTicket(req.agent, ticket)) {
    sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para acessar este ticket' });
    return true;
  }

  const updatedTicket = markMessagesAsRead(id);
  
  if (!updatedTicket) {
    sendJson(res, 404, { error: 'ticket_not_found' });
    return true;
  }

  sendJson(res, 200, { success: true, ticketId: id });
  return true;
}

// POST /tickets/:id/message - Envia mensagem do atendente para o usuário
if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/message')) {
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

  const id = decodeURIComponent(pathname.slice('/tickets/'.length, -'/message'.length));

  if (!hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const body = await parseJsonBody(req);
    const message = body && body.message ? String(body.message) : null;

    if (!message || message.trim() === '') {
      badRequest(res, 'Campo "message" é obrigatório e não pode estar vazio');
      return true;
    }

    const ticket = getTicket(id);
    if (!ticket) {
      sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    // Valida tenant
    if (req.tenantId && ticket.tenantId !== req.tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Ticket não pertence ao seu tenant' });
      return true;
    }

    // Verifica se pode modificar o ticket
    if (!canModifyTicket(req.agent, ticket)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você não tem permissão para enviar mensagens neste ticket' });
      return true;
    }

    if (ticket.status === 'closed') {
      badRequest(res, 'Não é possível enviar mensagem para um ticket fechado');
      return true;
    }

    // Usa agentId do agente autenticado
    const agentId = req.agent.id;
    try {
      const clientMessageId = `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const updatedTicket = addAgentMessage(id, message, agentId, { clientMessageId, deliveryStatus: 'pending' });
      if (!updatedTicket) {
        logger.warn('[Ticket] Não foi possível adicionar mensagem ao histórico (ticket não encontrado)', { ticketId: id });
        sendJson(res, 404, { error: 'ticket_not_found' });
        return true;
      }
    } catch (addMessageError) {
      logger.error('[Ticket] Erro ao adicionar mensagem ao histórico', {
        ticketId: id,
        error: addMessageError.message,
        stack: addMessageError.stack,
      });
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro ao salvar mensagem no histórico do ticket',
      });
      return true;
    }

    // Tenta enviar mensagem via WhatsApp
    const phoneNumber = ticket.phoneNumber;
    if (!phoneNumber) {
      logger.warn('[Ticket] Número de telefone não encontrado no ticket, mensagem salva apenas no histórico', { ticketId: id });
    } else {
      try {
        // Recupera clientMessageId da última mensagem do agente para correlacionar com o worker
        const lastAgent = Array.isArray(ticket.messages)
          ? [...ticket.messages].reverse().find((m) => m && m.sender === 'agent' && m.deliveryStatus === 'pending')
          : null;
        const clientMessageId = lastAgent?.clientMessageId || `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        // Se não tinha no histórico, registra agora (best-effort)
        if (!lastAgent?.clientMessageId) {
          updateOutboundMessageMeta(id, { clientMessageId, deliveryStatus: 'pending' });
        }

        await outboundQueueService.enqueueOutbound({
          tenantId: req.tenantId,
          channelType: 'whatsapp',
          conversationId: ticket.conversationId || null,
          message: { to: phoneNumber, type: 'text', body: { text: message }, meta: { ticketId: id, clientMessageId } },
        });
        logger.info('[Ticket] Mensagem enfileirada (Outbound Queue)', { ticketId: id, phoneNumber });
      } catch (whatsappError) {
        // Se o erro for de credenciais inválidas, apenas loga um aviso e continua
        // Isso permite que o sistema funcione em modo de desenvolvimento/teste
        if (whatsappError.message && whatsappError.message.includes('credentials')) {
          logger.warn('[Ticket] Mensagem salva no histórico, mas não foi enviada via WhatsApp (credenciais inválidas)', {
            ticketId: id,
            phoneNumber,
            error: whatsappError.message,
          });
        } else {
          // Para outros erros do WhatsApp, também loga mas continua
          logger.warn('[Ticket] Mensagem salva no histórico, mas falha ao enviar via WhatsApp', {
            ticketId: id,
            phoneNumber,
            error: whatsappError.message,
          });
        }
      }
    }

    // Dispara webhooks e WebSocket
    const tenantId = req.tenantId;
    triggerWebhooks(tenantId, 'ticket.message.sent', {
      ticketId: id,
      agentId: req.agent.id,
      message,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para ticket.message.sent:', err);
    });

    // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
    emitEvent('ticket.message.sent', {
      ticketId: id,
      agentId: req.agent.id,
      message,
      ticket: ticket, // Ticket completo para atualização local sem requisição HTTP
    }, { tenantId, agentId: ticket.assignedTo });

    // Registra ação de auditoria
    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'ticket_message',
      resource: 'ticket',
      resourceId: id,
      details: { messageLength: message.length },
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, {
      success: true,
      ticketId: id,
      message,
    });
  } catch (err) {
    if (err instanceof SyntaxError) {
      badRequest(res, 'JSON inválido no corpo da requisição');
    } else {
      logger.error('Erro ao enviar mensagem:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao enviar mensagem via WhatsApp',
      });
    }
  }
  return true;
}


  return false;
}

module.exports = {
  handleTicketRoutes,
};
