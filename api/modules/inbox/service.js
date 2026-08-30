'use strict';

/**
 * Inbox desacoplado de tickets: opera sobre ChannelConversation via
 * channelConversationService. Tickets (cases) entram apenas quando a conversa
 * tem current_ticket_id (compat) ou via POST /inbox/conversations/:id/case.
 *
 * Serviços de domínio são injetáveis via deps (padrão de testes do módulo);
 * por padrão usam as implementações reais.
 */

const channelConversationService = require('../../services/channelConversationService');
const outboundQueueService = require('../../services/outboundQueueService');
const conversationTicketLinkService = require('../../services/conversationTicketLinkService');
const caseService = require('../../services/caseService');
const defaultLogger = require('../../utils/logger');

function parseConversationId(req) {
  return decodeURIComponent(String(req.params.conversationId || ''));
}

function parseConversationsQuery(req) {
  const query = req.query && typeof req.query === 'object' ? req.query : {};
  const urlObj = new URL(req.url || '/', 'http://localhost');
  return {
    status: query.status ?? urlObj.searchParams.get('status'),
    channelType: query.channelType ?? urlObj.searchParams.get('channelType'),
    limitRaw: query.limit ?? urlObj.searchParams.get('limit'),
    offsetRaw: query.offset ?? urlObj.searchParams.get('offset'),
  };
}

function buildAuditMeta(req) {
  return {
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    userAgent: req.headers['user-agent'] || 'unknown',
  };
}

function resolveTenantId(req) {
  const raw = req.tenantId || (req.agent && req.agent.tenantId) || null;
  const tenantId = typeof raw === 'string' ? raw.trim() : '';
  return tenantId || null;
}

function mapTicketMessageToConversationMessage(ticketMessage, conversationId) {
  const sender = ticketMessage && ticketMessage.sender;
  return {
    id: ticketMessage.id || null,
    conversationId,
    direction: sender === 'agent' ? 'out' : 'in',
    type: ticketMessage.type || ticketMessage.mediaType || 'text',
    body: { text: ticketMessage.text || '' },
    externalMessageId: ticketMessage.externalMessageId || null,
    status: ticketMessage.deliveryStatus || 'received',
    createdAt: ticketMessage.timestamp || null,
  };
}

