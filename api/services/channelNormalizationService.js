'use strict';
/**
 * Channel Normalization Service (Blip-like).
 *
 * Objetivo:
 * - Normalizar payloads de webhooks de diferentes canais em um modelo único.
 * - Ser usado pelos handlers de webhook antes de persistência/linkagem de ticket.
 *
 * Observação:
 * - A persistência "source of truth" omnichannel já existe em channelGatewayService
 *   (channel_conversations + channel_messages). Este service é uma camada de padronização
 *   para timeline/ticket e para unificar WhatsApp/Instagram no mesmo fluxo.
 */

/**
 * @typedef {Object} NormalizedMessage
 * @property {'whatsapp'|'instagram'|string} channel
 * @property {'in'|'out'} direction
 * @property {'text'|'image'|'audio'|'document'|'template'|'interactive'|string} messageType
 * @property {string|null} text
 * @property {{url?:string|null,mimeType?:string|null,size?:number|null}|null} media
 * @property {string|null} externalMessageId
 * @property {string|null} externalConversationId
 * @property {{id?:string|null,name?:string|null,phone?:string|null}|null} sender
 * @property {string|null} timestamp
 * @property {object} raw
 */

function safeString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.trim() ? s : null;
}

function toIsoFromUnixSeconds(tsSeconds) {
  const n = Number(tsSeconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function toIsoFromUnixMillis(tsMillis) {
  const n = Number(tsMillis);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

/**
 * Normaliza um payload de WhatsApp:
 * - Aceita o body completo do webhook (Meta) OU um payload reduzido { message, value, raw }.
 *
 * @param {any} payload
 * @returns {NormalizedMessage[]}
 */
function normalizeWhatsAppIncoming(payload) {
  // Caso "payload reduzido" (usado por server.js durante iteração)
  if (payload && typeof payload === 'object' && payload.message && (payload.value || payload.raw)) {
    const msg = payload.message;
    const value = payload.value || {};
    const raw = payload.raw || payload;
    const from = safeString(msg?.from);
    const waType = safeString(msg?.type) || (msg?.text?.body ? 'text' : 'text');
    const externalMessageId = safeString(msg?.id);
    const externalConversationId = from ? from.replace(/^\+/, '') : null;
    const timestamp = msg?.timestamp ? toIsoFromUnixSeconds(msg.timestamp) : null;

    // Contacts (quando disponível) no value.contacts[0]
    const contact = Array.isArray(value?.contacts) ? value.contacts[0] : null;
    const profileName = safeString(contact?.profile?.name);

    /** @type {NormalizedMessage} */
    const nm = {
      channel: 'whatsapp',
      direction: 'in',
      messageType: 'text',
      text: null,
      media: null,
      externalMessageId,
      externalConversationId,
      sender: from ? { id: from, name: profileName, phone: from } : null,
      timestamp,
      raw: { message: msg, value, webhook: raw },
    };

    if (waType === 'text') {
      nm.messageType = 'text';
      nm.text = safeString(msg?.text?.body) || '';
    } else if (waType === 'image') {
      nm.messageType = 'image';
      nm.text = safeString(msg?.image?.caption) || null;
      nm.media = { url: safeString(msg?.image?.id) || null, mimeType: safeString(msg?.image?.mime_type) || null, size: null };
    } else if (waType === 'audio') {
      nm.messageType = 'audio';
      nm.media = { url: safeString(msg?.audio?.id) || null, mimeType: safeString(msg?.audio?.mime_type) || null, size: null };
    } else if (waType === 'document') {
      nm.messageType = 'document';
      nm.text = safeString(msg?.document?.caption) || safeString(msg?.document?.filename) || null;
      nm.media = { url: safeString(msg?.document?.id) || null, mimeType: safeString(msg?.document?.mime_type) || null, size: null };
    } else if (waType === 'interactive') {
      nm.messageType = 'interactive';
      nm.text = safeString(msg?.interactive?.button_reply?.title)
        || safeString(msg?.interactive?.list_reply?.title)
        || null;
      nm.raw = { ...nm.raw, interactive: msg?.interactive || null };
    } else {
      nm.messageType = waType;
      nm.text = safeString(msg?.text?.body) || null;
    }

    return [nm];
  }

  // Body completo do webhook (Meta)
  const body = payload || {};
  const out = [];

  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (change?.field !== 'messages') continue;
      const value = change?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const msg of messages) {
        out.push(...normalizeWhatsAppIncoming({ message: msg, value, raw: body }));
      }
    }
  }
  return out;
}

/**
 * Normaliza um payload de Instagram:
 * - Aceita body completo do webhook OU payload reduzido { entry, messaging, raw, pageId }.
 *
 * @param {any} payload
 * @returns {NormalizedMessage[]}
 */
function normalizeInstagramIncoming(payload) {
  // payload reduzido
  if (payload && typeof payload === 'object' && payload.messaging) {
    const messaging = payload.messaging;
    const raw = payload.raw || payload;
    const senderId = safeString(messaging?.sender?.id);
    const mid = safeString(messaging?.message?.mid);
    const timestamp = messaging?.timestamp ? toIsoFromUnixMillis(messaging.timestamp) : null;

    let messageType = 'text';
    let text = null;
    let media = null;

    const msg = messaging?.message || {};
    if (safeString(msg?.text)) {
      messageType = 'text';
      text = safeString(msg.text) || '';
    } else if (Array.isArray(msg?.attachments) && msg.attachments.length > 0) {
      const att = msg.attachments[0] || {};
      const attType = safeString(att?.type) || 'document';
      if (attType === 'image') messageType = 'image';
      else if (attType === 'audio') messageType = 'audio';
      else messageType = 'document';

      // Instagram/Messenger geralmente traz payload.url para attachments
      const url = safeString(att?.payload?.url) || null;
      media = { url, mimeType: null, size: null };
      text = null;
    } else {
      messageType = 'text';
      text = null;
    }

    /** @type {NormalizedMessage} */
    const nm = {
      channel: 'instagram',
      direction: 'in',
      messageType,
      text,
      media,
      externalMessageId: mid,
      externalConversationId: senderId,
      sender: senderId ? { id: senderId, name: null, phone: null } : null,
      timestamp,
      raw: { entry: payload.entry || null, messaging, webhook: raw, pageId: payload.pageId || null },
    };
    return [nm];
  }

  // body completo
  const body = payload || {};
  const out = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const messagingEvents = Array.isArray(entry?.messaging) ? entry.messaging : [];
    for (const messaging of messagingEvents) {
      out.push(...normalizeInstagramIncoming({ entry, messaging, raw: body, pageId: entry?.id || null }));
    }
  }
  return out;
}

module.exports = {
  normalizeWhatsAppIncoming,
  normalizeInstagramIncoming,
};

