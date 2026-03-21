module.exports = { handleChannelWebhookRoutes };

async function handleChannelWebhookRoutes({ req, res, method, pathname, deps }) {
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
              if (Array.isArray(value.statuses) && value.statuses.length > 0) {
                await channelGatewayService.updateStatus('whatsapp', { value }).catch(() => null);
              }
              const messages = value.messages || [];
              for (const msg of messages) {
                const normalizedArr = channelNormalizationService.normalizeWhatsAppIncoming({ message: msg, value, raw: body });
                const normalized = normalizedArr && normalizedArr[0] ? normalizedArr[0] : null;
                const ingest = await channelGatewayService.ingestIncoming('whatsapp', { message: msg, value, raw: body }).catch(() => null);

                const tenantId = ingest?.tenantId || null;
                if (!tenantId) {
                  logger.warn('[Webhook WhatsApp] Mensagem ignorada: tenant não resolvido (channel_account ausente/inativo)', {
                    phone_number_id: value?.metadata?.phone_number_id || null,
                    from: msg?.from ? String(msg.from) : null,
                    externalMessageId: msg?.id ? String(msg.id) : null,
                  });
                  continue;
                }

                if (ingest?.persist?.idempotent === true) {
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

                const link = await resolveOrCreateTicketFromIncomingMessage(
                  tenantId,
                  'whatsapp',
                  String(externalConversationId || ''),
                  { phone: msg?.from ? String(msg.from) : null }
                ).catch(() => null);

                const ticket = link?.ticket || null;
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
                  } catch (_) {}
                  continue;
                }

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

  if (method === 'POST' && pathname === '/webhooks/messenger') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'page') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const messagingArr = Array.isArray(entry.messaging) ? entry.messaging : [];
          for (const messaging of messagingArr) {
            const ingest = await channelGatewayService.ingestIncoming('messenger', { messaging, entry, raw: body }).catch(() => null);
            const tenantId = ingest?.tenantId || null;
            if (!tenantId) {
              logger.warn('[Webhook Messenger] Mensagem ignorada: tenant não resolvido (channel_account ausente/inativo)', {
                page_id: entry?.id || null,
                senderId: messaging?.sender?.id ? String(messaging.sender.id) : null,
                externalMessageId: messaging?.message?.mid || null,
              });
              continue;
            }

            if (ingest?.persist?.idempotent === true) {
              continue;
            }

            const senderId = messaging?.sender?.id ? String(messaging.sender.id) : null;
            const externalConversationId = ingest?.normalized?.conversationKey?.externalId || senderId || null;
            const messageText = messaging?.message?.text ? String(messaging.message.text) : '[Mensagem recebida]';
            const externalMessageId = messaging?.message?.mid ? String(messaging.message.mid) : null;
            const iso = messaging?.timestamp ? new Date(Number(messaging.timestamp)).toISOString() : null;

            const link = await resolveOrCreateTicketFromIncomingMessage(
              tenantId,
              'messenger',
              String(externalConversationId || ''),
              { contactId: externalConversationId || null }
            ).catch(() => null);
            const ticket = link?.ticket || null;

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
              } catch (_) {}
              continue;
            }

            const compatibleMessage = {
              from: senderId || 'unknown',
              id: externalMessageId || `ms-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              text: { body: messageText || '' },
              type: 'text',
              timestamp: messaging?.timestamp ? Math.floor(Number(messaging.timestamp) / 1000) : undefined,
            };
            const compatibleValue = { metadata: { phone_number_id: entry?.id ? String(entry.id) : null } };

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
            const ingest = await channelGatewayService.ingestIncoming('instagram', { entry, messaging, raw: body, pageId: entry.id }).catch(() => null);
            const tenantId = ingest?.tenantId || null;
            if (!tenantId) {
              logger.warn('[Webhook Instagram] Mensagem ignorada: tenant não resolvido (channel_account ausente/inativo)', {
                page_id: entry?.id || null,
                senderId: messaging?.sender?.id ? String(messaging.sender.id) : null,
                externalMessageId: normalized?.externalMessageId || messaging?.message?.mid || null,
              });
              continue;
            }

            if (ingest?.persist?.idempotent === true) {
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

            const link = await resolveOrCreateTicketFromIncomingMessage(
              tenantId,
              'instagram',
              String(externalConversationId || ''),
              { contactId: externalConversationId || null }
            ).catch(() => null);
            const ticket = link?.ticket || null;

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
              } catch (_) {}
              continue;
            }

            const senderId = messaging?.sender?.id ? String(messaging.sender.id) : (externalConversationId ? String(externalConversationId) : 'unknown');
            const compatibleMessage = {
              from: senderId,
              id: externalMessageId || `ig-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
              text: { body: messageText || '' },
              type: 'text',
              timestamp: messaging?.timestamp ? Math.floor(Number(messaging.timestamp) / 1000) : undefined,
            };
            const compatibleValue = { metadata: { phone_number_id: entry?.id ? String(entry.id) : null } };

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
