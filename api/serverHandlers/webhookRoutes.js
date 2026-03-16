module.exports = { handleWebhookRoutes };

async function handleWebhookRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    verifyWebhook,
    processWhatsAppMessage,
    verifyMessengerWebhook,
    sendMessengerMessage,
    sendMessengerButtons,
    verifyInstagramWebhook,
    sendInstagramMessage,
    sendInstagramMedia,
    channelNormalizationService,
    channelGatewayService,
    resolveOrCreateTicketFromIncomingMessage,
    appendTicketMessage,
    autoAssignTicket,
    emitEvent,
    flows,
    sessionEvents,
    saveSessionEventsToFile,
  } = deps;

  // Webhook do WhatsApp
  // -----------------------------------------------------------------------

  // GET /webhooks/whatsapp - verificação do webhook (setup no painel Meta)
  if (method === 'GET' && pathname === '/webhooks/whatsapp') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyWebhook(mode, token)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return true;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  // POST /webhooks/whatsapp - mensagens recebidas do WhatsApp
  if (method === 'POST' && pathname === '/webhooks/whatsapp') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            if (change.field === 'messages') {
              const value = change.value || {};
              // Atualiza status delivery/read/failed quando disponível (best-effort)
              if (Array.isArray(value.statuses) && value.statuses.length > 0) {
                // eslint-disable-next-line no-await-in-loop
                await channelGatewayService.updateStatus('whatsapp', { value }).catch(() => null);
              }
              const messages = value.messages || [];
              for (const msg of messages) {
                const normalizedArr = channelNormalizationService.normalizeWhatsAppIncoming({ message: msg, value, raw: body });
                const normalized = normalizedArr && normalizedArr[0] ? normalizedArr[0] : null;

                // 1) Persiste no gateway (best-effort) e resolve tenant
                // eslint-disable-next-line no-await-in-loop
                const ingest = await channelGatewayService.ingestIncoming('whatsapp', { message: msg, value, raw: body }).catch(() => null);

                // HARDENING (CRÍTICO): sem tenant resolvido (phone_number_id não cadastrado/ativo),
                // ignoramos a mensagem. Nunca processar engine e nunca criar ticket sem tenant.
                const tenantId = ingest?.tenantId || null;
                if (!tenantId) {
                  logger.warn('[Webhook WhatsApp] Mensagem ignorada: tenant não resolvido (channel_account ausente/inativo)', {
                    phone_number_id: value?.metadata?.phone_number_id || null,
                    from: msg?.from ? String(msg.from) : null,
                    externalMessageId: msg?.id ? String(msg.id) : null,
                  });
                  // eslint-disable-next-line no-continue
                  continue;
                }

                // HARDENING (CRÍTICO): idempotência inbound.
                // Se o gateway marcou a mensagem como duplicada (já persistida), NÃO processa ticket/engine novamente.
                if (ingest?.persist?.idempotent === true) {
                  // eslint-disable-next-line no-continue
                  continue;
                }
                const externalConversationId = normalized?.externalConversationId
                  || ingest?.normalized?.conversationKey?.externalId
                  || (msg?.from ? String(msg.from) : null);
                const messageText = typeof normalized?.text === 'string'
                  ? normalized.text
                  : (msg?.text?.body ? String(msg.text.body) : '');
                const externalMessageId = normalized?.externalMessageId || (msg?.id ? String(msg.id) : null);
                const iso = normalized?.timestamp || (() => {
                  const ts = msg?.timestamp ? Number(msg.timestamp) : null;
                  return ts && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
                })();

                // 2) Resolve ticket existente (ou cria, se configurado), sem quebrar compatibilidade
                // eslint-disable-next-line no-await-in-loop
                const link = await resolveOrCreateTicketFromIncomingMessage(
                  tenantId,
                  'whatsapp',
                  String(externalConversationId || ''),
                  { phone: msg?.from ? String(msg.from) : null }
                ).catch(() => null);

                const ticket = link?.ticket || null;

                // 2.1) Registra inbound no "ledger" do ticket (idempotente por externalMessageId)
                // (channel_messages já é persistido no ingestIncoming).
                let updatedTicket = null;
                if (ticket && ticket.id) {
                  try {
                    updatedTicket = appendTicketMessage(ticket.id, {
                      direction: 'in',
                      text: messageText,
                      externalMessageId,
                      timestamp: iso,
                    });
                  } catch (_) {
                    updatedTicket = ticket;
                  }
                }

                const effectiveTicket = updatedTicket || ticket;

                // 3) Se há ticket em modo humano, NÃO roda engine; apenas registra mensagem e notifica UI
                if (effectiveTicket && effectiveTicket.status !== 'closed' && ((effectiveTicket.mode || 'bot') === 'human' || (effectiveTicket.mode || 'bot') === 'paused')) {
                  // Fase 3: se entrou em atendimento humano e ainda não está atribuído, tenta auto-assign
                  if ((effectiveTicket.mode || 'bot') === 'human' && !effectiveTicket.assignedTo && effectiveTicket.status === 'waiting') {
                    autoAssignTicket(effectiveTicket.id).catch(() => null);
                  }
                  try {
                    emitEvent('ticket.message.received', {
                      ticketId: effectiveTicket.id,
                      message: messageText,
                      sender: 'user',
                      ticket: effectiveTicket,
                    }, { tenantId: effectiveTicket.tenantId, agentId: effectiveTicket.assignedTo });
                  } catch (e) {
                    // best-effort
                  }
                  // eslint-disable-next-line no-continue
                  continue;
                }

                // 4) Caso contrário, processa normalmente na engine (bot)
                // eslint-disable-next-line no-await-in-loop
                await processWhatsAppMessage(msg, value, {
                  flows,
                  sessionEvents,
                  saveSessionEvents: saveSessionEventsToFile,
                  tenantId,
                  conversationId: ingest?.persist?.conversationId || null,
                  channelType: 'whatsapp',
                });
              }
            }
          }
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook WhatsApp:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook',
      });
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Webhooks do Facebook Messenger
  // -----------------------------------------------------------------------

  // GET /webhooks/messenger - verificação do webhook
  if (method === 'GET' && pathname === '/webhooks/messenger') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyMessengerWebhook(mode, token, challenge)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return true;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  // POST /webhooks/messenger - mensagens recebidas do Messenger
  if (method === 'POST' && pathname === '/webhooks/messenger') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'page') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const messagingArr = Array.isArray(entry.messaging) ? entry.messaging : [];
          for (const messaging of messagingArr) {
            // 1) Persiste no gateway (best-effort) e resolve tenant
            // eslint-disable-next-line no-await-in-loop
            const ingest = await channelGatewayService.ingestIncoming('messenger', { messaging, entry, raw: body }).catch(() => null);
            const tenantId = ingest?.tenantId || null;
            if (!tenantId) {
              logger.warn('[Webhook Messenger] Mensagem ignorada: tenant não resolvido (channel_account ausente/inativo)', {
                page_id: entry?.id || null,
                senderId: messaging?.sender?.id ? String(messaging.sender.id) : null,
                externalMessageId: messaging?.message?.mid || null,
              });
              // eslint-disable-next-line no-continue
              continue;
            }

            // Idempotência inbound: se duplicada, não processa ticket/engine
            if (ingest?.persist?.idempotent === true) {
              // eslint-disable-next-line no-continue
              continue;
            }

            const senderId = messaging?.sender?.id ? String(messaging.sender.id) : null;
            const externalConversationId = ingest?.normalized?.conversationKey?.externalId || senderId || null;
            const messageText = messaging?.message?.text ? String(messaging.message.text) : '[Mensagem recebida]';
            const externalMessageId = messaging?.message?.mid ? String(messaging.message.mid) : null;
            const iso = messaging?.timestamp ? new Date(Number(messaging.timestamp)).toISOString() : null;

            // 2) Resolve ticket existente (ou cria, se configurado)
            // eslint-disable-next-line no-await-in-loop
            const link = await resolveOrCreateTicketFromIncomingMessage(
              tenantId,
              'messenger',
              String(externalConversationId || ''),
              { contactId: externalConversationId || null }
            ).catch(() => null);
            const ticket = link?.ticket || null;

            // 2.1) Ledger do ticket (idempotente por externalMessageId)
            let updatedTicket = null;
            if (ticket && ticket.id) {
              try {
                updatedTicket = appendTicketMessage(ticket.id, {
                  direction: 'in',
                  text: messageText,
                  externalMessageId,
                  timestamp: iso,
                });
              } catch (_) {
                updatedTicket = ticket;
              }
            }
            const effectiveTicket = updatedTicket || ticket;

            // 3) Se ticket em modo humano, NÃO roda engine; apenas notifica UI
            if (effectiveTicket && effectiveTicket.status !== 'closed' && ((effectiveTicket.mode || 'bot') === 'human' || (effectiveTicket.mode || 'bot') === 'paused')) {
              if ((effectiveTicket.mode || 'bot') === 'human' && !effectiveTicket.assignedTo && effectiveTicket.status === 'waiting') {
                autoAssignTicket(effectiveTicket.id).catch(() => null);
              }
              try {
                emitEvent('ticket.message.received', {
                  ticketId: effectiveTicket.id,
                  message: messageText,
                  sender: 'user',
                  ticket: effectiveTicket,
                }, { tenantId: effectiveTicket.tenantId, agentId: effectiveTicket.assignedTo });
              } catch (e) {}
              // eslint-disable-next-line no-continue
              continue;
            }

            // 4) Processa na engine (pipeline compartilhado), usando channelType=messenger
            const compatibleMessage = {
              from: senderId || 'unknown',
              id: externalMessageId || `ms-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              text: { body: messageText || '' },
              type: 'text',
              timestamp: messaging?.timestamp ? Math.floor(Number(messaging.timestamp) / 1000) : undefined,
            };
            const compatibleValue = { metadata: { phone_number_id: entry?.id ? String(entry.id) : null } };

            // eslint-disable-next-line no-await-in-loop
            await processWhatsAppMessage(compatibleMessage, compatibleValue, {
              flows,
              sessionEvents,
              saveSessionEvents: saveSessionEventsToFile,
              tenantId,
              conversationId: ingest?.persist?.conversationId || null,
              channelType: 'messenger',
            });
          }
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook Messenger:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook',
      });
    }
    return true;
  }

  // POST /messenger/send - Envia mensagem via Messenger
  if (method === 'POST' && pathname === '/messenger/send') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { recipientId, text, buttons } = body || {};

      if (!recipientId || !text) {
        badRequest(res, 'Campos "recipientId" e "text" são obrigatórios');
        return true;
      }

      let result;
      if (buttons && Array.isArray(buttons) && buttons.length > 0) {
        result = await sendMessengerButtons(recipientId, text, buttons);
      } else {
        result = await sendMessengerMessage(recipientId, text);
      }

      if (!result.success) {
        sendJson(res, 500, { error: 'send_failed', message: result.error });
        return true;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar mensagem via Messenger:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Webhooks do Instagram Direct
  // -----------------------------------------------------------------------

  // GET /webhooks/instagram - verificação do webhook
  if (method === 'GET' && pathname === '/webhooks/instagram') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyInstagramWebhook(mode, token, challenge)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return true;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  // POST /webhooks/instagram - mensagens recebidas do Instagram
  if (method === 'POST' && pathname === '/webhooks/instagram') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'instagram') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const messagingEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
          for (const messaging of messagingEvents) {
            const normalizedArr = channelNormalizationService.normalizeInstagramIncoming({ entry, messaging, raw: body, pageId: entry.id });
            const normalized = normalizedArr && normalizedArr[0] ? normalizedArr[0] : null;

            // 1) Persiste no gateway (best-effort) e resolve tenant
            // eslint-disable-next-line no-await-in-loop
            const ingest = await channelGatewayService.ingestIncoming('instagram', { entry, messaging, raw: body, pageId: entry.id }).catch(() => null);
            const tenantId = ingest?.tenantId || null;
            if (!tenantId) {
              logger.warn('[Webhook Instagram] Mensagem ignorada: tenant não resolvido (channel_account ausente/inativo)', {
                page_id: entry?.id || null,
                senderId: messaging?.sender?.id ? String(messaging.sender.id) : null,
                externalMessageId: normalized?.externalMessageId || messaging?.message?.mid || null,
              });
              // eslint-disable-next-line no-continue
              continue;
            }

            // HARDENING (CRÍTICO): idempotência inbound.
            if (ingest?.persist?.idempotent === true) {
              // eslint-disable-next-line no-continue
              continue;
            }

            const externalConversationId = normalized?.externalConversationId
              || ingest?.normalized?.conversationKey?.externalId
              || (messaging?.sender?.id ? String(messaging.sender.id) : null);
            const messageText = typeof normalized?.text === 'string'
              ? normalized.text
              : (messaging?.message?.text ? String(messaging.message.text) : '');
            const externalMessageId = normalized?.externalMessageId || (messaging?.message?.mid ? String(messaging.message.mid) : null);
            const iso = normalized?.timestamp || (messaging?.timestamp ? new Date(Number(messaging.timestamp)).toISOString() : null);

            // 2) Resolve ticket existente (ou cria, se configurado)
            // eslint-disable-next-line no-await-in-loop
            const link = await resolveOrCreateTicketFromIncomingMessage(
              tenantId,
              'instagram',
              String(externalConversationId || ''),
              { contactId: externalConversationId || null }
            ).catch(() => null);
            const ticket = link?.ticket || null;

            // 2.1) Ledger do ticket (idempotente por externalMessageId)
            let updatedTicket = null;
            if (ticket && ticket.id) {
              try {
                updatedTicket = appendTicketMessage(ticket.id, {
                  direction: 'in',
                  text: messageText,
                  externalMessageId,
                  timestamp: iso,
                });
              } catch (_) {
                updatedTicket = ticket;
              }
            }
            const effectiveTicket = updatedTicket || ticket;

            // 3) Se ticket em modo humano, NÃO roda engine; apenas notifica UI
            if (effectiveTicket && effectiveTicket.status !== 'closed' && ((effectiveTicket.mode || 'bot') === 'human' || (effectiveTicket.mode || 'bot') === 'paused')) {
              // Fase 3: se entrou em atendimento humano e ainda não está atribuído, tenta auto-assign
              if ((effectiveTicket.mode || 'bot') === 'human' && !effectiveTicket.assignedTo && effectiveTicket.status === 'waiting') {
                autoAssignTicket(effectiveTicket.id).catch(() => null);
              }
              try {
                emitEvent('ticket.message.received', {
                  ticketId: effectiveTicket.id,
                  message: messageText,
                  sender: 'user',
                  ticket: effectiveTicket,
                }, { tenantId: effectiveTicket.tenantId, agentId: effectiveTicket.assignedTo });
              } catch (e) {}
              // eslint-disable-next-line no-continue
              continue;
            }

            // 4) Processa na engine (pipeline compartilhado), usando channelType=instagram
            const senderId = messaging?.sender?.id ? String(messaging.sender.id) : (externalConversationId ? String(externalConversationId) : 'unknown');
            const compatibleMessage = {
              from: senderId,
              id: externalMessageId || `ig-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              text: { body: messageText || '' },
              type: 'text',
              timestamp: messaging?.timestamp ? Math.floor(Number(messaging.timestamp) / 1000) : undefined,
            };
            const compatibleValue = { metadata: { phone_number_id: entry?.id ? String(entry.id) : null } };

            // eslint-disable-next-line no-await-in-loop
            await processWhatsAppMessage(compatibleMessage, compatibleValue, {
              flows,
              sessionEvents,
              saveSessionEvents: saveSessionEventsToFile,
              tenantId,
              conversationId: ingest?.persist?.conversationId || null,
              channelType: 'instagram',
            });
          }
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook Instagram:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook',
      });
    }
    return true;
  }

  // POST /instagram/send - Envia mensagem via Instagram
  if (method === 'POST' && pathname === '/instagram/send') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { recipientId, text, mediaUrl, mediaType } = body || {};

      if (!recipientId) {
        badRequest(res, 'Campo "recipientId" é obrigatório');
        return true;
      }

      let result;
      if (mediaUrl) {
        result = await sendInstagramMedia(recipientId, mediaUrl, mediaType || 'image');
      } else if (text) {
        result = await sendInstagramMessage(recipientId, text);
      } else {
        badRequest(res, 'Campo "text" ou "mediaUrl" é obrigatório');
        return true;
      }

      if (!result.success) {
        sendJson(res, 500, { error: 'send_failed', message: result.error });
        return true;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar mensagem via Instagram:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}
