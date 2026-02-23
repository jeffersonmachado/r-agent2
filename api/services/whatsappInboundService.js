// whatsappInboundService.js - Pipeline unificado de inbound WhatsApp (Cloud webhook e QR)
'use strict';

const logger = require('../utils/logger');
const channelGatewayService = require('./channelGatewayService');
const { resolveOrCreateTicketFromIncomingMessage, appendTicketMessage } = require('./conversationTicketLinkService');
const { autoAssignTicket } = require('./routingService');
const { emitEvent } = require('./websocketService');
const { processWhatsAppMessage } = require('./messageProcessor');
const { getTicket } = require('./queueService');
const whatsappQrService = require('./whatsappQrService');
const { checkFeature } = require('./planLimitsService');
const { sendToUser, trimPreview } = require('./push');
const {
  shouldNotifyTicketMessage,
  selectRecipientUserIdsForTicket,
  consumeMessageDedup,
} = require('./push/notificationRules');

function jsonSafe(obj) {
  try { return JSON.stringify(obj); } catch (_) { return '[unserializable]'; }
}

function isHumanMode(ticket) {
  const mode = (ticket?.mode || 'bot');
  return mode === 'human' || mode === 'paused';
}

function resolveInboundConnectionIdentifiers(payload = {}) {
  const connectionId = payload?.__qr?.connectionId ? String(payload.__qr.connectionId).trim() : null;
  const phoneNumberIdRaw = payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null;
  const phoneNumberId = phoneNumberIdRaw != null ? String(phoneNumberIdRaw).trim() : null;
  return { connectionId, phoneNumberId };
}

function buildInboundSessionId(payload = {}, message = {}, fallbackConversationId = null) {
  const from = message?.from ? String(message.from).trim() : null;
  const { connectionId, phoneNumberId } = resolveInboundConnectionIdentifiers(payload);

  if (connectionId && from) return `whatsapp_qr_${connectionId}_${from}`;
  if (phoneNumberId && from) return `whatsapp_cloud_${phoneNumberId}_${from}`;

  const channelSuffix = phoneNumberId || connectionId || String(fallbackConversationId || 'unknown');
  const fromSuffix = from || 'unknown';
  return `whatsapp_${channelSuffix}_${fromSuffix}`;
}

function buildPushBody({ from, text }) {
  const sender = String(from || 'Contato');
  return `${sender}: ${trimPreview(text || '', 100)}`;
}

// Normaliza o identificador da conversa para evitar duplicação de ticket em cenários Baileys/MD
// onde o WhatsApp alterna entre JID @lid e @s.whatsapp.net.
function normalizeExternalConversationId({ normalized, payload, message }) {
  const direct = normalized?.externalConversationId;
  if (direct) return String(direct);

  // Preferir JID alternativo quando o raw vier como @lid
  const qr = payload?.__qr || null;
  const jidRaw = qr?.remoteJidRaw || qr?.remoteJid || null;
  const jidAlt = qr?.remoteJidAlt || null;

  let jid = jidRaw;
  if (typeof jidRaw === 'string' && jidRaw.endsWith('@lid') && typeof jidAlt === 'string' && jidAlt.endsWith('@s.whatsapp.net')) {
    jid = jidAlt;
  }

  // Cloud já entrega 'from' numérico; QR runner entrega 'from' numérico também.
  const from = message?.from ? String(message.from) : null;
  if (from) return from;

  if (typeof jid === 'string' && jid.includes('@')) return jid.split('@')[0];
  if (jid) return String(jid);
  return null;
}

/**
 * Processa inbound WhatsApp de forma consistente:
 * - Persiste no ChannelGateway (idempotente)
 * - Resolve/cria ticket
 * - Registra mensagem no ledger do ticket
 * - Se ticket em modo humano: emite evento e não roda bot
 * - Caso contrário: tenta rodar engine (best-effort)
 */
