/**
 * Serviço de Outbound Queue (DB-first).
 *
 * Objetivo:
 * - Enfileirar envios outbound com retry/backoff
 * - Processar itens "due" com um worker simples (polling)
 *
 * Observação:
 * - Não quebra compatibilidade: é opcional e "best-effort".
 */

'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { OutboundQueueItem, ChannelConversation, ChannelMessage } = require('../db/models');
const { sendTextMessage } = require('./whatsappService');
const { sendInstagramMessage, sendInstagramMedia } = require('./instagramService');
const { updateOutboundMessageMeta, getTicket } = require('./queueService');
const { emitEvent } = require('./websocketService');

function dbAvailable() {
  return !!getSequelize();
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function computeBackoffSeconds(attempts) {
  // backoff exponencial com jitter: 2^attempts * 2s (cap 5min)
  const base = Math.min(Math.pow(2, Math.max(0, attempts)) * 2, 300);
  const jitter = Math.random() * Math.min(5, base * 0.2);
  return Math.max(2, Math.round(base + jitter));
}

async function enqueueOutbound({ tenantId, channelType, channelAccountId = null, conversationId = null, message }) {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('tenantId é obrigatório para enfileirar outbound');
  }
  if (!channelType || typeof channelType !== 'string') {
    throw new Error('channelType é obrigatório para enfileirar outbound');
  }
  if (!message || typeof message !== 'object') {
    throw new Error('message é obrigatório para enfileirar outbound');
  }

  if (!dbAvailable()) {
    // Sem DB, tenta enviar imediatamente (best-effort)
    logger.warn('[OutboundQueue] DB indisponível. Tentando envio direto (sem retry).', { tenantId, channelType });
    await deliverOutbound({ tenantId, channelType, message });
    return { queued: false };
  }

  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const now = new Date();

  const item = await Model.create({
    id: newId('outq'),
    tenant_key: tenantId,
    channel_type: channelType,
    channel_account_id: channelAccountId,
    conversation_id: conversationId,
    message,
    status: 'pending',
    attempts: 0,
    next_attempt_at: now,
    last_error: null,
    external_message_id: null,
    created_at: now,
    updated_at: now,
  });

  return { queued: true, itemId: item.id };
}

async function deliverOutbound({ tenantId, channelType, message }) {
  // messageNormalized esperado: { to, type, body }
  if (channelType === 'whatsapp') {
    const to = message.to;
    const kind = message.type || 'text';
    if (kind !== 'text') {
      throw new Error(`Outbound WhatsApp: type "${kind}" ainda não suportado`);
    }
    const text = message.body?.text || message.body?.body || message.text;
    if (!to || !text) throw new Error('Outbound WhatsApp requer {to, body.text}');
    const result = await sendTextMessage(to, text);
    const externalMessageId = result?.messages?.[0]?.id || null;
    await persistOutboundMessage({
      tenantId,
      channelType,
      to,
      type: 'text',
      body: { text },
      externalMessageId,
      status: 'sent',
    }).catch((err) => {
      logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: err.message });
    });
    return { success: true, externalMessageId };
  }

  if (channelType === 'instagram') {
    const to = message.to;
    const kind = message.type || 'text';
    if (!to) throw new Error('Outbound Instagram requer {to}');

    if (kind === 'text') {
      const text = message.body?.text || message.body?.body || message.text;
      if (!text) throw new Error('Outbound Instagram requer body.text');
      const result = await sendInstagramMessage(to, text);
      if (!result?.success) throw new Error(result?.error || 'Falha ao enviar Instagram');
      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: 'text',
        body: { text },
        externalMessageId: result.messageId || null,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: err.message });
      });
      return { success: true, externalMessageId: result.messageId || null };
    }

    if (kind === 'image' || kind === 'video') {
      const mediaUrl = message.body?.url;
      if (!mediaUrl) throw new Error('Outbound Instagram mídia requer body.url');
      const result = await sendInstagramMedia(to, mediaUrl, kind);
      if (!result?.success) throw new Error(result?.error || 'Falha ao enviar mídia Instagram');
      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: kind,
        body: { url: mediaUrl },
        externalMessageId: result.messageId || null,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: err.message });
      });
      return { success: true, externalMessageId: result.messageId || null };
    }

    throw new Error(`Outbound Instagram: type "${kind}" ainda não suportado`);
  }

  throw new Error(`channelType "${channelType}" não suportado em outbound`);
}

