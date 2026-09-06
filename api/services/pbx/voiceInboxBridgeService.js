'use strict';

/**
 * Voice + Digital: ponte chamada → Inbox omnichannel.
 *
 * Cada chamada encerrada (CDR do PBX) vira uma mensagem do tipo 'call' em
 * uma ChannelConversation com channel_type='voice', reutilizando todo o
 * pipeline conversation-first do Inbox (lista, busca, assignment, WS).
 * Chamadas perdidas inbound incrementam unread (precisam de retorno);
 * chamadas atendidas/outbound entram no histórico sem gerar interrupção.
 *
 * Resolução de contato (best-effort): reutiliza o contact_id/contactName de
 * outra conversa do tenant com o mesmo número e, na falta, casa com
 * MarketingLead.phone. Chamadas internas entre ramais não viram conversa.
 */

const crypto = require('crypto');
const { Op } = require('sequelize');
const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const models = require('../../db/models');
const { registerInboundMessageActivity } = require('../channelConversationService');

const VOICE_CHANNEL_TYPE = 'voice';
const INTERNAL_EXTENSION_MAX_DIGITS = 5;

function dbAvailable() {
  return !!getSequelize();
}

function digitsOnly(value) {
  return String(value || '').replace(/\D+/g, '');
}

function looksLikeExternalPhone(value) {
  return digitsOnly(value).length > INTERNAL_EXTENSION_MAX_DIGITS;
}

function pickExternalNumber({ src, dst } = {}) {
  const srcExternal = looksLikeExternalPhone(src);
  const dstExternal = looksLikeExternalPhone(dst);
  if (srcExternal && !dstExternal) return digitsOnly(src);
  if (dstExternal && !srcExternal) return digitsOnly(dst);
  // Ambos externos (ex.: encaminhamento): o chamador é o cliente.
  if (srcExternal && dstExternal) return digitsOnly(src);
  return null;
}

