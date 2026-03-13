/**
 * Handler para operações COM conversas
 * GET /conversations, GET /conversations/:id/messages, GET /conversations/:sessionId  
 */

async function handleConversationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    logger,
    sessionEvents,
    listChannelConversations,
    listConversationMessages,
    buildConversationReplay,
  } = deps;

  if (!pathname.startsWith('/conversations')) {
    return false;
  }

  // -----------------------------------------------------------------------
  // GET /conversations - Lista todas as conversas
  // -----------------------------------------------------------------------
  
  if (method === 'GET' && pathname === '/conversations') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Compatibilidade:
    // - padrão (sem query) mantém comportamento legado (sessionEvents / replay)
    // - com ?source=channels, retorna conversas persistidas no Channel Gateway (multi-tenant)
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const source = (urlObj.searchParams.get('source') || '').toLowerCase();
    if (source === 'channels' || source === 'channel' || source === 'omnichannel') {
      const permResult = requirePermission(req, 'tickets', 'read');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error });
        return true;
      }

      try {
        const status = urlObj.searchParams.get('status');
        const channelType = urlObj.searchParams.get('channel') || urlObj.searchParams.get('channelType');
        const queue = urlObj.searchParams.get('queue');
        const limit = urlObj.searchParams.get('limit') || '100';
        const offset = urlObj.searchParams.get('offset') || '0';

        const result = await listChannelConversations({
          tenantId: req.tenantId,
          status,
          channelType,
          queue,
          limit,
          offset,
        });

        sendJson(res, 200, { conversations: result.items, total: result.total, source: 'channels' });
      } catch (err) {
        logger.error('[Conversations] Erro ao listar conversas (channels):', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conversas (channels)' });
      }
      return true;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      logger.debug(`[Conversations] Listando conversas. Total de sessões em memória: ${sessionEvents.size}`);
      const conversations = [];
      for (const [sessionId, events] of sessionEvents.entries()) {
        if (!Array.isArray(events) || events.length === 0) continue;

        // Ordena eventos por timestamp
        const sortedEvents = [...events].sort((a, b) => {
          const timeA = new Date(a.timestamp).getTime();
          const timeB = new Date(b.timestamp).getTime();
          return timeA - timeB;
        });

        const firstEvent = sortedEvents[0];
        const lastEvent = sortedEvents[sortedEvents.length - 1];

        // Conta mensagens
        const messageCount = events.filter(e => e.type === 'MESSAGE_IN' || e.type === 'MESSAGE_OUT').length;
        const hasHandoff = events.some(e => e.type === 'HANDOFF');

        conversations.push({
          sessionId,
          flowId: firstEvent?.flowId || null,
          startTime: firstEvent?.timestamp || null,
          lastActivity: lastEvent?.timestamp || null,
          messageCount,
          eventCount: events.length,
          hasHandoff,
        });
      }

      // Ordena por última atividade (mais recentes primeiro)
      conversations.sort((a, b) => {
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return new Date(b.lastActivity) - new Date(a.lastActivity);
      });

      logger.debug(`[Conversations] Retornando ${conversations.length} conversa(s)`);
      sendJson(res, 200, { conversations });
    } catch (err) {
      logger.error('[Conversations] Erro ao listar conversas:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar conversas' });
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // GET /conversations/:id/messages - Lista mensagens persistidas  
  // -----------------------------------------------------------------------
  
  if (method === 'GET' && pathname.match(/^\/conversations\/[^\/]+\/messages$/)) {
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
      const conversationId = decodeURIComponent(pathname.split('/')[2]);
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const limit = urlObj.searchParams.get('limit') || '200';
      const offset = urlObj.searchParams.get('offset') || '0';

      const result = await listConversationMessages({
        tenantId: req.tenantId,
        conversationId,
        limit,
        offset,
      });

      sendJson(res, 200, { conversationId, messages: result.items, total: result.total });
    } catch (err) {
      logger.error('[Conversations] Erro ao listar mensagens (channels):', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar mensagens (channels)' });
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // GET /conversations/:sessionId - Obtém detalhes de uma conversa
  // -----------------------------------------------------------------------
  
  if (method === 'GET' && pathname.startsWith('/conversations/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'audit', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const sessionId = decodeURIComponent(pathname.slice('/conversations/'.length));
      const events = sessionEvents.get(sessionId);
      
      if (!events || !Array.isArray(events) || events.length === 0) {
        sendJson(res, 404, { error: 'conversation_not_found', message: 'Conversa não encontrada' });
        return true;
      }

      const replay = buildConversationReplay(events);
      sendJson(res, 200, replay);
    } catch (err) {
      logger.error('[Conversations] Erro ao obter conversa:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter conversa' });
    }
    return true;
  }

  // Not a conversation route
  return false;
}

module.exports = { handleConversationRoutes };
