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
const os = require('os');
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { OutboundQueueItem, ChannelConversation, ChannelMessage, OutboundAttempt } = require('../db/models');
const { TicketEvent } = require('../db/models');
const { getProviderCapabilities } = require('./outboundProviderCapabilities');
const whatsappService = require('./whatsappService');
const { sendTextMessage, sendMediaMessage } = whatsappService;
const { sendInstagramMessage, sendInstagramMedia } = require('./instagramService');
const { sendMessengerMessage } = require('./messengerService');
const { sendTextViaConnection, sendMediaViaConnection } = require('./whatsappQrBridgeService');
const { getTicketMediaById } = require('./ticketMediaService');
const { updateOutboundMessageMeta, getTicket } = require('./queueService');
const { emitEvent } = require('./websocketService');
const { logAction } = require('./auditService');
const config = require('../utils/config');

function dbAvailable() {
  return !!getSequelize();
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrimLower(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim().toLowerCase(); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  try {
    const message = err && typeof err === 'object' ? err.message : null;
    return safeToString(message) || safeToString(err, fallback);
  } catch (_) {
    return safeToString(err, fallback);
  }
}

function resolveMediaKind(kind, mimeType) {
  const normalized = safeTrimLower(kind);
  if (normalized === 'image' || normalized === 'video' || normalized === 'audio' || normalized === 'document') {
    return normalized;
  }
  if (normalized === 'media') {
    const mime = safeTrimLower(mimeType);
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }
  return '';
}

function safeGet(obj, path, fallback = null) {
  if (!obj || typeof obj !== 'object') return fallback;
  try {
    const parts = path.split('.');
    let v = obj;
    for (const part of parts) {
      v = v?.[part];
      if (v === undefined) return fallback;
    }
    return v ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function allowDirectSendWithoutDb() {
  // HARDENING: envio direto sem DB é perigoso (perde auditoria/retry).
  // Em produção, só é permitido via flag explícita.
  return safeTrimLower(process.env.ALLOW_DIRECT_SEND_WITHOUT_DB) === 'true';
}

function isProduction() {
  return safeTrimLower(process.env.NODE_ENV) === 'production';
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

// Mensagens que atingem este limite de tentativas são abandonadas definitivamente.
const MAX_ATTEMPTS = 50;

function getProcessingBy() {
  return `${os.hostname()}:${process.pid}`;
}

function getProcessingTimeoutMs() {
  const raw = process.env.OUTBOUND_PROCESSING_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 1000) return n;
  return 2 * 60 * 1000; // 2 min (default)
}

// ---------------------------------------------------------------------------
// Delivery ambiguity: ledger de tentativas + recovery consciente de capability
// ---------------------------------------------------------------------------

// Handlers de lookup de entrega por canal (nenhum provider real suporta hoje —
// registro injetável para testes e providers futuros com lookup real).
const deliveryLookupHandlers = new Map();

function registerDeliveryLookupHandler(channelType, fn) {
  if (!channelType || typeof fn !== 'function') {
    deliveryLookupHandlers.delete(channelType);
    return;
  }
  deliveryLookupHandlers.set(channelType, fn);
}

function deriveIdempotencyKey(row, clientMessageId) {
  const key = clientMessageId || safeToString(safeGet(row, 'client_message_id', null) || safeGet(row, 'message.meta.clientMessageId', null) || '') || null;
  if (!key) return null;
  return `${row.tenant_key}:${key}`;
}

function getAttemptModel() {
  try {
    const Model = typeof OutboundAttempt === 'function' ? OutboundAttempt() : OutboundAttempt;
    if (Model && typeof Model.create === 'function') return Model;
  } catch (_) {}
  return null;
}

/**
 * Persiste attempt ANTES de chamar o provider (ordem de escrita segura). Se o
 * ledger falhar, o provider NÃO é chamado — fail-safe: sem evidência de
 * tentativa, não há dispatch.
 */
async function createDispatchAttempt({ row, clientMessageId, idempotencyKey }) {
  const AttemptModel = getAttemptModel();
  if (!AttemptModel) return null;
  const now = new Date();
  return AttemptModel.create({
    id: newId('oatt'),
    tenant_key: row.tenant_key,
    queue_item_id: row.id,
    client_message_id: clientMessageId || null,
    channel_type: row.channel_type,
    provider: row.channel_type,
    status: 'started',
    result: null,
    external_message_id: null,
    idempotency_key: idempotencyKey,
    error_class: null,
    started_at: now,
    completed_at: now,
    created_at: now,
    updated_at: now,
  });
}

/**
 * ACK local atômico: attempt 'completed' + queue 'sent' na mesma transação.
 * Se o processo cair entre o provider aceitar e esta transação, o queue item
 * permanece 'sending' stale e a attempt 'started' órfã — a recovery trata como
 * delivery ambíguo (nunca retry cego).
 */
async function finalizeAttemptAndQueueSent({ row, attempt, result }) {
  const now = new Date();
  const externalMessageId = result && result.externalMessageId ? safeToString(result.externalMessageId) : (row.external_message_id || null);
  const apply = async (t) => {
    const opts = t ? { transaction: t } : undefined;
    if (attempt && typeof attempt.update === 'function') {
      await attempt.update({
        status: 'completed',
        result: 'sent',
        external_message_id: externalMessageId,
        completed_at: now,
        updated_at: now,
      }, opts);
    }
    await row.update({
      status: 'sent',
      external_message_id: externalMessageId,
      last_error: null,
      processing_at: null,
      processing_by: null,
      updated_at: now,
    }, opts);
  };
  const sequelize = row.sequelize || (row.constructor && row.constructor.sequelize) || null;
  if (sequelize && typeof sequelize.transaction === 'function') {
    await sequelize.transaction((t) => apply(t));
  } else {
    await apply(null);
  }
}

async function completeAttemptFailed(attempt, err) {
  if (!attempt || typeof attempt.update !== 'function') return;
  try {
    await attempt.update({
      status: 'completed',
      result: 'failed',
      error_class: computeReasonCode(err) || 'send_failed',
      completed_at: new Date(),
      updated_at: new Date(),
    });
  } catch (_) {}
}

/**
 * Marca attempts 'started' órfãs de um queue item como resultado desconhecido
 * (janela de crash: provider pode ter aceitado sem ACK local).
 */
async function markOrphanAttemptsUnknown(row) {
  const AttemptModel = getAttemptModel();
  if (!AttemptModel || typeof AttemptModel.update !== 'function') return;
  try {
    await AttemptModel.update(
      {
        status: 'completed',
        result: 'unknown',
        error_class: 'process_crash_window',
        completed_at: new Date(),
        updated_at: new Date(),
      },
      { where: { tenant_key: row.tenant_key, queue_item_id: row.id, status: 'started' } },
    );
  } catch (_) {}
}

/**
 * Recovery de item preso em 'sending' (crash/restart no worker) — decisão por
 * capability do provider, nunca requeue cego:
 * - lookup confirma entrega     → 'sent' (sem novo dispatch);
 * - lookup confirma não-entrega → requeue seguro;
 * - idempotency key + retry seguro → requeue (mesma chave, mesmo efeito lógico);
 * - caso contrário → 'delivery_unknown' (fora do claim automático) + exceção
 *   operacional; reconciliação posterior via callback/webhook ou revisão.
 */
async function recoverStaleSendingRow(row, now, { capabilityOverrides = null } = {}) {
  const caps = getProviderCapabilities(row.channel_type, capabilityOverrides);
  const clientMessageId = safeToString(row.client_message_id || safeGet(row, 'message.meta.clientMessageId', null) || '') || null;

  if (caps.supportsDeliveryLookup) {
    const lookup = deliveryLookupHandlers.get(row.channel_type);
    if (typeof lookup === 'function') {
      let outcome = null;
      try {
        outcome = await lookup(row);
      } catch (_) {
        outcome = null;
      }
      if (outcome && outcome.delivered === true) {
        await row.update({
          status: 'sent',
          external_message_id: outcome.externalMessageId ? safeToString(outcome.externalMessageId) : row.external_message_id,
          last_error: null,
          processing_at: null,
          processing_by: null,
          updated_at: now,
        });
        await markOrphanAttemptsUnknown(row);
        await syncConversationMessageStatus(row, clientMessageId, 'sent');
        return 'recovered_sent_via_lookup';
      }
      if (outcome && outcome.delivered === false) {
        await row.update({
          status: 'pending',
          processing_at: null,
          processing_by: null,
          next_attempt_at: now,
          updated_at: now,
        });
        await markOrphanAttemptsUnknown(row);
        return 'requeued_confirmed_not_delivered';
      }
      // inconclusivo → cai no fail-safe abaixo
    }
  }

  if (caps.supportsIdempotencyKey && caps.safeRetryAfterUnknown) {
    // Retry técnico com a MESMA provider idempotency key — mesmo efeito lógico.
    await row.update({
      status: 'pending',
      processing_at: null,
      processing_by: null,
      next_attempt_at: now,
      updated_at: now,
    });
    await markOrphanAttemptsUnknown(row);
    return 'requeued_idempotent_safe';
  }

  await row.update({
    status: 'delivery_unknown',
    reason_code: 'delivery_unknown',
    last_error: 'resultado externo da tentativa não pôde ser determinado com segurança',
    processing_at: null,
    processing_by: null,
    updated_at: now,
  });
  await markOrphanAttemptsUnknown(row);
  await syncConversationMessageStatus(row, clientMessageId, 'delivery_unknown');
  signalDeliveryUnknownException(row, clientMessageId);
  logger.warn('[OutboundQueue] Item em delivery_unknown — sem retry automático (provider sem reconciliation segura)', {
    id: row.id,
    tenantId: row.tenant_key,
    channelType: row.channel_type,
    clientMessageId,
  });
  return 'delivery_unknown';
}

/**
 * Management by exception: ambiguity vira exceção operacional — a UI mostra
 * "Entrega não confirmada" e o suporte/gestor decide. Nunca termos técnicos.
 */
function signalDeliveryUnknownException(row, clientMessageId) {
  try {
    const meta = safeGet(row, 'message.meta', {}) || {};
    const ticketId = safeGet(meta, 'ticketId', null) ? safeToString(safeGet(meta, 'ticketId', null)) : null;
    if (ticketId) {
      const updatedTicket = updateOutboundMessageMeta(ticketId, {
        clientMessageId,
        deliveryStatus: 'unknown',
      });
      if (updatedTicket) {
        emitEvent('ticket.updated', {
          ticketId: updatedTicket.id,
          ticket: updatedTicket,
          change: { type: 'message_status', status: 'delivery_unknown' },
        }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
      }
    }
    emitEvent('outbound.delivery_unknown', {
      queueItemId: row.id,
      channelType: row.channel_type,
      clientMessageId,
    }, { tenantId: row.tenant_key });
  } catch (_) {}
}

async function syncConversationMessageStatus(row, clientMessageId, status) {
  if (!clientMessageId || !dbAvailable()) return;
  try {
    const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;
    await MessageModel.update(
      { status, updated_at: new Date() },
      { where: { tenant_key: row.tenant_key, client_message_id: clientMessageId } },
    );
  } catch (_) {}
}

/**
 * Reconciliação a posteriori de um item em 'delivery_unknown' (webhook de
 * status, lookup manual ou revisão de suporte). Ausência de webhook NUNCA é
 * tratada como não-entrega — só evidência positiva resolve.
 */
async function resolveDeliveryUnknown({ tenantId, queueItemId, outcome, externalMessageId = null } = {}) {
  if (!dbAvailable()) return { ok: false, reason: 'db_unavailable' };
  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: queueItemId } });
  if (!row) return { ok: false, reason: 'queue_item_not_found' };
  if (row.status !== 'delivery_unknown') return { ok: false, reason: 'not_ambiguous', status: row.status };

  const now = new Date();
  if (outcome === 'delivered') {
    await row.update({
      status: 'sent',
      external_message_id: externalMessageId ? safeToString(externalMessageId) : row.external_message_id,
      last_error: null,
      updated_at: now,
    });
    await syncConversationMessageStatus(row, row.client_message_id, 'sent');
    return { ok: true, status: 'sent' };
  }
  if (outcome === 'not_delivered') {
    await row.update({
      status: 'pending',
      next_attempt_at: now,
      last_error: null,
      updated_at: now,
    });
    return { ok: true, status: 'pending' };
  }
  return { ok: false, reason: 'outcome_inconclusive' };
}

async function enqueueOutbound({ tenantId, channelType, channelAccountId = null, conversationId = null, message }, options = {}) {
  const transaction = options && options.transaction ? options.transaction : null;
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
    // HARDENING: em produção, não permitir "fallback perigoso" (envio direto sem persistência).
    // Exceção: ALLOW_DIRECT_SEND_WITHOUT_DB=true (uso emergencial e consciente).
    if (isProduction() && !allowDirectSendWithoutDb()) {
      const err = new Error('db_unavailable_no_direct_send');
      err.code = 'db_unavailable_no_direct_send';
      logger.error('[OutboundQueue] DB indisponível em produção; envio direto bloqueado', {
        tenantId,
        channelType,
        allowDirect: false,
      });
      throw err;
    }

    logger.warn('[OutboundQueue] DB indisponível; usando envio direto (sem retry/persistência).', {
      tenantId,
      channelType,
      env: process.env.NODE_ENV || 'unknown',
      allowDirect: allowDirectSendWithoutDb(),
    });
    await deliverOutbound({ tenantId, channelType, message });
    return { queued: false, direct: true };
  }

  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const now = new Date();

  // -------------------------------------------------------------------
  // Idempotência (v1):
  // - Se o caller fornecer um clientMessageId em message.meta, evitamos
  //   duplicar itens na fila quando houver retries HTTP/WS.
  // - Se o caller fornecer externalMessageId (raro no enqueue), também deduplica.
  // -------------------------------------------------------------------
  let clientMessageId = null;
  try {
    const meta = message && typeof message === 'object' ? (safeGet(message, 'meta', {}) || {}) : {};
    const rawClientMessageId = safeGet(meta, 'clientMessageId', null);
    const rawExternalMessageId = safeGet(message, 'externalMessageId', null);
    clientMessageId = rawClientMessageId ? safeToString(rawClientMessageId) : null;
    const externalMessageId = rawExternalMessageId ? safeToString(rawExternalMessageId) : null;

    if (clientMessageId) {
      const sequelize = Model.sequelize;
      const [rows] = await sequelize.query(
        `SELECT id
         FROM outbound_queue
         WHERE tenant_key = :tenantKey
           AND (message->'meta'->>'clientMessageId') = :clientMessageId
         LIMIT 1`,
        {
          replacements: {
            tenantKey: tenantId,
            clientMessageId,
          },
          ...(transaction ? { transaction } : {}),
        },
      );
      if (Array.isArray(rows) && rows.length > 0 && rows[0] && rows[0].id) {
        return { queued: false, idempotent: true, itemId: safeToString(rows[0].id) };
      }
    }

    if (externalMessageId) {
      const existing = await Model.findOne({
        where: {
          tenant_key: tenantId,
          external_message_id: externalMessageId,
        },
        ...(transaction ? { transaction } : {}),
      });
      if (existing) {
        return { queued: false, idempotent: true, itemId: existing.id };
      }
    }
  } catch (_) {
    // best-effort: não bloquear enfileiramento por falha de dedupe
  }

  let item;
  try {
    const createData = {
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
      client_message_id: clientMessageId || null,
      created_at: now,
      updated_at: now,
    };
    item = transaction
      ? await Model.create(createData, { transaction })
      : await Model.create(createData);
  } catch (err) {
    // Dentro de uma transação fornecida pelo caller (transactional outbox), um
    // erro de INSERT aborta a transação inteira no Postgres — não há como
    // re-ler dentro dela. Relança imediatamente; o caller faz rollback e o
    // re-read idempotente fora da transação.
    if (transaction) {
      throw err;
    }
    // Race-safe: enqueue concorrente com o mesmo (tenant, clientMessageId)
    // venceu a corrida — o UNIQUE parcial do banco rejeitou o INSERT.
    const pgCode = safeGet(err, 'original.code', null) ? safeToString(safeGet(err, 'original.code', null)) : null;
    const msg = safeToString(safeGet(err, 'message', ''));
    const isUnique = err?.name === 'SequelizeUniqueConstraintError' || pgCode === '23505' || msg.includes('duplicate key');
    if (isUnique && clientMessageId) {
      try {
        const existing = await Model.findOne({
          where: { tenant_key: tenantId, client_message_id: clientMessageId },
        });
        if (existing) {
          return { queued: false, idempotent: true, itemId: safeToString(existing.id) };
        }
      } catch (_) {
        // re-lança o erro original abaixo
      }
    }
    throw err;
  }

  return { queued: true, itemId: item.id };
}