function createInboxService(deps) {
  const channels = deps.channelConversationService || channelConversationService;
  const outbound = deps.outboundQueueService || outboundQueueService;
  const linkService = deps.conversationTicketLinkService || conversationTicketLinkService;
  const cases = deps.caseService || caseService;
  const logger = deps.logger || defaultLogger;

  async function loadConversation(req) {
    const tenantId = resolveTenantId(req);
    if (!tenantId) {
      return { ok: false, status: 403, payload: { error: 'tenant_required' } };
    }
    const conversationId = parseConversationId(req);
    const conversation = await channels.getConversation({ tenantId, conversationId });
    if (!conversation) {
      return { ok: false, status: 404, payload: { error: 'conversation_not_found' } };
    }
    return { ok: true, tenantId, conversationId, conversation };
  }

  return {
    async listConversations(req) {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        return { ok: false, status: 403, payload: { error: 'tenant_required' } };
      }

      const { status, channelType, limitRaw, offsetRaw } = parseConversationsQuery(req);
      const result = await channels.listConversations({
        tenantId,
        status: status || null,
        channelType: channelType || null,
        limit: limitRaw,
        offset: offsetRaw,
      });

      const items = Array.isArray(result.items) ? result.items : [];
      const conversations = items.map((conversation) => ({
        ...conversation,
        caseId: conversation.currentTicketId || null,
      }));

      return { ok: true, status: 200, payload: { conversations, total: result.total || 0 } };
    },

    async getConversation(req) {
      const loaded = await loadConversation(req);
      if (!loaded.ok) return loaded;
      const { tenantId, conversationId, conversation } = loaded;

      const messagesResult = await channels.listConversationMessages({ tenantId, conversationId, limit: 500 });
      let messages = Array.isArray(messagesResult.items) ? messagesResult.items : [];

      // Compat: conversas antigas têm mensagens/notas apenas no ledger do ticket.
      const legacyTicket = conversation.currentTicketId && typeof deps.getTicket === 'function'
        ? deps.getTicket(conversation.currentTicketId)
        : null;
      if (messages.length === 0 && legacyTicket && Array.isArray(legacyTicket.messages)) {
        messages = legacyTicket.messages.map((m) => mapTicketMessageToConversationMessage(m, conversationId));
      }

      // Notas internas são primeira classe no payload: conversa sem ticket
      // persiste em metadata.notes; conversa com ticket usa o ledger
      // (sender 'note'). A UI não pode deixar a nota "sumir".
      const metadataNotes = conversation.metadata && Array.isArray(conversation.metadata.notes)
        ? conversation.metadata.notes
        : [];
      const ticketNotes = legacyTicket && Array.isArray(legacyTicket.messages)
        ? legacyTicket.messages.filter((m) => m && m.sender === 'note')
        : [];
      const notes = [
        ...metadataNotes.map((entry) => ({
          note: entry && entry.note != null ? String(entry.note) : '',
          author: entry && entry.author ? entry.author : null,
          authorUsername: entry && entry.authorUsername ? entry.authorUsername : null,
          at: entry && entry.at ? entry.at : null,
        })),
        ...ticketNotes.map((m) => ({
          note: m.text || '',
          author: m.authorId || null,
          authorUsername: m.authorName || null,
          at: m.timestamp || null,
        })),
      ].filter((entry) => entry.note);

      return {
        ok: true,
        status: 200,
        payload: {
          conversation: { ...conversation, caseId: conversation.currentTicketId || null },
          messages,
          notes,
        },
      };
    },

    async reply(req, body) {
      const loaded = await loadConversation(req);
      if (!loaded.ok) return loaded;
      const { tenantId, conversationId, conversation } = loaded;

      const text = body && body.body != null ? String(body.body).trim() : '';
      if (!text) {
        return { ok: false, kind: 'bad_request', message: 'body é obrigatório' };
      }
      const type = body && body.type ? String(body.type).trim() : 'text';
      const clientMessageId = `outq-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      let message;
      try {
        message = await channels.createMessage({
          tenantId,
          conversationId,
          channelType: conversation.channelType,
          direction: 'out',
          type,
          body: { text },
          externalMessageId: clientMessageId,
          status: 'pending',
        });
      } catch (err) {
        logger.error('[Inbox] Erro ao persistir mensagem outbound', {
          conversationId,
          error: err && err.message,
        });
        return { ok: false, status: 500, payload: { error: 'internal_error', message: 'Erro ao salvar mensagem da conversa' } };
      }

      // Mesmo dispatcher do POST /tickets/:id/message: outbound queue por canal.
      try {
        await outbound.enqueueOutbound({
          tenantId,
          channelType: conversation.channelType,
          conversationId,
          message: {
            to: conversation.externalId,
            type: 'text',
            body: { text },
            meta: { conversationId, clientMessageId },
          },
        });
      } catch (err) {
        logger.warn('[Inbox] Mensagem persistida, mas falha ao enfileirar envio outbound', {
          conversationId,
          channelType: conversation.channelType,
          error: err && err.message,
        });
      }

      // Compat: espelha no ledger do ticket atual (SupportPage legada).
      if (conversation.currentTicketId) {
        try {
          linkService.appendTicketMessage(conversation.currentTicketId, {
            direction: 'out',
            text,
            externalMessageId: clientMessageId,
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn('[Inbox] Falha ao espelhar reply no ticket atual (ignorado)', {
            conversationId,
            ticketId: conversation.currentTicketId,
            error: err && err.message,
          });
        }
      }

      return { ok: true, status: 200, payload: { message } };
    },

    async assignConversation(req, body) {
      const loaded = await loadConversation(req);
      if (!loaded.ok) return loaded;
      const { tenantId, conversationId, conversation } = loaded;

      const assigneeId = body && body.assigneeId ? String(body.assigneeId) : req.agent.id;

      // Compat: conversa com ticket atual delega ao ticket (comportamento preservado).
      if (conversation.currentTicketId && typeof deps.assignTicket === 'function') {
        const updatedTicket = deps.assignTicket(conversation.currentTicketId, assigneeId);
        if (updatedTicket) {
          deps.emitEvent && deps.emitEvent('ticket.assigned', {
            ticketId: conversation.currentTicketId,
            assignedTo: assigneeId,
            assignedBy: req.agent.id,
            ticket: updatedTicket,
          }, { tenantId, agentId: assigneeId });
        }
      }

      const updated = await channels.updateConversation({
        tenantId,
        conversationId,
        patch: { assigned_to: assigneeId },
      });

      deps.logAction && deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'conversation_assign',
        resource: 'conversation',
        resourceId: conversationId,
        details: { assigneeId, ticketId: conversation.currentTicketId || null, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: 200, payload: { conversation: updated || { ...conversation, assignedTo: assigneeId } } };
    },

    async transferConversation(req, body) {
      const loaded = await loadConversation(req);
      if (!loaded.ok) return loaded;
      const { tenantId, conversationId, conversation } = loaded;

      const hasAssignee = body && (body.assigneeId || body.assignedTo);
      const assigneeId = hasAssignee ? String(body.assigneeId || body.assignedTo) : null;
      const queue = body && body.queue ? String(body.queue).trim() : null;

      if (conversation.currentTicketId && typeof deps.transferTicket === 'function' && (queue || hasAssignee)) {
        const updatedTicket = deps.transferTicket(conversation.currentTicketId, {
          queue: queue || null,
          assignedTo: assigneeId,
        });
        if (updatedTicket) {
          deps.emitEvent && deps.emitEvent('ticket.updated', {
            ticketId: conversation.currentTicketId,
            ticket: updatedTicket,
            updatedBy: req.agent.id,
          }, { tenantId });
        }
      }

      let updated = conversation;
      if (assigneeId) {
        updated = await channels.updateConversation({
          tenantId,
          conversationId,
          patch: { assigned_to: assigneeId },
        }) || { ...conversation, assignedTo: assigneeId };
      }

      deps.logAction && deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'conversation_transfer',
        resource: 'conversation',
        resourceId: conversationId,
        details: { queue, assigneeId, ticketId: conversation.currentTicketId || null, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: 200, payload: { conversation: updated } };
    },

    async addNote(req, body) {
      const loaded = await loadConversation(req);
      if (!loaded.ok) return loaded;
      const { tenantId, conversationId, conversation } = loaded;

      const note = body && body.note ? String(body.note).trim() : '';
      if (!note) {
        return { ok: false, kind: 'bad_request', message: 'note é obrigatório' };
      }

      // Compat: nota vai para o ticket atual quando existir.
      if (conversation.currentTicketId && typeof deps.addTicketNote === 'function') {
        deps.addTicketNote(conversation.currentTicketId, note, req.agent);
      } else {
        const metadata = conversation.metadata && typeof conversation.metadata === 'object'
          ? conversation.metadata
          : {};
        const notes = Array.isArray(metadata.notes) ? metadata.notes : [];
        notes.push({
          note,
          author: req.agent.id,
          authorUsername: req.agent.username || null,
          at: new Date().toISOString(),
        });
        await channels.updateConversation({
          tenantId,
          conversationId,
          patch: { metadata: { ...metadata, notes } },
        });
      }

      deps.logAction && deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'conversation_note',
        resource: 'conversation',
        resourceId: conversationId,
        details: { noteLength: note.length, ticketId: conversation.currentTicketId || null, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: 200, payload: { ok: true } };
    },

    async createCase(req, body) {
      const loaded = await loadConversation(req);
      if (!loaded.ok) return loaded;
      const { tenantId, conversationId } = loaded;

      const result = await cases.createCaseFromConversation({
        tenantKey: tenantId,
        conversationId,
        subject: body && body.subject ? String(body.subject) : null,
        priority: body && body.priority ? String(body.priority) : null,
        createdBy: req.agent.id,
      });

      if (!result.ok) {
        return { ok: false, status: result.status, payload: { error: result.error } };
      }

      deps.logAction && deps.logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'case_create',
        resource: 'case',
        resourceId: result.case && result.case.id,
        details: { conversationId, source: 'inbox' },
        ...buildAuditMeta(req),
      });

      return { ok: true, status: result.status, payload: { case: result.case } };
    },
  };
}

module.exports = {
  createInboxService,
};
