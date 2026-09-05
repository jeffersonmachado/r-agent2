/**
 * Serviço de consulta de conversas/mensagens do Channel Gateway.
 *
 * Importante:
 * - Sempre filtra por tenant_key (multi-tenant hardening).
 * - Não altera endpoints legados; é usado quando /conversations?source=channels.
 */

'use strict';

const crypto = require('crypto');
const { Op, QueryTypes } = require('sequelize');
const { getSequelize } = require('../db/sequelize');
const { ChannelConversation, ChannelMessage, Ticket, WorkspaceEntity, WorkspaceEntityLink } = require('../db/models');
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

function escapeILikePattern(value) {
  // PostgreSQL usa '\' como escape padrão de LIKE/ILIKE.
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function isWhatsAppLikeChannel(channelType) {
  return safeToString(channelType).trim().toLowerCase().startsWith('whatsapp');
}

function resolveContactName(metadata, entityName) {
  const fromMetadata = safeToString(metadata && (metadata.contactName || metadata.senderName)).trim();
  if (fromMetadata) return fromMetadata;
  const fromEntity = safeToString(entityName).trim();
  return fromEntity || null;
}

function resolveUnreadCount(metadata) {
  const unread = metadata && typeof metadata.unread === 'object' ? metadata.unread : null;
  const count = unread ? Number(unread.count) : 0;
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * Última mensagem de cada conversa da página em UMA query (DISTINCT ON),
 * evitando N+1 por row.
 */
async function fetchLastMessagesByConversation({ sequelize, tenantId, conversationIds }) {
  const map = new Map();
  if (!sequelize || typeof sequelize.query !== 'function' || conversationIds.length === 0) return map;

  const rows = await sequelize.query(
    `SELECT DISTINCT ON (conversation_id) conversation_id, body, type, direction, created_at
     FROM channel_messages
     WHERE tenant_key = :tenantId AND conversation_id IN (:conversationIds)
     ORDER BY conversation_id, created_at DESC`,
    {
      replacements: { tenantId, conversationIds },
      type: QueryTypes.SELECT,
    },
  );

  for (const row of rows || []) {
    if (!row || !row.conversation_id) continue;
    const body = row.body && typeof row.body === 'object' ? row.body : {};
    const text = body.text != null ? safeToString(body.text).trim() : '';
    map.set(safeToString(row.conversation_id), {
      text: text || null,
      type: safeToString(row.type, 'text') || 'text',
      direction: safeToString(row.direction, 'in') || 'in',
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    });
  }
  return map;
}

/**
 * Nome do contato via WorkspaceEntityLink (source_type 'conversation') →
 * WorkspaceEntity.name, em 2 queries batched para toda a página (sem N+1).
 */
async function fetchEntityNamesByConversation({ tenantId, conversationIds }) {
  const map = new Map();
  if (conversationIds.length === 0 || !WorkspaceEntityLink || !WorkspaceEntity) return map;

  const LinkModel = typeof WorkspaceEntityLink === 'function' ? WorkspaceEntityLink() : WorkspaceEntityLink;
  const EntityModel = typeof WorkspaceEntity === 'function' ? WorkspaceEntity() : WorkspaceEntity;
  if (!LinkModel || typeof LinkModel.findAll !== 'function') return map;
  if (!EntityModel || typeof EntityModel.findAll !== 'function') return map;

  const sequelize = LinkModel.sequelize || (EntityModel && EntityModel.sequelize) || getSequelize();
  const LinkOp = (sequelize && sequelize.constructor && sequelize.constructor.Op) || Op;

  const links = await LinkModel.findAll({
    where: {
      tenant_id: tenantId,
      source_type: 'conversation',
      source_id: { [LinkOp.in]: conversationIds },
    },
    attributes: ['source_id', 'entity_id'],
  });

  const entityIds = Array.from(new Set((links || []).map((l) => l && l.entity_id).filter(Boolean)));
  if (entityIds.length === 0) return map;

  const entities = await EntityModel.findAll({
    where: { tenant_id: tenantId, id: { [LinkOp.in]: entityIds } },
    attributes: ['id', 'name'],
  });
  const nameByEntity = new Map((entities || []).map((e) => [e.id, e.name]));

  for (const link of links || []) {
    if (!link || !link.source_id) continue;
    const name = nameByEntity.get(link.entity_id);
    if (name && !map.has(link.source_id)) {
      map.set(safeToString(link.source_id), name);
    }
  }
  return map;
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

async function listConversations({ tenantId, status = null, channelType = null, queue = null, q = null, limit = 100, offset = 0 } = {}) {
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

  const qValue = safeToString(q).trim();
  if (qValue) {
    const pattern = `%${escapeILikePattern(qValue)}%`;
    where[Op.or] = [
      { external_id: { [Op.iLike]: pattern } },
      { contact_id: { [Op.iLike]: pattern } },
      { 'metadata.contactName': { [Op.iLike]: pattern } },
      { 'metadata.senderName': { [Op.iLike]: pattern } },
    ];
  }

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

  const conversationIds = rows.map((r) => r && r.id).filter(Boolean);

  // Enrichment best-effort: falha na query batched não derruba a listagem.
  let lastMessageByConversation = new Map();
  try {
    lastMessageByConversation = await fetchLastMessagesByConversation({ sequelize, tenantId, conversationIds });
  } catch (err) {
    logger.warn('[channelConversationService] Falha ao buscar últimas mensagens da página (best-effort)', {
      tenantId,
      error: safeToString(err && err.message),
    });
  }

  let entityNameByConversation = new Map();
  try {
    entityNameByConversation = await fetchEntityNamesByConversation({ tenantId, conversationIds });
  } catch (err) {
    logger.warn('[channelConversationService] Falha ao resolver nomes de contato via workspace (best-effort)', {
      tenantId,
      error: safeToString(err && err.message),
    });
  }

  const items = rows.map(r => {
    const metadata = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
    return {
      id: r.id,
      tenantId: r.tenant_key,
      channelType: r.channel_type,
      externalId: r.external_id,
      contactId: r.contact_id || null,
      status: r.status,
      currentTicketId: r.current_ticket_id || null,
      assignedTo: r.assigned_to || null,
      metadata,
      contactName: resolveContactName(metadata, entityNameByConversation.get(r.id)),
      phoneNumber: isWhatsAppLikeChannel(r.channel_type)
        ? (safeToString(r.contact_id || r.external_id).trim() || null)
        : null,
      lastMessage: lastMessageByConversation.get(r.id) || null,
      unreadCount: resolveUnreadCount(metadata),
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : (r.createdAt?.toISOString?.() || null),
      updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : (r.updatedAt?.toISOString?.() || null),
    };
  });

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

/**
 * Emissão de eventos de conversa via WebSocket: sempre best-effort
 * (nunca quebra o request path, inclusive quando o WS não está inicializado).
 */
function emitConversationEvent(event, payload, options = {}) {
  try {
    // Lazy require para evitar ciclos de módulos.
    // eslint-disable-next-line global-require
    const { emitEvent } = require('./websocketService');
    emitEvent(event, payload, options);
  } catch (err) {
    logger.warn('[channelConversationService] Falha ao emitir evento de conversa (best-effort)', {
      event,
      error: safeToString(err && err.message),
    });
  }
}

/**
 * Atividade de mensagem inbound persistida:
 * 1. incrementa metadata.unread.count + metadata.unread.lastInboundAt (merge
 *    seguro, sem clobber das demais chaves de metadata);
 * 2. emite conversation.message.received no WebSocket do tenant.
 * Tudo best-effort: falhas são logadas e nunca quebram a persistência.
 */
async function registerInboundMessageActivity({ tenantId, conversationId, channelType, message = {} } = {}) {
  if (!tenantId || !conversationId) return;

  try {
    if (dbAvailable()) {
      const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
      const row = await ConversationModel.findOne({
        where: { tenant_key: tenantId, id: safeToString(conversationId) },
      });
      if (row && typeof row.update === 'function') {
        const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
        const unread = metadata.unread && typeof metadata.unread === 'object' ? metadata.unread : {};
        await row.update({
          metadata: {
            ...metadata,
            unread: {
              ...unread,
              count: resolveUnreadCount(metadata) + 1,
              lastInboundAt: new Date().toISOString(),
            },
          },
          updated_at: new Date(),
        });
      }
    }
  } catch (err) {
    logger.warn('[channelConversationService] Falha ao incrementar unread da conversa (best-effort)', {
      tenantId,
      conversationId,
      error: safeToString(err && err.message),
    });
  }

  const body = message.body && typeof message.body === 'object' ? message.body : {};
  const text = body.text != null ? safeToString(body.text).slice(0, 200) : null;
  emitConversationEvent('conversation.message.received', {
    conversationId,
    channelType: safeToString(channelType, 'unknown') || 'unknown',
    tenantId,
    message: {
      id: message.id || null,
      direction: message.direction || 'in',
      type: safeToString(message.type, 'text') || 'text',
      text,
      createdAt: message.createdAt || new Date().toISOString(),
    },
  }, { tenantId });
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

  if (dir === 'in') {
    await registerInboundMessageActivity({
      tenantId,
      conversationId,
      channelType,
      message: {
        id: row.id,
        direction: dir,
        type: row.type,
        body: row.body || {},
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : now.toISOString(),
      },
    });
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
  registerInboundMessageActivity,
};