/**
 * Repair idempotente (transactional outbox): garante que existe exatamente um
 * item lógico na outbound_queue para (tenant, clientMessageId). Usado quando a
 * ChannelMessage já existe mas o queue item está ausente (estado parcial
 * legado anterior à transação atômica). Race-safe: o INSERT usa
 * ON CONFLICT DO NOTHING apoiado no UNIQUE parcial — duas repairs concorrentes
 * produzem exatamente uma row.
 */
async function ensureOutboundQueued({ tenantId, channelType, channelAccountId = null, conversationId = null, message }) {
  if (!dbAvailable()) return { queued: false, repaired: false, reason: 'db_unavailable' };
  const meta = message && typeof message === 'object' ? (safeGet(message, 'meta', {}) || {}) : {};
  const clientMessageId = safeGet(meta, 'clientMessageId', null) ? safeToString(safeGet(meta, 'clientMessageId', null)) : null;
  if (!clientMessageId) return { queued: false, repaired: false, reason: 'client_message_id_missing' };

  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const existing = await Model.findOne({
    where: { tenant_key: tenantId, client_message_id: clientMessageId },
  });
  if (existing) {
    return { queued: false, repaired: false, idempotent: true, itemId: safeToString(existing.id) };
  }

  const sequelize = Model.sequelize;
  const now = new Date();
  const itemId = newId('outq');
  await sequelize.query(
    `INSERT INTO outbound_queue
       (id, tenant_key, channel_type, channel_account_id, conversation_id, message,
        status, attempts, next_attempt_at, last_error, external_message_id, client_message_id,
        created_at, updated_at)
     VALUES
       (:id, :tenantKey, :channelType, :channelAccountId, :conversationId, :message,
        'pending', 0, :now, NULL, NULL, :clientMessageId,
        :now, :now)
     ON CONFLICT (tenant_key, client_message_id) WHERE client_message_id IS NOT NULL
     DO NOTHING`,
    {
      replacements: {
        id: itemId,
        tenantKey: tenantId,
        channelType,
        channelAccountId,
        conversationId,
        message: JSON.stringify(message || {}),
        clientMessageId,
        now,
      },
    },
  );

  const finalRow = await Model.findOne({
    where: { tenant_key: tenantId, client_message_id: clientMessageId },
  });
  if (!finalRow) {
    // Índice parcial ainda não existia (schema legado) e outra corrida venceu sem
    // deixar row visível — sinaliza para o caller tratar como erro explícito.
    const err = new Error('outbound_repair_failed');
    err.code = 'outbound_repair_failed';
    throw err;
  }
  logger.warn('[OutboundQueue] Repair idempotente: queue item reconstruído para mensagem já persistida', {
    tenantId,
    channelType,
    clientMessageId,
    itemId: safeToString(finalRow.id),
  });
  return { queued: true, repaired: true, itemId: safeToString(finalRow.id) };
}

