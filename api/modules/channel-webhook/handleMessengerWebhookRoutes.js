'use strict';

/**
 * Messenger webhook routes.
 * GET  /webhooks/messenger  – hub verification
 * POST /webhooks/messenger  – inbound message processing
 * POST /messenger/send      – outbound send (auth-gated)
 */
async function handleMessengerWebhookRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    verifyMessengerWebhook,
    sendMessengerMessage,
    sendMessengerButtons,
    processWhatsAppMessage,
    channelGatewayService,
    resolveOrCreateTicketFromIncomingMessage,
    appendTicketMessage,
    autoAssignTicket,
    emitEvent,
    flows,
    sessionEvents,
    saveSessionEventsToFile,
  } = deps;

  if (pathname !== '/webhooks/messenger' && pathname !== '/messenger/send') return false;

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

            if (effectiveTicket && effectiveTicket.status !== 'closed' && (effectiveTicket.mode === 'human' || effectiveTicket.mode === 'paused')) {
              if (effectiveTicket.mode === 'human' && !effectiveTicket.assignedTo && effectiveTicket.status === 'waiting') {
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
        if (result.code === 'channel_not_configured') {
          sendJson(res, 503, { error: 'channel_not_configured', message: result.error });
          return true;
        }
        sendJson(res, 502, { error: 'send_failed', message: result.error });
        return true;
      }

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao enviar mensagem via Messenger:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleMessengerWebhookRoutes };
