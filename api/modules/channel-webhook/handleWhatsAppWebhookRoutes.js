'use strict';

/**
 * WhatsApp webhook routes.
 * GET  /webhooks/whatsapp  – hub verification
 * POST /webhooks/whatsapp  – inbound message processing
 */
async function handleWhatsAppWebhookRoutes({ req, res, method, pathname, deps }) {
  const {
    sendJson,
    parseJsonBody,
    logger,
    verifyWebhook,
    processWhatsAppMessage,
    channelNormalizationService,
    channelGatewayService,
    resolveOrCreateTicketFromIncomingMessage,
    appendTicketMessage,
    autoAssignTicket,
    emitEvent,
    flows,
    sessionEvents,
    sessionTenants,
    saveSessionEventsToFile,
  } = deps;

  if (pathname !== '/webhooks/whatsapp') return false;

  if (method === 'GET') {
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

  if (method === 'POST') {
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

                await processWhatsAppMessage(msg, value, {
                  flows,
                  sessionEvents,
                  sessionTenants,
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

  return false;
}

module.exports = { handleWhatsAppWebhookRoutes };
