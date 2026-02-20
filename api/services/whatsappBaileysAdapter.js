'use strict';

// Converte uma mensagem Baileys em um formato "compatível" (mínimo) com o normalizador do gateway,
// que hoje assume o shape do WhatsApp Cloud API (msg.from, msg.id, msg.text.body).
//
// Importante (MD / LID):
// Em alguns cenários (multi-device), a chave pode vir como *@lid* (Linked ID) e, em outros,
// como *@s.whatsapp.net*. Para ticketização/roteamento, precisamos priorizar o JID "real"
// do usuário (@s.whatsapp.net) e NUNCA usar @lid como "telefone".
function pickBestRemoteJid(baileysMsg) {
  const k = baileysMsg?.key || {};
  const candidates = [
    k.remoteJidAlt,
    k.participant,
    k.participantAlt,
    k.remoteJid,
  ].filter(Boolean).map(String);

  // Prioriza JID de usuário/grupo "real"
  const userJid = candidates.find(j => /@s\.whatsapp\.net$/i.test(j));
  if (userJid) return userJid;

  const groupJid = candidates.find(j => /@g\.us$/i.test(j));
  if (groupJid) return groupJid;

  // Se só existir @lid, devolve (mas será tratado abaixo)
  const lidJid = candidates.find(j => /@lid$/i.test(j));
  if (lidJid) return lidJid;

  return candidates[0] || '';
}

function jidToPhoneLike(jid) {
  return String(jid || '')
    .replace(/@s\.whatsapp\.net$/i, '')
    .replace(/@g\.us$/i, '')
    .replace(/@lid$/i, '')
    .replace(/^\+/, '')
    .replace(/[^0-9]/g, '');
}

function baileysToCloudMessage(baileysMsg) {
  const bestJid = pickBestRemoteJid(baileysMsg);
  const from = jidToPhoneLike(bestJid);

  const id = baileysMsg?.key?.id || null;

  const ts =
    (typeof baileysMsg?.messageTimestamp === 'number' ? baileysMsg.messageTimestamp : null) ||
    (typeof baileysMsg?.messageTimestamp === 'string' ? Number(baileysMsg.messageTimestamp) : null) ||
    null;

  const text =
    baileysMsg?.message?.conversation ||
    baileysMsg?.message?.extendedTextMessage?.text ||
    '';

  return {
    from,
    id,
    timestamp: ts && Number.isFinite(ts) ? String(ts) : undefined,
    type: 'text',
    text: { body: String(text || '') },
    // Metadados auxiliares (não dependem do normalizador)
    __baileys: {
      bestJid,
      remoteJid: baileysMsg?.key?.remoteJid || null,
      remoteJidAlt: baileysMsg?.key?.remoteJidAlt || null,
      participant: baileysMsg?.key?.participant || null,
    },
  };
}

module.exports = { baileysToCloudMessage, pickBestRemoteJid, jidToPhoneLike };
