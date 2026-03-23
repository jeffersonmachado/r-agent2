const {
  createInternalErrorResponder,
  ensureJsonRequest,
  ensureTicketPermission,
  getTicketAndValidateAccess,
  logTicketAction,
  parseTicketRouteId,
} = require('./ticketRouteUtils');

async function handleTicketCommunicationRoutes({ req, res, method, pathname, deps }) {
  const respondInternalError = createInternalErrorResponder(req, res, deps, 'Erro ao processar rota de comunicação de tickets');

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/mark-read')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'read' })) return true;

    const id = parseTicketRouteId(pathname, '/mark-read');
    const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id });
    if (!ticket) return true;

    const updatedTicket = deps.markMessagesAsRead(id);
    if (!updatedTicket) {
      deps.sendJson(res, 404, { error: 'ticket_not_found' });
      return true;
    }

    deps.sendJson(res, 200, { success: true, ticketId: id });
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/tickets/') && pathname.endsWith('/message')) {
    if (!ensureTicketPermission({ req, res, deps, permission: 'update' })) return true;
    if (!ensureJsonRequest({ req, res, deps })) return true;

    const id = parseTicketRouteId(pathname, '/message');

    try {
      const body = await deps.parseJsonBody(req);
      const message = body && body.message ? String(body.message) : '';
      const trimmedMessage = message.trim();
      const media = body && body.media && typeof body.media === 'object' ? body.media : null;
      const mediaType = media && media.type ? String(media.type).trim().toLowerCase() : '';
      const mediaUrl = media && media.url ? String(media.url).trim() : '';
      const mediaFileName = media && media.fileName ? String(media.fileName).trim() : '';
      const hasText = trimmedMessage.length > 0;
      const hasMedia = mediaType.length > 0 && mediaUrl.length > 0;

      if (!hasText && !hasMedia) {
        deps.badRequest(res, 'Campo "message" ou "media" é obrigatório e não pode estar vazio');
        return true;
      }

      const ticket = getTicketAndValidateAccess({ req, res, deps, ticketId: id, requireModify: true });
      if (!ticket) return true;

      if (ticket.status === 'closed') {
        deps.badRequest(res, 'Não é possível enviar mensagem para um ticket fechado');
        return true;
      }

      const agentId = req.agent.id;
      const messageForStorage = hasText
        ? trimmedMessage
        : `[${mediaType}] ${mediaFileName || mediaUrl}`;
      try {
        const clientMessageId = `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const updatedTicket = deps.addAgentMessage(id, messageForStorage, agentId, { clientMessageId, deliveryStatus: 'pending' });
        if (!updatedTicket) {
          deps.logger.warn('[Ticket] Não foi possível adicionar mensagem ao histórico (ticket não encontrado)', { ticketId: id });
          deps.sendJson(res, 404, { error: 'ticket_not_found' });
          return true;
        }
      } catch (addMessageError) {
        deps.logger.error('[Ticket] Erro ao adicionar mensagem ao histórico', {
          ticketId: id,
          error: addMessageError.message,
          stack: addMessageError.stack,
        });
        deps.sendJson(res, 500, {
          error: 'internal_error',
          message: 'Erro ao salvar mensagem no histórico do ticket',
        });
        return true;
      }

      const phoneNumber = ticket.phoneNumber;
      if (!phoneNumber) {
        deps.logger.warn('[Ticket] Número de telefone não encontrado no ticket, mensagem salva apenas no histórico', { ticketId: id });
      } else {
        try {
          const lastAgent = Array.isArray(ticket.messages)
            ? [...ticket.messages].reverse().find((m) => m && m.sender === 'agent' && m.deliveryStatus === 'pending')
            : null;
          const clientMessageId = lastAgent?.clientMessageId || `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
          if (!lastAgent?.clientMessageId) {
            deps.updateOutboundMessageMeta(id, { clientMessageId, deliveryStatus: 'pending' });
          }

          // O worker outbound atual suporta envio textual.
          // Para mídia sem texto, rebaixamos para mensagem textual com URL do anexo.
          const outboundText = hasText
            ? trimmedMessage
            : `${mediaFileName ? `[${mediaType}] ${mediaFileName}\n` : `[${mediaType}]\n`}${mediaUrl}`;

          await deps.outboundQueueService.enqueueOutbound({
            tenantId: req.tenantId,
            channelType: 'whatsapp',
            conversationId: ticket.conversationId || null,
            message: { to: phoneNumber, type: 'text', body: { text: outboundText }, meta: { ticketId: id, clientMessageId } },
          });
          deps.logger.info('[Ticket] Mensagem enfileirada (Outbound Queue)', { ticketId: id, phoneNumber });
        } catch (whatsappError) {
          if (whatsappError.message && whatsappError.message.includes('credentials')) {
            deps.logger.warn('[Ticket] Mensagem salva no histórico, mas não foi enviada via WhatsApp (credenciais inválidas)', {
              ticketId: id,
              phoneNumber,
              error: whatsappError.message,
            });
          } else {
            deps.logger.warn('[Ticket] Mensagem salva no histórico, mas falha ao enviar via WhatsApp', {
              ticketId: id,
              phoneNumber,
              error: whatsappError.message,
            });
          }
        }
      }

      deps.triggerWebhooks(req.tenantId, 'ticket.message.sent', {
        ticketId: id,
        agentId: req.agent.id,
        message: hasText ? trimmedMessage : messageForStorage,
      }).catch((err) => {
        deps.logger.error('[Webhook] Erro ao disparar webhook para ticket.message.sent:', err);
      });

      deps.emitEvent('ticket.message.sent', {
        ticketId: id,
        agentId: req.agent.id,
        message: hasText ? trimmedMessage : messageForStorage,
        ticket,
      }, { tenantId: req.tenantId, agentId: ticket.assignedTo });

      logTicketAction({
        req,
        deps,
        action: 'ticket_message',
        resourceId: id,
        details: {
          messageLength: (hasText ? trimmedMessage : messageForStorage).length,
          hasMedia,
          mediaType: hasMedia ? mediaType : null,
        },
      });

      deps.sendJson(res, 200, {
        success: true,
        ticketId: id,
        message: hasText ? trimmedMessage : messageForStorage,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        deps.badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        return respondInternalError(err, {
          logMessage: 'Erro ao enviar mensagem:',
          clientMessage: err.message || 'Erro ao enviar mensagem via WhatsApp',
        });
      }
    }
    return true;
  }

  return false;
}

module.exports = {
  handleTicketCommunicationRoutes,
};