async function deliverOutbound({ tenantId, channelType, message }) {
  // messageNormalized esperado: { to, type, body }
  const meta = message && typeof message === 'object'
    ? (message.meta || (message.body && message.body.meta) || null)
    : null;
  if (channelType === 'whatsapp') {
    const to = message.to;
    const kind = message.type || 'text';
    if (kind === 'text') {
      const text = message.body?.text || message.body?.body || message.text;
      if (!to || !text) throw new Error('Outbound WhatsApp requer {to, body.text}');
      let externalMessageId = null;

      const hasCloudCreds = typeof whatsappService.areCredentialsValid === 'function'
        ? whatsappService.areCredentialsValid()
        : true;

      if (hasCloudCreds) {
        const result = await sendTextMessage(to, text);
        externalMessageId = result?.messages?.[0]?.id || null;
      } else {
        const qrSend = await sendTextViaConnection({
          tenantId,
          to,
          text,
          connectionId: message?.meta?.connectionId || message?.meta?.channelAccountId || null,
        });
        if (!qrSend?.ok) {
          const qrErr = new Error(safeToString(qrSend?.message || qrSend?.error || 'WhatsApp credentials não configuradas'));
          qrErr.code = safeToString(qrSend?.error || qrSend?.code || 'qr_send_failed', 'qr_send_failed');
          throw qrErr;
        }
        externalMessageId = qrSend.externalMessageId || null;
      }

      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: 'text',
        body: { text, ...(meta ? { meta } : {}) },
        externalMessageId,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });
      return { success: true, externalMessageId };
    }

    if (['image', 'video', 'audio', 'document', 'media'].includes(kind)) {
      const mediaId = safeToString(message.body?.mediaId || '').trim();
      const mimeType = safeToString(message.body?.mimeType || '').trim();
      const fileName = safeToString(message.body?.fileName || '').trim();
      const caption = safeToString(message.body?.caption || '').trim();
      const mediaUrl = safeToString(message.body?.url || message.body?.mediaUrl || '').trim();
      const resolvedKind = resolveMediaKind(kind, mimeType);
      if (!to || !resolvedKind) throw new Error('Outbound WhatsApp mídia requer {to, type válido}');

      let externalMessageId = null;
      const hasCloudCreds = typeof whatsappService.areCredentialsValid === 'function'
        ? whatsappService.areCredentialsValid()
        : true;

      if (hasCloudCreds) {
        let buffer = null;
        let effectiveMimeType = mimeType;
        let effectiveFileName = fileName;

        if (mediaId) {
          const mediaRecord = await getTicketMediaById(mediaId, null);
          if (!mediaRecord?.data) {
            throw new Error(`Mídia não encontrada para mediaId=${mediaId}`);
          }
          buffer = Buffer.isBuffer(mediaRecord.data) ? mediaRecord.data : Buffer.from(mediaRecord.data);
          if (!effectiveMimeType) effectiveMimeType = safeToString(mediaRecord.mimeType || 'application/octet-stream');
          if (!effectiveFileName) effectiveFileName = safeToString(mediaRecord.fileName || mediaId);
        }

        const result = await sendMediaMessage(to, {
          type: resolvedKind,
          mimeType: effectiveMimeType,
          fileName: effectiveFileName,
          caption,
          buffer,
          link: mediaUrl || undefined,
        });
        externalMessageId = result?.messages?.[0]?.id || null;
      } else {
        if (!mediaId) {
          throw new Error('Outbound WhatsApp QR mídia requer body.mediaId quando Cloud API não está configurada');
        }
        const qrSend = await sendMediaViaConnection({
          tenantId,
          to,
          mediaId,
          mimeType,
          fileName,
          caption,
          connectionId: message?.meta?.connectionId || message?.meta?.channelAccountId || null,
        });
        if (!qrSend?.ok) {
          const qrErr = new Error(safeToString(qrSend?.message || qrSend?.error || 'qr_send_failed'));
          qrErr.code = safeToString(qrSend?.error || qrSend?.code || 'qr_send_failed', 'qr_send_failed');
          throw qrErr;
        }
        externalMessageId = qrSend.externalMessageId || null;
      }

      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: resolvedKind,
        body: {
          ...(mediaId ? { mediaId } : {}),
          ...(mimeType ? { mimeType } : {}),
          ...(fileName ? { fileName } : {}),
          ...(caption ? { caption } : {}),
          ...(mediaUrl ? { url: mediaUrl } : {}),
          ...(meta ? { meta } : {}),
        },
        externalMessageId,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });

      return { success: true, externalMessageId };
    }

    if (kind === 'template') {
      const templateName = message.body?.templateName || message.body?.name || message.templateName;
      const languageCode = message.body?.languageCode || message.body?.language || message.languageCode || 'pt_BR';
      const parameters = Array.isArray(message.body?.parameters) ? message.body.parameters : (Array.isArray(message.parameters) ? message.parameters : []);
      if (!to || !templateName) throw new Error('Outbound WhatsApp template requer {to, body.templateName}');

      const phoneNumberId = config.get('whatsapp.phoneNumberId');
      const accessToken = config.get('whatsapp.accessToken');
      if (!phoneNumberId || !accessToken) throw new Error('Credenciais do WhatsApp não configuradas');
      if (!whatsappService.areCredentialsValid()) {
        throw new Error('WhatsApp credentials são inválidas ou são placeholders. Configure credenciais reais em config.json');
      }

      const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        to: safeToString(to).replace(/^\+/, ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode || 'pt_BR' },
        },
      };

      if (parameters && parameters.length > 0) {
        payload.template.components = [
          {
            type: 'body',
            parameters: parameters.map((param) => ({
              type: 'text',
              text: safeToString(param),
            })),
          },
        ];
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `WhatsApp API error: ${response.status}`);
      }

      const data = await response.json().catch(() => ({}));
      const externalMessageId = data?.messages?.[0]?.id || null;

      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: 'template',
        body: {
          templateName,
          languageCode: languageCode || 'pt_BR',
          parameters,
          ...(meta ? { meta } : {}),
        },
        externalMessageId,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });

      return { success: true, externalMessageId };
    }

    throw new Error(`Outbound WhatsApp: type "${kind}" ainda não suportado`);
  }

  if (channelType === 'whatsapp-qr') {
    const to = message.to;
    const kind = message.type || 'text';
    if (kind === 'text') {
      const text = message.body?.text || message.body?.body || message.text;
      if (!to || !text) throw new Error('Outbound WhatsApp QR requer {to, body.text}');

      const qrSend = await sendTextViaConnection({
        tenantId,
        to,
        text,
        connectionId: message?.meta?.connectionId || message?.meta?.channelAccountId || null,
      });
      if (!qrSend?.ok) {
        const qrErr = new Error(safeToString(qrSend?.message || qrSend?.error || 'qr_send_failed'));
        qrErr.code = safeToString(qrSend?.error || qrSend?.code || 'qr_send_failed', 'qr_send_failed');
        throw qrErr;
      }

      const externalMessageId = qrSend.externalMessageId || null;
      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: 'text',
        body: { text, ...(meta ? { meta } : {}) },
        externalMessageId,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });
      return { success: true, externalMessageId };
    }

    if (['image', 'video', 'audio', 'document'].includes(kind)) {
      const mediaId = message.body?.mediaId;
      if (!to || !mediaId) throw new Error('Outbound WhatsApp QR mídia requer {to, body.mediaId}');

      const mediaSend = await sendMediaViaConnection({
        tenantId,
        to,
        mediaId,
        mimeType: message.body?.mimeType || '',
        fileName: message.body?.fileName || '',
        caption: message.body?.caption || '',
        connectionId: message?.meta?.connectionId || message?.meta?.channelAccountId || null,
      });
      if (!mediaSend?.ok) {
        const qrErr = new Error(safeToString(mediaSend?.message || mediaSend?.error || 'qr_send_failed'));
        qrErr.code = safeToString(mediaSend?.error || 'qr_send_failed', 'qr_send_failed');
        throw qrErr;
      }

      const externalMessageId = mediaSend.externalMessageId || null;
      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: kind,
        body: {
          mediaId,
          mimeType: message.body?.mimeType || undefined,
          fileName: message.body?.fileName || undefined,
          caption: message.body?.caption || undefined,
          ...(meta ? { meta } : {}),
        },
        externalMessageId,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });
      return { success: true, externalMessageId };
    }

    throw new Error(`Outbound WhatsApp QR: type "${kind}" ainda não suportado`);
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
        body: { text, ...(meta ? { meta } : {}) },
        externalMessageId: result.messageId || null,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
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
        body: { url: mediaUrl, ...(meta ? { meta } : {}) },
        externalMessageId: result.messageId || null,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });
      return { success: true, externalMessageId: result.messageId || null };
    }

    throw new Error(`Outbound Instagram: type "${kind}" ainda não suportado`);
  }

  if (channelType === 'messenger') {
    const to = message.to;
    const kind = message.type || 'text';
    if (!to) throw new Error('Outbound Messenger requer {to}');

    if (kind === 'text') {
      const text = message.body?.text || message.body?.body || message.text;
      if (!text) throw new Error('Outbound Messenger requer body.text');
      const result = await sendMessengerMessage(to, text);
      if (!result?.success) throw new Error(result?.error || 'Falha ao enviar Messenger');
      await persistOutboundMessage({
        tenantId,
        channelType,
        to,
        type: 'text',
        body: { text, ...(meta ? { meta } : {}) },
        externalMessageId: result.messageId || null,
        status: 'sent',
      }).catch((err) => {
        logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
      });
      return { success: true, externalMessageId: result.messageId || null };
    }

    throw new Error(`Outbound Messenger: type "${kind}" ainda não suportado`);
  }

  if (channelType === 'email') {
    // MVP: fila/outbox com persistência + eventos; envio real pode ser plugado depois.
    const to = message.to;
    const kind = message.type || 'text';
    if (!to) throw new Error('Outbound Email requer {to}');
    if (kind !== 'text') throw new Error('Outbound Email só suporta type=text no MVP');

    const subject = message.body?.subject || message.subject || '(sem assunto)';
    const text = message.body?.text || message.body?.body || message.text || '';
    const html = message.body?.html || null;
    const externalMessageId = `email-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    await persistOutboundMessage({
      tenantId,
      channelType,
      to,
      type: 'text',
      body: { subject: safeToString(subject), text: safeToString(text), html: html ? safeToString(html) : null, ...(meta ? { meta } : {}) },
      externalMessageId,
      status: 'sent',
    }).catch((err) => {
      logger.warn('[OutboundQueue] Falha ao persistir outbound (best-effort)', { tenantId, channelType, error: safeErrorMessage(err) });
    });
    return { success: true, externalMessageId };
  }

  throw new Error(`channelType "${channelType}" não suportado em outbound`);
}

function computeReasonCode(err) {
  if (!err) return null;
  const code = safeGet(err, 'code', null) ? safeToString(safeGet(err, 'code', null)) : null;
  if (code) {
    if (code === 'qr_send_failed_after_recycle') return 'qr_send_failed_after_recycle';
    if (code === 'qr_client_reinitialize_failed') return 'qr_client_reinitialize_failed';
    return code;
  }
  const msg = safeTrimLower(safeGet(err, 'message', ''));
  if (msg.includes("reading 'getchat'")) return 'qr_send_getchat';
  if (msg.includes('ainda não suportado') || msg.includes('ainda nao suportado') || msg.includes('not supported')) return 'not_supported';
  if (msg.includes('outside_window_24h')) return 'outside_window_24h';
  if (msg.includes('outside the allowed window') || msg.includes('24 hour') || msg.includes('requires a template')) return 'outside_window_24h';
  if (msg.includes('credentials')) return 'credentials_invalid';
  if (msg.includes('timeout')) return 'timeout';
  return 'send_failed';
}

async function createTicketEventForOutboundBestEffort({ tenantId, ticketId, type, payload }) {
  if (!tenantId || !ticketId || !type) return;
  if (!dbAvailable()) return;
  try {
    const Model = typeof TicketEvent === 'function' ? TicketEvent() : TicketEvent;
    const now = new Date();
    await Model.create({
      id: newId('tev'),
      tenant_key: tenantId,
      ticket_id: ticketId,
      type,
      payload: payload && typeof payload === 'object' ? payload : {},
      created_by: 'system',
      created_at: now,
      updated_at: now,
    });
  } catch (_) {}
}

async function persistOutboundMessage({ tenantId, channelType, to, type, body, externalMessageId, status }) {
  if (!dbAvailable()) return;
  if (!tenantId || !channelType || !to) return;

  const ConversationModel = typeof ChannelConversation === 'function' ? ChannelConversation() : ChannelConversation;
  const MessageModel = typeof ChannelMessage === 'function' ? ChannelMessage() : ChannelMessage;

  const externalId = safeToString(to).replace(/^\+/, '');
  const now = new Date();
  const meta = body && typeof body === 'object' ? safeGet(body, 'meta', null) : null;
  const ticketId =
    safeGet(meta, 'ticketId', null) ||
    safeGet(meta, 'ticket_id', null) ||
    safeGet(body, 'ticketId', null) ||
    safeGet(body, 'ticket_id', null) ||
    null;

  let conversation = await ConversationModel.findOne({
    where: { tenant_key: tenantId, channel_type: channelType, external_id: externalId },
  });

  if (conversation) {
    await conversation.update({
      last_message_at: now,
      updated_at: now,
      ...(ticketId ? { current_ticket_id: safeToString(ticketId), status: 'human' } : {}),
    });
  } else {
    conversation = await ConversationModel.create({
      id: newId('conv'),
      tenant_key: tenantId,
      channel_type: channelType,
      external_id: externalId,
      contact_id: externalId,
      status: ticketId ? 'human' : 'bot',
      current_ticket_id: ticketId ? safeToString(ticketId) : null,
      last_message_at: now,
      created_at: now,
      updated_at: now,
    });
  }

  // Idempotência por external_message_id (quando existir)
  if (externalMessageId) {
    const existing = await MessageModel.findOne({
      where: { tenant_key: tenantId, channel_type: channelType, external_message_id: safeToString(externalMessageId) },
    });
    if (existing) return;
  }

  try {
    await MessageModel.create({
      id: newId('msg'),
      tenant_key: tenantId,
      conversation_id: conversation.id,
      channel_type: channelType,
      direction: 'out',
      type: type || 'text',
      body: body || {},
      external_message_id: externalMessageId ? safeToString(externalMessageId) : null,
      status: status || 'sent',
      created_at: now,
      updated_at: now,
    });
  } catch (err) {
    const msg = safeToString(safeGet(err, 'message', ''));
    const pgCode = safeGet(err, 'original.code', null) ? safeToString(safeGet(err, 'original.code', null)) : null;
    if (
      err?.name === 'SequelizeUniqueConstraintError' ||
      pgCode === '23505' ||
      msg.includes('channel_messages_tenant_channel_type_external_msg_id_uq') ||
      msg.includes('duplicate key')
    ) {
      logger.debug('[OutboundQueue] Duplicate message ignored', {
        tenantId,
        channelType,
        externalMessageId: externalMessageId ? safeToString(externalMessageId) : null,
      });
      return;
    }
    throw err;
  }
}

async function processDue({ limit = 25, capabilityOverrides = null } = {}) {
  if (!dbAvailable()) return { processed: 0, sent: 0, failed: 0, skipped: 0, deliveryUnknown: 0 };

  const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
  const sequelize = Model.sequelize;
  const Op = sequelize.constructor.Op;
  const now = new Date();

  // 1) Recovery de itens presos em "sending" (crash/restart) — consciente de
  // capability do provider. NUNCA requeue cego: sem prova de não-entrega e sem
  // idempotency key, o item vai para 'delivery_unknown' (fora do claim
  // automático) em vez de voltar para 'pending'.
  const processingTimeoutMs = getProcessingTimeoutMs();
  const staleBefore = new Date(Date.now() - processingTimeoutMs);
  let deliveryUnknown = 0;
  try {
    const staleRows = await Model.findAll({
      where: {
        status: 'sending',
        external_message_id: { [Op.is]: null },
        processing_at: { [Op.lte]: staleBefore },
      },
      limit: 50,
    });
    for (const staleRow of staleRows) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await recoverStaleSendingRow(staleRow, now, { capabilityOverrides });
      if (outcome === 'delivery_unknown') deliveryUnknown += 1;
    }
  } catch (_) {}

  // 2) Claim de lote com lock + skipLocked (cluster-safe).
  const processingBy = getProcessingBy();
  const claimedRows = await sequelize.transaction(async (t) => {
    const dueRows = await Model.findAll({
      where: {
        status: ['pending', 'failed'],
        next_attempt_at: { [Op.lte]: now },
        external_message_id: { [Op.is]: null },
        attempts: { [Op.lt]: MAX_ATTEMPTS },
      },
      order: [['next_attempt_at', 'ASC']],
      limit,
      transaction: t,
      lock: t.LOCK.UPDATE,
      skipLocked: true,
    });

    const claimAt = new Date();
    for (const r of dueRows) {
      // eslint-disable-next-line no-await-in-loop
      await r.update(
        { status: 'sending', processing_at: claimAt, processing_by: processingBy, updated_at: claimAt },
        { transaction: t }
      );
    }

    return dueRows;
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of claimedRows) {
    const rowClientMessageId = safeToString(row.client_message_id || safeGet(row, 'message.meta.clientMessageId', null) || '') || null;
    const idempotencyKey = deriveIdempotencyKey(row, rowClientMessageId);

    // Ordem de escrita segura: attempt 'started' ANTES de chamar o provider.
    // Se o ledger falhar, o provider não é chamado (fail-safe, sem dispatch).
    let attempt = null;
    try {
      attempt = await createDispatchAttempt({ row, clientMessageId: rowClientMessageId, idempotencyKey });
    } catch (attemptErr) {
      failed++;
      await row.update({
        status: 'failed',
        attempts: (row.attempts || 0) + 1,
        next_attempt_at: new Date(Date.now() + computeBackoffSeconds((row.attempts || 0) + 1) * 1000),
        last_error: 'attempt_ledger_unavailable',
        reason_code: 'attempt_ledger_unavailable',
        processing_at: null,
        processing_by: null,
        updated_at: new Date(),
      });
      logger.error('[OutboundQueue] Ledger de tentativas indisponível — dispatch não executado (fail-safe)', {
        id: row.id,
        tenantId: row.tenant_key,
        error: safeErrorMessage(attemptErr),
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    // Janela crítica separada: falha do PROVIDER (dispatch não confirmado) tem
    // handling de retry normal; falha do ACK LOCAL depois do provider aceitar
    // NÃO pode marcar 'failed' (isso agendaria retry cego e duplicaria o efeito
    // externo) — o item permanece 'sending' até a recovery por capability.
    let result;
    try {
      result = await deliverOutbound({
        tenantId: row.tenant_key,
        channelType: row.channel_type,
        message: row.message || {},
      });
    } catch (err) {
      failed++;
      await completeAttemptFailed(attempt, err);
      const reasonCode = computeReasonCode(err);
      const rawAttempts = (row.attempts || 0) + 1;
      // Falhas permanentes: tipo não suportado ou excesso de tentativas (abandona sem novo retry)
      const isPermanentFailure = reasonCode === 'not_supported' || rawAttempts >= MAX_ATTEMPTS;
      const attempts = isPermanentFailure ? MAX_ATTEMPTS : rawAttempts;
      const backoffSeconds = isPermanentFailure ? 86400 : computeBackoffSeconds(attempts);
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

      // Fallback 24h (WhatsApp): se texto falhar por janela, tenta enfileirar template (best-effort)
      try {
        const isWhatsApp = row.channel_type === 'whatsapp';
        const msgType = row.message?.type || row.message?.messageType || null;
        const hasTemplateFallback = reasonCode === 'outside_window_24h' && isWhatsApp && (!msgType || msgType === 'text');
        if (hasTemplateFallback) {
          const fallbackTemplateName = process.env.WHATSAPP_FALLBACK_TEMPLATE_NAME || config.get('whatsapp.fallbackTemplateName', 'hello_world');
          const to = row.message?.to;
          const meta = row.message?.meta || {};
          if (to && fallbackTemplateName) {
            // Enfileira template como novo item (não reusa o mesmo row para não conflitar com status de envio)
            // eslint-disable-next-line no-await-in-loop
            await enqueueOutbound({
              tenantId: row.tenant_key,
              channelType: 'whatsapp',
              channelAccountId: row.channel_account_id || null,
              conversationId: row.conversation_id || null,
              message: {
                to,
                type: 'template',
                body: {
                  templateName: safeToString(fallbackTemplateName),
                  languageCode: 'pt_BR',
                  parameters: [],
                },
                meta: { ...meta, fallbackFromOutboundId: row.id, fallbackReason: reasonCode },
              },
            }).catch(() => null);

            // Auditoria + TicketEvent
            const ticketId = safeGet(meta, 'ticketId', null) ? safeToString(safeGet(meta, 'ticketId', null)) : null;
            if (ticketId) {
              logAction({
                agentId: 'system',
                username: 'system',
                tenantId: row.tenant_key,
                action: 'whatsapp_outside_window_fallback_template',
                resource: 'ticket',
                resourceId: ticketId,
                details: { outboundId: row.id, to, templateName: fallbackTemplateName, reasonCode },
                ipAddress: 'system',
                userAgent: 'system',
              });
              await createTicketEventForOutboundBestEffort({
                tenantId: row.tenant_key,
                ticketId,
                type: 'whatsapp.fallback_template',
                payload: { outboundId: row.id, to, templateName: fallbackTemplateName, reasonCode },
              });
            }
          }
        }
      } catch (_) {}

      await row.update({
        status: 'failed',
        attempts,
        next_attempt_at: nextAttemptAt,
        last_error: safeErrorMessage(err, 'send_failed'),
        reason_code: reasonCode,
        processing_at: null,
        processing_by: null,
        updated_at: new Date(),
      });
      await syncConversationMessageStatus(row, rowClientMessageId, 'failed');

      // Best-effort: marca falha no histórico do ticket quando houver correlação
      try {
        const meta = safeGet(row, 'message.meta', {}) || {};
        const rawTicketId = safeGet(meta, 'ticketId', null);
        const rawClientMessageId = safeGet(meta, 'clientMessageId', null);
        const ticketId = rawTicketId ? safeToString(rawTicketId) : null;
        const clientMessageId = rawClientMessageId ? safeToString(rawClientMessageId) : null;
        if (ticketId) {
          const updatedTicket = updateOutboundMessageMeta(ticketId, {
            clientMessageId,
            deliveryStatus: 'failed',
            reasonCode,
            lastError: safeErrorMessage(err, 'send_failed'),
            failedAt: new Date().toISOString(),
            attempts,
          });
          if (updatedTicket) {
            emitEvent('ticket.updated', {
              ticketId: updatedTicket.id,
              ticket: updatedTicket,
              change: { type: 'message_status', status: 'failed', error: safeErrorMessage(err) },
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
        error: safeErrorMessage(err),
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    // Provider retornou sucesso. ACK local atômico: attempt 'completed' + queue
    // 'sent' na mesma transação. Se esta escrita falhar/cair (janela de
    // ambiguidade), NÃO marcar 'failed' — retry cego duplicaria o efeito
    // externo. O item permanece 'sending' até a recovery por capability.
    try {
      await finalizeAttemptAndQueueSent({ row, attempt, result });
    } catch (ackErr) {
      skipped++;
      logger.error('[OutboundQueue] Provider aceitou, mas o ACK local falhou — item fica sending até recovery por capability (sem retry cego)', {
        id: row.id,
        tenantId: row.tenant_key,
        channelType: row.channel_type,
        clientMessageId: rowClientMessageId,
        error: safeErrorMessage(ackErr),
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    sent++;
    await syncConversationMessageStatus(row, rowClientMessageId, 'sent');

    // Best-effort: sincroniza status "sent" no histórico do ticket (UI atual)
    try {
      const meta = safeGet(row, 'message.meta', {}) || {};
      const rawTicketId = safeGet(meta, 'ticketId', null);
      const rawClientMessageId = safeGet(meta, 'clientMessageId', null);
      const rawExternalMessageId = safeGet(result, 'externalMessageId', null);
      const ticketId = rawTicketId ? safeToString(rawTicketId) : null;
      const clientMessageId = rawClientMessageId ? safeToString(rawClientMessageId) : null;
      const externalMessageId = rawExternalMessageId ? safeToString(rawExternalMessageId) : null;
      if (ticketId) {
        const updatedTicket = updateOutboundMessageMeta(ticketId, {
          clientMessageId,
          externalMessageId,
          deliveryStatus: 'sent',
        });
        if (updatedTicket) {
          emitEvent('ticket.updated', {
            ticketId: updatedTicket.id,
            ticket: updatedTicket,
            change: { type: 'message_status', externalMessageId, status: 'sent' },
          }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
        }
      }
    } catch (_) {}
  }

  return { processed: claimedRows.length, sent, failed, skipped, deliveryUnknown };
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
      logger.error('[OutboundQueue] Erro no worker', { error: safeErrorMessage(err) });
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
  ensureOutboundQueued,
  processDue,
  deliverOutbound,
  resolveDeliveryUnknown,
  registerDeliveryLookupHandler,
  startWorker,
  stopWorker,
  // exporta para testes
  _computeBackoffSeconds: computeBackoffSeconds,
  _deriveIdempotencyKey: deriveIdempotencyKey,
  _recoverStaleSendingRow: recoverStaleSendingRow,
};