async function handleWhatsAppInbound({
  source = 'unknown',
  tenantId,
  payload,
  normalized,
  traceId = null,
  deps = null,
}) {
  const message = payload?.message || null;
  const value = payload?.value || null;

  const externalMessageId = normalized?.externalMessageId || (message?.id ? String(message.id) : null);
  const externalConversationId = normalizeExternalConversationId({ normalized, payload, message });

  
  // 0) Log obrigatório (pré-tenant): ajuda a debugar inbound que é descartado antes de virar ticket
  try {
    const phoneNumberId = payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null;
    const from = payload?.message?.from || payload?.value?.messages?.[0]?.from || null;
    const msgType = payload?.message?.type || payload?.value?.messages?.[0]?.type || null;
    logger.warn('WA_IN_PRE', 'Inbound recebido (antes de resolver tenant)', {
      traceId: traceId || 'n/a',
      source,
      tenantId: tenantId || null,
      externalMessageId,
      externalConversationId,
      phone_number_id: phoneNumberId,
      from,
      msgType,
    });
  } catch (_) { /* não quebra pipeline */ }

// 1) Persistência + idempotência
  const ingest = await channelGatewayService.ingestIncoming('whatsapp', payload, { tenantId }).catch((e) => {
    logger.error(`[WA_PIPE_GATEWAY_ERR] traceId=${traceId || 'n/a'} ${jsonSafe({ source, tenantId, externalMessageId, errMessage: e?.message || String(e), errStack: e?.stack || null })}`);
    return null;
  });

  const effectiveTenantId = tenantId || ingest?.tenantId || null;
  if (!effectiveTenantId) {
    logger.error('WA_PIPE_SKIP', 'tenant-not-resolved (discard seguro)', { traceId: traceId || 'n/a', source, externalMessageId, externalConversationId, phone_number_id: payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null, reason: 'tenant_not_resolved' });
    return { ok: false, reason: 'tenant_not_resolved' };
  }

  if (ingest?.persist?.idempotent === true) {
    logger.debug(`[WA_PIPE_SKIP] idempotent traceId=${traceId || 'n/a'} ${jsonSafe({ source, tenantId: effectiveTenantId, externalMessageId })}`);
    return { ok: true, idempotent: true };
  }

  const resolvedConnection = await whatsappQrService.resolveConnectionForInbound(effectiveTenantId, payload).catch(() => null);
  const resolvedConnectionId = resolvedConnection?.id ? String(resolvedConnection.id) : (payload?.__qr?.connectionId ? String(payload.__qr.connectionId) : null);
  const resolvedBotEnabled = resolvedConnection?.botEnabled === true;
  const resolvedBotFlowId = resolvedBotEnabled && resolvedConnection?.botFlowId ? String(resolvedConnection.botFlowId) : null;
  const inboundSessionId = buildInboundSessionId(payload, message, externalConversationId);

  let blockedByPlan = false;
  if (resolvedBotEnabled) {
    const featureCheck = await checkFeature(effectiveTenantId, 'whatsapp_bot').catch(() => ({ allowed: false }));
    blockedByPlan = !featureCheck.allowed;
  }

  const modeFromConnection = (!resolvedConnection || blockedByPlan || !resolvedBotEnabled || !resolvedBotFlowId)
    ? 'human'
    : 'bot';

  logger.info('WA_INBOUND_ROUTE', {
    traceId: traceId || 'n/a',
    tenantId: effectiveTenantId,
    source,
    connectionId: resolvedConnectionId,
    phone_number_id: payload?.value?.metadata?.phone_number_id || payload?.metadata?.phone_number_id || null,
    mode: modeFromConnection,
    flowId: modeFromConnection === 'bot' ? resolvedBotFlowId : null,
    blockedByPlan,
    hasConnection: !!resolvedConnection,
  });

  const messageText = typeof normalized?.text === 'string'
    ? normalized.text
    : (message?.text?.body ? String(message.text.body) : '');

  const iso = normalized?.timestamp || (() => {
    const ts = message?.timestamp ? Number(message.timestamp) : null;
    return ts && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
  })();

  logger.info(`[WA_PIPE_START] traceId=${traceId || 'n/a'} ${jsonSafe({ source, tenantId: effectiveTenantId, externalConversationId, externalMessageId, preview: messageText.slice(0, 200) })}`);

  // 2) Resolve/cria ticket
  const link = await resolveOrCreateTicketFromIncomingMessage(
    effectiveTenantId,
    'whatsapp',
    String(externalConversationId || ''),
    { 
      phone: message?.from ? String(message.from) : null,
      // Fallback para __qr.contactName garante nome mesmo quando value.contacts não vier preenchido.
      name: normalized?.sender?.name || payload?.__qr?.contactName || null
    }
  ).catch((e) => {
    logger.error(`[WA_PIPE_TICKET_RESOLVE_ERR] traceId=${traceId || 'n/a'} ${jsonSafe({ tenantId: effectiveTenantId, externalConversationId, externalMessageId, errMessage: e?.message || String(e), errStack: e?.stack || null })}`);
    return null;
  });

  const ticket = link?.ticket || null;
  if (!ticket?.id) {
    logger.warn(`[WA_PIPE_SKIP] no-ticket traceId=${traceId || 'n/a'} ${jsonSafe({ tenantId: effectiveTenantId, externalConversationId, externalMessageId })}`);
    return { ok: false, reason: 'ticket_not_resolved' };
  }

  // 2.1) Ledger do ticket (idempotente por externalMessageId)
  let effectiveTicket = ticket;
  try {
    const updated = appendTicketMessage(ticket.id, {
      direction: 'in',
      text: messageText,
      externalMessageId,
      timestamp: iso,
    });
    if (updated) effectiveTicket = updated;
  } catch (e) {
    logger.warn(`[WA_PIPE_APPEND_WARN] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: ticket.id, externalMessageId, errMessage: e?.message || String(e) })}`);
  }

  // 3) Modo humano/pausado: não roda bot
  if (effectiveTicket && effectiveTicket.status !== 'closed' && (isHumanMode(effectiveTicket) || modeFromConnection === 'human')) {
    if ((effectiveTicket.mode || 'bot') === 'human' && !effectiveTicket.assignedTo && effectiveTicket.status === 'waiting') {
      autoAssignTicket(effectiveTicket.id).catch(() => null);
    }
    try {
      emitEvent('ticket.message.received', {
        ticketId: effectiveTicket.id,
        message: messageText,
        sender: 'user',
        ticket: effectiveTicket,
      }, { tenantId: effectiveTicket.tenantId, agentId: effectiveTicket.assignedTo });
    } catch (e) {
      logger.warn(`[WA_PIPE_HUMAN_EMIT_WARN] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, errMessage: e?.message || String(e) })}`);
    }

    // Push para app mobile (somente destinatários relevantes; mínimo: assignedTo)
    if (shouldNotifyTicketMessage(effectiveTicket)) {
      const dedup = consumeMessageDedup({
        tenantId: effectiveTicket.tenantId,
        ticketId: effectiveTicket.id,
        externalMessageId,
      });

      if (!dedup.duplicate) {
        const recipients = selectRecipientUserIdsForTicket(effectiveTicket);
        for (const userId of recipients) {
          // eslint-disable-next-line no-await-in-loop
          await sendToUser({
            tenantId: effectiveTicket.tenantId,
            userId,
            notification: {
              title: 'Nova mensagem no WhatsApp',
              body: buildPushBody({ from: message?.from, text: messageText }),
            },
            data: {
              tenantId: effectiveTicket.tenantId,
              ticketId: effectiveTicket.id,
              channel: 'whatsapp',
              conversationId: effectiveTicket.conversationId || '',
              kind: 'ticket_message',
            },
            context: {
              tenantId: effectiveTicket.tenantId,
              ticketId: effectiveTicket.id,
            },
          }).catch((err) => {
            logger.warn('[WA_PIPE_PUSH_WARN]', {
              traceId: traceId || 'n/a',
              ticketId: effectiveTicket.id,
              tenantId: effectiveTicket.tenantId,
              userId,
              error: err?.message || String(err),
            });
            return null;
          });
        }
      }
    }

    logger.info(`[WA_PIPE_HUMAN_MODE_ON] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, mode: effectiveTicket.mode, connectionId: resolvedConnectionId, blockedByPlan })}`);
    return { ok: true, mode: 'human', ticketId: effectiveTicket.id, connectionId: resolvedConnectionId };
  }

  // 4) Bot: processa engine (best-effort)
  try {
    const flows = deps?.flows;
    const sessionEvents = deps?.sessionEvents;
    const saveSessionEvents = deps?.saveSessionEvents;
    if (!flows || !sessionEvents) {
      // Sem dependências do runtime do server.js: ainda assim ticket/ledger já foram criados.
      logger.warn(`[WA_PIPE_BOT_SKIPPED] traceId=${traceId || 'n/a'} ${jsonSafe({ reason: 'missing_deps', ticketId: effectiveTicket.id })}`);
      return { ok: true, mode: 'bot_skipped', ticketId: effectiveTicket.id };
    }

    await processWhatsAppMessage(message, value, {
      flows,
      sessionEvents,
      saveSessionEvents,
      tenantId: effectiveTenantId,
      conversationId: ingest?.persist?.conversationId || null,
      channelType: 'whatsapp',
      flowId: resolvedBotFlowId || null,
      sessionId: inboundSessionId,
    });

    // Após a engine processar a mensagem, recupera o ticket atualizado e emite evento
    // para que o frontend atualize a lista de conversas com a última mensagem
    try {
      const updatedTicket = getTicket(effectiveTicket.id);
      if (updatedTicket) {
        emitEvent('ticket.message.received', {
          ticketId: updatedTicket.id,
          message: messageText,
          sender: 'user',
          ticket: updatedTicket, // Inclui ticket completo para atualização local no frontend
        }, { tenantId: updatedTicket.tenantId, agentId: updatedTicket.assignedTo });
      }
    } catch (e) {
      logger.warn(`[WA_PIPE_BOT_EMIT_WARN] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, errMessage: e?.message || String(e) })}`);
    }

    logger.info(`[WA_PIPE_BOT_DONE] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, connectionId: resolvedConnectionId, flowId: resolvedBotFlowId })}`);
    return { ok: true, mode: 'bot', ticketId: effectiveTicket.id, connectionId: resolvedConnectionId, flowId: resolvedBotFlowId };
  } catch (e) {
    logger.error(`[WA_PIPE_BOT_ERR] traceId=${traceId || 'n/a'} ${jsonSafe({ ticketId: effectiveTicket.id, errMessage: e?.message || String(e), errStack: e?.stack || null })}`);
    return { ok: false, reason: 'bot_error', ticketId: effectiveTicket.id };
  }
}

module.exports = {
  handleWhatsAppInbound,
};
