'use strict';

const config = require('../../utils/config');
const { verifyMetaSignature } = require('../../utils/metaWebhookSignature');
const { parseJsonBodyWithRaw: parseJsonBodyWithRawFallback } = require('../../express/httpHelpers');

let warnedMissingAppSecret = false;

/**
 * Instagram webhook routes.
 * GET  /webhooks/instagram  – hub verification
 * POST /webhooks/instagram  – inbound message processing
 * POST /instagram/send      – outbound send (auth-gated)
 */
async function handleInstagramWebhookRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    parseJsonBodyWithRaw,
    logger,
    verifyInstagramWebhook,
    sendInstagramMessage,
    sendInstagramMedia,
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

  if (pathname !== '/webhooks/instagram' && pathname !== '/instagram/send') return false;

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
      const readBody = parseJsonBodyWithRaw || parseJsonBodyWithRawFallback;
      const { body, raw } = await readBody(req);

      const appSecret = String(config.get('instagram.appSecret') || '').trim();
      if (appSecret) {
        const signatureHeader = req.headers ? req.headers['x-hub-signature-256'] : undefined;
        if (!verifyMetaSignature({ rawBody: raw, signatureHeader, appSecret })) {
          logger.warn('[Webhook Instagram] Assinatura X-Hub-Signature-256 ausente ou inválida; payload rejeitado');
          sendJson(res, 401, { error: 'invalid_signature' });
          return true;
        }
      } else if (String(config.get('nodeEnv') || '').trim().toLowerCase() === 'production') {
        logger.error('[Webhook Instagram] instagram.appSecret não configurado em produção; webhook rejeitado (fail-closed)');
        sendJson(res, 503, { error: 'webhook_misconfigured' });
        return true;
      } else if (!warnedMissingAppSecret) {
        warnedMissingAppSecret = true;
        logger.warn('[Webhook Instagram] instagram.appSecret não configurado; processando SEM verificação de assinatura (fora de produção)');
      }

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
              sessionTenants,
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
        if (result.code === 'channel_not_configured') {
          sendJson(res, 503, { error: 'channel_not_configured', message: result.error });
          return true;
        }
        sendJson(res, 502, { error: 'send_failed', message: result.error });
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

module.exports = { handleInstagramWebhookRoutes };