async function persistOutboundMessage({ tenantId, channelType, to, type, body, externalMessageId, status }) {
  if (!dbAvailable()) return;
  if (!tenantId || !channelType || !to) return;

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;

  const externalId = String(to).replace(/^\+/, '');
  const now = new Date();

  let conversation = await ConversationModel.findOne({
    where: { tenant_key: tenantId, channel_type: channelType, external_id: externalId },
  });

  if (conversation) {
    await conversation.update({ last_message_at: now, updated_at: now });
  } else {
    conversation = await ConversationModel.create({
      id: newId('conv'),
      tenant_key: tenantId,
      channel_type: channelType,
      external_id: externalId,
      contact_id: externalId,
      status: 'bot',
      current_ticket_id: null,
      last_message_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  // Idempotência por external_message_id (quando existir)
  if (externalMessageId) {
    const existing = await MessageModel.findOne({
      where: { tenant_key: tenantId, external_message_id: String(externalMessageId) },
    });
    if (existing) return;
  }

  await MessageModel.create({
    id: newId('msg'),
    tenant_key: tenantId,
    conversation_id: conversation.id,
    direction: 'out',
    type: type || 'text',
    body: body || {},
    external_message_id: externalMessageId ? String(externalMessageId) : null,
    status: status || 'sent',
    created_at: now,
    updated_at: now,
  });
}

async function processDue({ limit = 25 } = {}) {
  if (!dbAvailable()) return { processed: 0, sent: 0, failed: 0, skipped: 0 };

  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const sequelize = Model.sequelize;
  const Op = sequelize.constructor.Op;
  const now = new Date();

  const rows = await Model.findAll({
    where: {
      status: ['pending', 'failed'],
      next_attempt_at: { [Op.lte]: now },
    },
    order: [['next_attempt_at', 'ASC']],
    limit,
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      // marca como sending
      await row.update({ status: 'sending', updated_at: new Date() });

      const result = await deliverOutbound({
        tenantId: row.tenant_key,
        channelType: row.channel_type,
        message: row.message || {},
      });

      sent++;
      await row.update({
        status: 'sent',
        external_message_id: result.externalMessageId || row.external_message_id || null,
        last_error: null,
        updated_at: new Date(),
      });

      // Best-effort: sincroniza status "sent" no histórico do ticket (UI atual)
      try {
        const meta = row.message?.meta || {};
        const ticketId = meta.ticketId ? String(meta.ticketId) : null;
        const clientMessageId = meta.clientMessageId ? String(meta.clientMessageId) : null;
        const externalMessageId = result.externalMessageId ? String(result.externalMessageId) : null;
        if (ticketId) {
          const updatedTicket = updateOutboundMessageMeta(ticketId, { clientMessageId, externalMessageId, deliveryStatus: 'sent' });
          if (updatedTicket) {
            emitEvent('ticket.updated', {
              ticketId: updatedTicket.id,
              ticket: updatedTicket,
              change: { type: 'message_status', externalMessageId, status: 'sent' },
            }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
          }
        }
      } catch (_) {}
    } catch (err) {
      failed++;
      const attempts = (row.attempts || 0) + 1;
      const backoffSeconds = computeBackoffSeconds(attempts);
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
      await row.update({
        status: 'failed',
        attempts,
        next_attempt_at: nextAttemptAt,
        last_error: err.message,
        updated_at: new Date(),
      });

      // Best-effort: marca falha no histórico do ticket quando houver correlação
      try {
        const meta = row.message?.meta || {};
        const ticketId = meta.ticketId ? String(meta.ticketId) : null;
        const clientMessageId = meta.clientMessageId ? String(meta.clientMessageId) : null;
        if (ticketId) {
          const updatedTicket = updateOutboundMessageMeta(ticketId, { clientMessageId, deliveryStatus: 'failed' });
          if (updatedTicket) {
            emitEvent('ticket.updated', {
              ticketId: updatedTicket.id,
              ticket: updatedTicket,
              change: { type: 'message_status', status: 'failed', error: err.message },
            }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
          }
        }
      } catch (_) {}

      logger.warn('[OutboundQueue] Falha ao enviar item, agendando retry', {
        id: row.id,
        tenantId: row.tenant_key,
        channelType: row.channel_type,
        attempts,
        nextAttemptAt: nextAttemptAt.toISOString(),
        error: err.message,
      });
    }
  }

  return { processed: rows.length, sent, failed, skipped };
}

let workerTimer = null;

function startWorker({ intervalMs = 1500, batchSize = 25 } = {}) {
  if (workerTimer) return;
  if (!dbAvailable()) {
    logger.warn('[OutboundQueue] Worker não iniciado: DB indisponível');
    return;
  }

  workerTimer = setInterval(() => {
    processDue({ limit: batchSize }).catch((err) => {
      logger.error('[OutboundQueue] Erro no worker', { error: err.message });
    });
  }, intervalMs);

  // Não bloquear shutdown
  if (workerTimer.unref) workerTimer.unref();
  logger.info('[OutboundQueue] Worker iniciado', { intervalMs, batchSize });
}

function stopWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
  logger.info('[OutboundQueue] Worker parado');
}

module.exports = {
  enqueueOutbound,
  processDue,
  deliverOutbound,
  startWorker,
  stopWorker,
  // exporta para testes
  _computeBackoffSeconds: computeBackoffSeconds,
};

