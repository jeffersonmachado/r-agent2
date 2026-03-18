/**
 * Serviço de consulta de conversas/mensagens do Channel Gateway.
 *
 * Importante:
 * - Sempre filtra por tenant_key (multi-tenant hardening).
 * - Não altera endpoints legados; é usado quando /conversations?source=channels.
 */

'use strict';

const { getSequelize } = require('../db/sequelize');
const { ChannelConversation, ChannelMessage, Ticket } = require('../db/models');

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function dbAvailable() {
  return !!getSequelize();
}

async function listConversations({ tenantId, status = null, channelType = null, queue = null, limit = 100, offset = 0 } = {}) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId é obrigatório');
  }
  if (!dbAvailable()) {
    return { total: 0, items: [] };
  }

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const TicketModel = typeof Ticket === 'function' ? Ticket() : Ticket;

  const sequelize = ConversationModel.sequelize;
  const Op = sequelize.constructor.Op;

  const where = { tenant_key: tenantId };
  const statusValue = safeToString(status).trim();
  const channelTypeValue = safeToString(channelType).trim();
  if (statusValue) where.status = statusValue;
  if (channelTypeValue) where.channel_type = channelTypeValue;

  const queueValue = safeToString(queue).trim();
  if (queueValue) {
    const ticketRows = await TicketModel.findAll({
      where: { tenant_key: tenantId, queue: queueValue },
      attributes: ['id'],
      limit: 5000,
    });
    const ids = ticketRows.map(r => r.id).filter(Boolean);
    if (ids.length === 0) {
      return { total: 0, items: [] };
    }
    where.current_ticket_id = { [Op.in]: ids };
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const { count, rows } = await ConversationModel.findAndCountAll({
    where,
    order: [['last_message_at', 'DESC'], ['updated_at', 'DESC']],
    limit: safeLimit,
    offset: safeOffset,
  });

  const items = rows.map(r => ({
    id: r.id,
    tenantId: r.tenant_key,
    channelType: r.channel_type,
    externalId: r.external_id,
    contactId: r.contact_id || null,
    status: r.status,
    currentTicketId: r.current_ticket_id || null,
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : (r.updatedAt?.toISOString?.() || null),
  }));

  return { total: count, items };
}

async function listConversationMessages({ tenantId, conversationId, limit = 200, offset = 0 } = {}) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId é obrigatório');
  if (!conversationId || typeof conversationId !== 'string') throw new Error('conversationId é obrigatório');
  if (!dbAvailable()) return { total: 0, items: [] };

  const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 1000);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const { count, rows } = await MessageModel.findAndCountAll({
    where: {
      tenant_key: tenantId,
      conversation_id: conversationId,
    },
    order: [['created_at', 'ASC']],
    limit: safeLimit,
    offset: safeOffset,
  });

  const items = rows.map(r => ({
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    type: r.type,
    body: r.body || {},
    externalMessageId: r.external_message_id || null,
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
  }));

  return { total: count, items };
}

module.exports = {
  listConversations,
  listConversationMessages,
};

