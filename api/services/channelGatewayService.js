/**
 * Channel Gateway Service (omnichannel).
 *
 * Padroniza entrada/saída dos canais (WhatsApp, Instagram, Webchat futuro)
 * e persiste em modelos únicos:
 * - channel_accounts
 * - channel_conversations
 * - channel_messages
 *
 * Regras:
 * - Multi-tenant: sempre requer tenantId (resolvido via token ou via channel_account para webhooks)
 * - Idempotência: externalMessageId não duplica (unique per tenant)
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { ChannelAccount, ChannelConversation, ChannelMessage } = require('../db/models');
const { encrypt, decrypt } = require('../utils/crypto');
const { getTicketBySession } = require('./queueService');
const { getTicketByConversationId, updateOutboundMessageMeta } = require('./queueService');
const outboundQueueService = require('./outboundQueueService');
const { OutboundQueueItem } = require('../db/models');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeTrimLower(value, fallback = '') {
  const str = safeToString(value, fallback);
  try {
    return str.trim().toLowerCase();
  } catch (_) {
    return fallback;
  }
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function decryptConfig(configEncrypted) {
  if (!configEncrypted) return null;
  try {
    const json = decrypt(configEncrypted);
    return safeJsonParse(json, null);
  } catch (err) {
    // Não quebrar ingest por config inválida
    logger.warn('[ChannelGateway] Falha ao descriptografar config', { error: safeToString(err?.message || err) });
    return null;
  }
}

function encryptConfig(configObj) {
  if (!configObj) return null;
  return encrypt(JSON.stringify(configObj));
}

async function resolveTenantForWebhook(channelType, payload) {
  // Webhooks não vêm autenticados: tentamos resolver via channel_accounts.external_id
  try {
    // HARDENING: sem DB, não há como resolver tenant com segurança.
    // Em produção, NUNCA deve haver fallback implícito de tenant em webhooks.
    if (!dbAvailable()) return { tenantId: null, account: null };

    const AccountModel = typeof ChannelAccount === 'function' ? ChannelAccount() : ChannelAccount;

    let externalId = null;
    if (channelType === 'whatsapp') {
      externalId = payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null;
    } else if (channelType === 'instagram') {
      externalId = payload?.pageId || payload?.entry?.id || payload?.page_id || null;
    } else if (channelType === 'messenger') {
      // Messenger webhooks: entry.id é o pageId
      externalId = payload?.pageId || payload?.entry?.id || payload?.entry?.[0]?.id || payload?.page_id || null;
    }

    if (!externalId) return { tenantId: null, account: null };

    const account = await AccountModel.findOne({
      where: {
        type: channelType,
        external_id: safeToString(externalId),
        status: 'active',
      },
      order: [['created_at', 'DESC']],
    });

    if (!account) return { tenantId: null, account: null };

    return {
      tenantId: account.tenant_key,
      account,
    };
  } catch (err) {
    // HARDENING: erro ao resolver tenant => ignora (caller deve descartar com segurança).
    logger.warn('[ChannelGateway] Falha ao resolver tenant do webhook; ignorando', { channelType, error: safeToString(err?.message || err) });
    return { tenantId: null, account: null };
  }
}

function normalizeIncoming(channelType, payload) {
  if (channelType === 'whatsapp') {
    const msg = payload?.message;
    const value = payload?.value || {};
    const from = msg?.from ? safeToString(msg.from) : null;
    const messageId = msg?.id ? safeToString(msg.id) : null;

    const waType = msg?.type || (msg?.text?.body ? 'text' : null);
    let type = 'text';
    let body = {};

    if (waType === 'text') {
      type = 'text';
      body = { text: safeToString(msg?.text?.body || '') };
    } else if (waType === 'audio') {
      type = 'audio';
      body = { audio: msg?.audio || {} };
    } else if (waType === 'image') {
      type = 'image';
      body = { image: msg?.image || {} };
    } else if (waType === 'document') {
      type = 'document';
      body = { document: msg?.document || {} };
    } else if (waType === 'interactive') {
      type = 'interactive';
      body = { interactive: msg?.interactive || {} };
    } else {
      type = waType || 'text';
      body = { raw: msg || {} };
    }

    // Conversation key: externalId = user phone
    const externalId = from ? from.replace(/^\+/, '') : 'unknown';
    const contactId = externalId;

    return {
      conversationKey: {
        channelType: 'whatsapp',
        externalId,
        contactId,
        // tenantId será preenchido pelo caller
      },
      message: {
        direction: 'in',
        type,
        body,
        externalMessageId: messageId,
        status: 'received',
        meta: {
          wa: {
            phone_number_id: value?.metadata?.phone_number_id || null,
          },
        },
      },
    };
  }

  if (channelType === 'instagram') {
    // payload pode vir como { messaging } ou { entry }
    const messaging = payload?.messaging || payload?.entry?.messaging?.[0] || payload?.entry?.messaging?.[0] || null;
    if (!messaging) {
      return {
        conversationKey: { channelType: 'instagram', externalId: 'unknown', contactId: 'unknown' },
        message: { direction: 'in', type: 'text', body: { text: '' }, externalMessageId: null, status: 'received' },
      };
    }

    const senderId = messaging?.sender?.id ? safeToString(messaging.sender.id) : 'unknown';
    const msg = messaging?.message || {};
    const mid = msg?.mid ? safeToString(msg.mid) : null;

    let type = 'text';
    let body = {};

    if (msg?.text) {
      type = 'text';
      body = { text: safeToString(msg.text) };
    } else if (Array.isArray(msg?.attachments) && msg.attachments.length > 0) {
      const att = msg.attachments[0];
      const attType = att?.type || 'attachment';
      type = attType === 'image' ? 'image' : (attType === 'video' ? 'video' : 'document');
      body = { attachments: msg.attachments };
    } else {
      body = { raw: msg };
    }

    return {
      conversationKey: {
        channelType: 'instagram',
        externalId: senderId,
        contactId: senderId,
      },
      message: {
        direction: 'in',
        type,
        body,
        externalMessageId: mid,
        status: 'received',
      },
    };
  }

  if (channelType === 'messenger') {
    // payload pode vir como { messaging } (obj) ou { entry } (webhook)
    const messaging =
      payload?.messaging
      || payload?.entry?.messaging?.[0]
      || payload?.entry?.[0]?.messaging?.[0]
      || null;
    const senderId = messaging?.sender?.id ? safeToString(messaging.sender.id) : null;
    const recipientId = messaging?.recipient?.id ? safeToString(messaging.recipient.id) : null; // pageId
    const msg = messaging?.message || null;
    const externalMessageId = msg?.mid ? safeToString(msg.mid) : null;

    let type = 'text';
    let body = {};
    if (msg?.text) {
      type = 'text';
      body = { text: safeToString(msg.text) };
    } else if (Array.isArray(msg?.attachments) && msg.attachments.length > 0) {
      type = safeToString(msg.attachments[0]?.type || 'attachment');
      body = { attachments: msg.attachments };
    } else {
      type = 'text';
      body = { raw: msg || {} };
    }

    const externalId = senderId ? senderId.replace(/^\+/, '') : 'unknown';
    const contactId = externalId;

    return {
      conversationKey: {
        channelType: 'messenger',
        externalId,
        contactId,
      },
      message: {
        direction: 'in',
        type,
        body,
        externalMessageId,
        status: 'received',
        meta: {
          messenger: {
            page_id: recipientId || null,
          },
        },
      },
    };
  }

  throw new Error(`channelType "${channelType}" não suportado em normalizeIncoming`);
}

async function upsertConversation({ tenantId, channelType, externalId, contactId = null, status = 'open', currentTicketId = null, lastMessageAt = null }) {
  if (!dbAvailable()) return null;
  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;

  const existing = await ConversationModel.findOne({
    where: {
      tenant_key: tenantId,
      channel_type: channelType,
      external_id: externalId,
    },
  });

  const now = new Date();
  const payload = {
    tenant_key: tenantId,
    channel_type: channelType,
    external_id: externalId,
    contact_id: contactId,
    status,
    current_ticket_id: currentTicketId,
    last_message_at: lastMessageAt ? new Date(lastMessageAt) : null,
    updated_at: now,
  };

  if (existing) {
    await existing.update(payload);
    return existing;
  }

  const created = await ConversationModel.create({
    id: newId('conv'),
    ...payload,
    created_at: now,
  });
  return created;
}

async function persistIncoming({ tenantId, channelType, conversationKey, messageNormalized }) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId é obrigatório para persistIncoming');
  }
  if (!dbAvailable()) {
    return { persisted: false, reason: 'db_unavailable' };
  }

  const externalId = safeToString(conversationKey.externalId || 'unknown');
  const contactId = conversationKey.contactId ? safeToString(conversationKey.contactId) : null;

  // Mapeia ticket existente (compatibilidade com ticket = sessão)
  let currentTicketId = null;
  let derivedStatus = 'bot';
  const bodyMeta = messageNormalized?.body && typeof messageNormalized.body === 'object' ? messageNormalized.body.meta : null;
  const metaTicketId = bodyMeta?.ticketId || bodyMeta?.ticket_id || messageNormalized?.body?.ticketId || null;
  if (metaTicketId) {
    currentTicketId = safeToString(metaTicketId);
    derivedStatus = 'human';
  }
  if (!currentTicketId && channelType === 'whatsapp' && externalId && externalId !== 'unknown') {
    const sessionId = `whatsapp_${externalId.replace(/^\+/, '')}`;
    const ticket = getTicketBySession(sessionId);
    if (ticket && ticket.status !== 'closed') {
      currentTicketId = ticket.id;
      derivedStatus = 'human';
    }
  }

  const conversation = await upsertConversation({
    tenantId,
    channelType,
    externalId,
    contactId,
    status: derivedStatus,
    currentTicketId,
    lastMessageAt: new Date().toISOString(),
  });

  const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
  const now = new Date();

  const externalMessageId = messageNormalized.externalMessageId ? safeToString(messageNormalized.externalMessageId) : null;

  if (externalMessageId) {
    const existing = await MessageModel.findOne({
      where: {
        tenant_key: tenantId,
        channel_type: channelType,
        external_message_id: externalMessageId,
      },
    });
    if (existing) {
      return { persisted: true, idempotent: true, conversationId: conversation.id, messageId: existing.id };
    }
  }

  try {
    const created = await MessageModel.create({
      id: newId('msg'),
      tenant_key: tenantId,
      conversation_id: conversation.id,
      channel_type: channelType,
      direction: messageNormalized.direction,
      type: messageNormalized.type,
      body: messageNormalized.body || {},
      external_message_id: externalMessageId,
      status: messageNormalized.status || 'received',
      created_at: now,
      updated_at: now,
    });

    return { persisted: true, idempotent: false, conversationId: conversation.id, messageId: created.id };
  } catch (err) {
    // Protege contra race: unique violation em external_message_id
    const msg = safeToString(err?.message || '');
    const pgCode = err?.original?.code ? safeToString(err.original.code) : null;
    if (
      err?.name === 'SequelizeUniqueConstraintError' ||
      pgCode === '23505' ||
      msg.includes('channel_messages_tenant_channel_type_external_msg_id_uq') ||
      msg.includes('duplicate key')
    ) {
      logger.debug('[ChannelGateway] Duplicate message ignored', { tenantId, channelType, externalMessageId });
      return { persisted: true, idempotent: true, conversationId: conversation.id, messageId: null };
    }
    throw err;
  }
}

async function ingestIncoming(channelType, payload, options = {}) {
  const tenantIdFromCaller = options.tenantId || null;
  let tenantId = tenantIdFromCaller;
  let account = null;

  if (!tenantId) {
    const resolved = await resolveTenantForWebhook(channelType, payload);
    tenantId = resolved.tenantId;
    account = resolved.account;
  }

  const normalized = normalizeIncoming(channelType, payload);
  normalized.conversationKey.tenantId = tenantId;

  // HARDENING: sem tenant resolvido, não persiste e deixa o caller decidir (server deve ignorar).
  if (!tenantId) {
    return { tenantId: null, account: null, normalized, persist: { persisted: false, reason: 'tenant_unresolved' } };
  }

  const persist = await persistIncoming({
    tenantId,
    channelType,
    conversationKey: normalized.conversationKey,
    messageNormalized: normalized.message,
  }).catch((err) => {
    logger.warn('[ChannelGateway] Falha ao persistir inbound (best-effort)', { channelType, tenantId, error: safeToString(err?.message || err) });
    return { persisted: false, reason: 'persist_failed' };
  });

  return { tenantId, account, normalized, persist };
}

async function sendMessage(channelType, account, messageNormalized, options = {}) {
  // Por padrão, apenas enfileira. Worker tenta enviar e atualizar status.
  const tenantId = options.tenantId || account?.tenant_key || null;
  if (!tenantId) throw new Error('tenantId é obrigatório para sendMessage');

  const res = await outboundQueueService.enqueueOutbound({
    tenantId,
    channelType,
    channelAccountId: account?.id || null,
    conversationId: options.conversationId || null,
    message: messageNormalized,
  });

  return res;
}

async function updateStatus(channelType, statusPayload, options = {}) {
  if (!dbAvailable()) return { updated: 0, reason: 'db_unavailable' };

  // Por enquanto implementa WhatsApp statuses:
  // value.statuses = [{ id, status: sent|delivered|read|failed, timestamp, recipient_id }]
  if (channelType !== 'whatsapp') return { updated: 0, reason: 'not_implemented' };

  const resolved = await resolveTenantForWebhook(channelType, statusPayload);
  const tenantId = options.tenantId || resolved.tenantId || null;
  if (!tenantId) {
    const valueForLog = statusPayload?.value || statusPayload?.change?.value || statusPayload?.payload?.value || statusPayload || {};
    logger.warn('[ChannelGateway] Status recebido sem tenant resolvido; ignorando', {
      channelType,
      phone_number_id: valueForLog?.metadata?.phone_number_id || null,
      statusesCount: Array.isArray(valueForLog?.statuses) ? valueForLog.statuses.length : 0,
    });
    return { updated: 0, reason: 'tenant_unresolved' };
  }

  const value = statusPayload?.value || statusPayload?.change?.value || statusPayload?.payload?.value || statusPayload || {};
  const statuses = Array.isArray(value.statuses) ? value.statuses : [];
  if (statuses.length === 0) return { updated: 0 };

  const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
  const OutModel = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  let updated = 0;

  for (const st of statuses) {
    const externalMessageId = st?.id ? safeToString(st.id) : null;
    const status = st?.status ? safeToString(st.status) : null;
    if (!externalMessageId || !status) continue;

    const row = await MessageModel.findOne({
      where: { tenant_key: tenantId, channel_type: channelType, external_message_id: externalMessageId },
    });
    if (!row) continue;

    await row.update({ status, updated_at: new Date() });
    updated++;

    // Atualiza status no outbound_queue (quando houver correlação por external_message_id).
    // Importante: outboundQueueService.processDue só reprocessa itens SEM external_message_id,
    // então marcar "failed" aqui não causa retries de mensagens já enviadas ao canal.
    try {
      const outRow = await OutModel.findOne({
        where: { tenant_key: tenantId, channel_type: channelType, external_message_id: externalMessageId },
        order: [['updated_at', 'DESC']],
      });
      if (outRow) {
        await outRow.update({
          status,
          last_error: status === 'failed' ? (st?.errors ? JSON.stringify(st.errors).slice(0, 4000) : (outRow.last_error || 'delivery_failed')) : outRow.last_error,
          updated_at: new Date(),
        }).catch(() => null);
      }
    } catch (_) {}

    // Best-effort: propaga status para o ledger do ticket (UI atual)
    try {
      const conversationId = row.conversation_id ? safeToString(row.conversation_id) : null;
      if (conversationId) {
        const ticket = getTicketByConversationId(conversationId, tenantId);
        if (ticket) {
          const patched = updateOutboundMessageMeta(ticket.id, { externalMessageId, deliveryStatus: status });
          if (patched) {
            // Lazy require para evitar ciclos
            // eslint-disable-next-line global-require
            const { emitEvent } = require('./websocketService');
            emitEvent('ticket.updated', {
              ticketId: patched.id,
              ticket: patched,
              change: { type: 'message_status', externalMessageId, status },
            }, { tenantId: patched.tenantId, agentId: patched.assignedTo });
          }
        }
      }
    } catch (_) {}
  }

  return { updated };
}

module.exports = {
  normalizeIncoming,
  ingestIncoming,
  sendMessage,
  updateStatus,
  // utilidades (para futuras UIs)
  encryptConfig,
  decryptConfig,
  resolveTenantForWebhook,
};