function isAnsweredCall({ disposition, billsec } = {}) {
  if (String(disposition || '').trim().toUpperCase() === 'ANSWERED') return true;
  return Number(billsec) > 0;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

function buildCallText({ direction, answered, displayName, phone, durationSec }) {
  const who = displayName ? `${displayName} (${phone})` : phone;
  if (direction === 'in') {
    return answered
      ? `📞 Chamada recebida de ${who} — ${formatDuration(durationSec)}`
      : `📞 Chamada perdida de ${who}`;
  }
  return answered
    ? `📞 Chamada realizada para ${who} — ${formatDuration(durationSec)}`
    : `📞 Chamada não atendida para ${who}`;
}

async function resolveContactByPhone({ tenantId, phone }) {
  const ConversationModel = models.ChannelConversation();
  // 1) Outra conversa do tenant com o mesmo número (qualquer canal).
  const existing = await ConversationModel.findOne({
    where: {
      tenant_key: String(tenantId),
      channel_type: { [Op.ne]: VOICE_CHANNEL_TYPE },
      [Op.or]: [
        { external_id: String(phone) },
        { contact_id: String(phone) },
      ],
    },
    order: [['last_message_at', 'DESC NULLS LAST']],
  }).catch(() => null);
  if (existing) {
    const metadata = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    return {
      contactId: existing.contact_id || null,
      contactName: metadata.contactName || metadata.senderName || null,
    };
  }

  // 2) Lead de marketing com o mesmo telefone (comparação por dígitos;
  // os últimos 4 dígitos servem como pré-filtro tolerante a formatação,
  // e a igualdade completa dos dígitos confirma).
  const tail = String(phone).slice(-4);
  if (tail) {
    const LeadModel = models.MarketingLead();
    const candidates = await LeadModel.findAll({
      where: {
        tenant_key: String(tenantId),
        phone: { [Op.iLike]: `%${tail}%` },
      },
      limit: 20,
    }).catch(() => []);

    const lead = (candidates || []).find((item) => digitsOnly(item.phone) === digitsOnly(phone));
    if (lead) {
      return { contactId: lead.id || null, contactName: lead.name || null };
    }
  }
  return { contactId: null, contactName: null };
}

async function upsertVoiceConversation({ tenantId, phone, contact }) {
  const ConversationModel = models.ChannelConversation();
  const now = new Date();
  const existing = await ConversationModel.findOne({
    where: {
      tenant_key: String(tenantId),
      channel_type: VOICE_CHANNEL_TYPE,
      external_id: String(phone),
    },
  });

  if (existing) {
    const metadata = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    const patch = { updated_at: now, last_message_at: now };
    // Enriquecimento tardio: preenche contato quando a resolução passa a existir.
    if (!existing.contact_id && contact.contactId) patch.contact_id = contact.contactId;
    if (!metadata.contactName && contact.contactName) {
      patch.metadata = { ...metadata, contactName: contact.contactName };
    }
    await existing.update(patch);
    return existing;
  }

  return ConversationModel.create({
    id: `conv-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    tenant_key: String(tenantId),
    channel_type: VOICE_CHANNEL_TYPE,
    external_id: String(phone),
    contact_id: contact.contactId || null,
    status: 'open',
    metadata: contact.contactName ? { contactName: contact.contactName } : {},
    last_message_at: now,
    created_at: now,
    updated_at: now,
  });
}

/**
 * Registra uma chamada encerrada no Inbox. Idempotente por
 * external_message_id = pbx-call:<tenantId>:<uniqueid|cdrId>.
 */
async function recordCallToInbox({ tenantId, call } = {}) {
  if (!tenantId || !call) return { bridged: false, reason: 'invalid_input' };
  if (!dbAvailable()) return { bridged: false, reason: 'db_unavailable' };

  const phone = pickExternalNumber({ src: call.src, dst: call.dst });
  if (!phone) return { bridged: false, reason: 'internal_call' };

  const callRef = String(call.uniqueid || call.cdrId || '').trim();
  if (!callRef) return { bridged: false, reason: 'missing_call_reference' };

  const externalMessageId = `pbx-call:${String(tenantId)}:${callRef}`;
  const MessageModel = models.ChannelMessage();
  const already = await MessageModel.findOne({
    where: { tenant_key: String(tenantId), external_message_id: externalMessageId },
  }).catch(() => null);
  if (already) return { bridged: true, skipped: true, reason: 'already_bridged' };

  const direction = digitsOnly(call.src) === phone ? 'in' : 'out';
  const answered = isAnsweredCall({ disposition: call.disposition, billsec: call.billsec });
  const durationSec = Math.max(0, Math.floor(Number(call.duration) || 0));

  const contact = await resolveContactByPhone({ tenantId, phone }).catch(() => ({ contactId: null, contactName: null }));
  const conversation = await upsertVoiceConversation({ tenantId, phone, contact });

  const now = new Date();
  const text = buildCallText({
    direction,
    answered,
    displayName: contact.contactName,
    phone,
    durationSec: answered ? Math.max(0, Math.floor(Number(call.billsec) || durationSec)) : durationSec,
  });

  const row = await MessageModel.create({
    id: `cmsg-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
    tenant_key: String(tenantId),
    conversation_id: conversation.id,
    channel_type: VOICE_CHANNEL_TYPE,
    direction,
    type: 'call',
    body: {
      type: 'call',
      text,
      call: {
        cdrId: call.cdrId || null,
        uniqueid: call.uniqueid || null,
        direction,
        answered,
        disposition: call.disposition || null,
        durationSec,
        billsec: Math.max(0, Math.floor(Number(call.billsec) || 0)),
        phone,
        src: call.src || null,
        dst: call.dst || null,
        endedAt: call.endedAt || now.toISOString(),
      },
    },
    external_message_id: externalMessageId,
    status: direction === 'out' ? 'sent' : 'received',
    created_at: call.endedAt ? new Date(call.endedAt) : now,
    updated_at: now,
  });

  // Gravação + transcrição: se o .wav já foi escaneado, anexa recordingId e,
  // quando a policy permite, a transcrição. Best-effort.
  if (call.uniqueid) {
    try {
      // eslint-disable-next-line global-require
      const { linkRecordingToCallMessage } = require('./voiceRecordingLinkService');
      await linkRecordingToCallMessage({ tenantId, uniqueid: call.uniqueid });
    } catch (recErr) {
      try {
        logger.warn('[VoiceInboxBridge] Link de gravação best-effort falhou', {
          tenantId, uniqueid: call.uniqueid, error: String(recErr?.message || recErr),
        });
      } catch (_) {}
    }
  }

  // Customer 360: a chamada passa a constar na timeline do Workspace da
  // entidade (resolvida por telefone), igual às mensagens dos demais canais.
  // Best-effort: nunca quebra o registro da chamada.
  try {
    // Lazy require no mesmo padrão do channelGatewayService (evita ciclo).
    // eslint-disable-next-line global-require
    const WorkspaceLinkAutomationService = require('../workspace/WorkspaceLinkAutomationService');
    const linkAutomation = new WorkspaceLinkAutomationService();
    await linkAutomation.linkMessageReceived({
      tenantId,
      conversation: conversation.toJSON ? conversation.toJSON() : conversation,
      messageId: row.id,
    });
  } catch (linkErr) {
    try {
      logger.warn('[VoiceInboxBridge] Workspace link best-effort falhou', {
        tenantId, conversationId: conversation.id, error: String(linkErr?.message || linkErr),
      });
    } catch (_) {}
  }

  // Chamada perdida inbound = precisa de retorno → unread + realtime.
  // Demais chamadas entram no histórico sem gerar interrupção.
  if (direction === 'in' && !answered) {
    await registerInboundMessageActivity({
      tenantId,
      conversationId: conversation.id,
      channelType: VOICE_CHANNEL_TYPE,
      message: {
        id: row.id,
        direction,
        type: 'call',
        body: row.body || {},
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : now.toISOString(),
      },
    });
  }

  try {
    logger.info('[VoiceInboxBridge] Chamada registrada no Inbox', {
      tenantId, phone, direction, answered, conversationId: conversation.id,
    });
  } catch (_) {}

  return {
    bridged: true,
    conversationId: conversation.id,
    messageId: row.id,
    direction,
    answered,
    phone,
    contactId: conversation.contact_id || null,
  };
}

module.exports = {
  recordCallToInbox,
  // exportados para testes/consumidores
  pickExternalNumber,
  isAnsweredCall,
  formatDuration,
  buildCallText,
  VOICE_CHANNEL_TYPE,
};
