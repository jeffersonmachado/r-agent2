/**
 * Serviço de consulta de conversas/mensagens do Channel Gateway.
 *
 * Importante:
 * - Sempre filtra por tenant_key (multi-tenant hardening).
 * - Não altera endpoints legados; é usado quando /conversations?source=channels.
 */

'use strict';

const crypto = require('crypto');
const { getSequelize } = require('../db/sequelize');
const { ChannelConversation, ChannelMessage, Ticket } = require('../db/models');
const logger = require('../utils/logger');
const { backfillPersistedMessageMedia, resolveWhatsAppAccountForBackfill } = require('./channelGatewayService');

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

function buildInternalMediaUrl(mediaId) {
  const id = safeToString(mediaId).trim();
  if (!id) return null;
  return `/tickets/media/${encodeURIComponent(id)}`;
}

function enrichBodyMediaUrl(body) {
  if (!body || typeof body !== 'object') return body;

  const next = { ...body };
  const mediaId =
    next?.media?.id
    || next?.ticketMediaId
    || next?.ticket_media_id
    || null;

  const mediaUrl = buildInternalMediaUrl(mediaId);
  if (mediaUrl) {
    const currentMediaUrl = safeToString(next.mediaUrl || '').trim();
    const isInternal = currentMediaUrl.startsWith('/tickets/media/');
    if (!isInternal) {
      next.mediaUrl = mediaUrl;
    }
  }

  for (const key of ['audio', 'image', 'video', 'document']) {
    if (!next[key] || typeof next[key] !== 'object') continue;
    if (next.mediaUrl) {
      next[key] = { ...next[key], url: next.mediaUrl };
    }
  }

  return next;
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
    assignedTo: r.assigned_to || null,
    metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : (r.updatedAt?.toISOString?.() || null),
  }));

  return { total: count, items };
}

function mapConversationRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    tenantId: r.tenant_key,
    channelType: r.channel_type,
    externalId: r.external_id,
    contactId: r.contact_id || null,
    status: r.status,
    currentTicketId: r.current_ticket_id || null,
    assignedTo: r.assigned_to || null,
    metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
    lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : (r.updatedAt?.toISOString?.() || null),
  };
}

async function getConversation({ tenantId, conversationId } = {}) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId é obrigatório');
  if (!conversationId || typeof conversationId !== 'string') throw new Error('conversationId é obrigatório');
  if (!dbAvailable()) return null;

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const row = await ConversationModel.findOne({
    where: { tenant_key: tenantId, id: safeToString(conversationId) },
  });
  return mapConversationRow(row);
}

const UPDATABLE_CONVERSATION_FIELDS = ['status', 'assigned_to', 'metadata', 'current_ticket_id', 'last_message_at'];

async function updateConversation({ tenantId, conversationId, patch = {} } = {}) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId é obrigatório');
  if (!conversationId || typeof conversationId !== 'string') throw new Error('conversationId é obrigatório');
  if (!dbAvailable()) return null;

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const row = await ConversationModel.findOne({
    where: { tenant_key: tenantId, id: safeToString(conversationId) },
  });
  if (!row) return null;

  const safePatch = { updated_at: new Date() };
  for (const field of UPDATABLE_CONVERSATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      safePatch[field] = patch[field];
    }
  }
  await row.update(safePatch);
  return mapConversationRow(row);
}

async function createMessage({ tenantId, conversationId, channelType, direction, type, body = {}, externalMessageId = null, status = null } = {}) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId é obrigatório');
  if (!conversationId || typeof conversationId !== 'string') throw new Error('conversationId é obrigatório');
  if (!dbAvailable()) {
    const err = new Error('persistence_required: sequelize indisponível para channel_messages');
    err.code = 'persistence_required';
    throw err;
  }

  const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
  const now = new Date();
  const id = `cmsg-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const dir = direction === 'out' ? 'out' : 'in';

  const row = await MessageModel.create({
    id,
    tenant_key: tenantId,
    conversation_id: conversationId,
    channel_type: safeToString(channelType, 'unknown') || 'unknown',
    direction: dir,
    type: safeToString(type, 'text') || 'text',
    body: body && typeof body === 'object' ? body : {},
    external_message_id: externalMessageId ? safeToString(externalMessageId) : null,
    status: status || (dir === 'out' ? 'pending' : 'received'),
    created_at: now,
    updated_at: now,
  });

  // Best-effort: mantém a conversa com last_message_at fresco.
  try {
    const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
    await ConversationModel.update(
      { last_message_at: now, updated_at: now },
      { where: { tenant_key: tenantId, id: conversationId } },
    );
  } catch (_) {
    // não falhar a persistência da mensagem por causa do touch da conversa
  }

  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    type: row.type,
    body: enrichBodyMediaUrl(row.body || {}),
    externalMessageId: row.external_message_id || null,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : now.toISOString(),
  };
}

/**
 * Agenda o backfill de mídia legada FORA do hot path de leitura.
 *
 * Fire-and-forget intencional:
 * - a listagem retorna imediatamente com os dados persistidos;
 * - mensagens WhatsApp sem mediaUrl são backfilled em background (a account é
 *   resolvida uma única vez por lote, não por mensagem);
 * - erros são logados (best-effort) e nunca viram unhandledRejection;
 * - sem intervals/timers: não segura o event loop em shutdown.
 */
function scheduleMediaBackfill({ tenantId, rows }) {
  const candidates = (rows || []).filter((row) => {
    if (!row) return false;
    if (safeToString(row.channel_type, '').trim().toLowerCase() !== 'whatsapp') return false;
    const body = row.body && typeof row.body === 'object' ? row.body : {};
    return safeToString(body.mediaUrl || body.url || '').trim() === '';
  });
  if (candidates.length === 0) return;

  setImmediate(() => {
    (async () => {
      let account = null;
      let accountResolved = false;
      for (const row of candidates) {
        if (!accountResolved) {
          account = await resolveWhatsAppAccountForBackfill(tenantId);
          accountResolved = true;
        }
        if (!account) return;
        // eslint-disable-next-line no-await-in-loop
        await backfillPersistedMessageMedia({ tenantId, messageRow: row, account });
      }
    })().catch((err) => {
      logger.warn('[channelConversationService] Backfill de mídia em background falhou (best-effort)', {
        tenantId,
        error: safeToString(err && err.message),
      });
    });
  });
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

  scheduleMediaBackfill({ tenantId, rows });

  const items = rows.map(r => ({
    id: r.id,
    conversationId: r.conversation_id,
    direction: r.direction,
    type: r.type,
    body: enrichBodyMediaUrl(r.body || {}),
    externalMessageId: r.external_message_id || null,
    status: r.status,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
  }));

  return { total: count, items };
}

/**
 * Busca conversas por ids em UMA query (evita N+1 de getConversation por link
 * em listCaseConversations). Retorna os objetos mapeados (mapConversationRow),
 * sem garantia de ordem — o caller ordena conforme sua estrutura.
 */
async function listConversationsByIds({ tenantId, ids } = {}) {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId é obrigatório');
  if (!dbAvailable()) return [];

  const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => safeToString(id)).filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const sequelize = ConversationModel.sequelize;
  const Op = sequelize.constructor.Op;

  const rows = await ConversationModel.findAll({
    where: { tenant_key: tenantId, id: { [Op.in]: uniqueIds } },
  });

  return rows.map(mapConversationRow).filter(Boolean);
}

module.exports = {
  listConversations,
  listConversationMessages,
  listConversationsByIds,
  getConversation,
  updateConversation,
  createMessage,
};

