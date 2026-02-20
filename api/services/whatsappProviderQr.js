const WhatsAppProvider = require('./whatsappProvider');

const WhatsAppQrRunner = require('./whatsappQrRunner');
const path = require('path');
const runner = new WhatsAppQrRunner({ sessionsDir: path.join(__dirname, '../data/wa_sessions') });
const logger = require('../utils/logger');
const tenantSettingsService = require('./tenantSettingsService');

async function resolveChannelAccountIdFromSettings(tenantId) {
  try {
    const out = await tenantSettingsService.getSetting({ tenantId, key: 'whatsapp_connections' });
    if (!out?.ok) return null;
    const conns = Array.isArray(out.value?.connections) ? out.value.connections : [];
    const connected = conns.find(c => String(c?.status || '').toLowerCase() === 'connected');
    const id = connected?.id ? String(connected.id) : null;
    return id || null;
  } catch (_) {
    return null;
  }
}

async function getOrStartSocket(tenantId, channelAccountId) {
  const key = `${tenantId}:${channelAccountId}`;
  let sock = runner.sessions.get(key);
  if (sock) return sock;

  // Detecta se houve conflito recente (conta conectada em outro lugar)
  if (runner.recentConflicts.has(key)) {
    const conflictTime = runner.recentConflicts.get(key);
    const secondsAgo = Math.floor((Date.now() - conflictTime) / 1000);
    throw new Error(`Sua conta WhatsApp foi detectada conectada em outro dispositivo. Um novo QR code está sendo gerado (detectado há ${secondsAgo}s). Por favor, aguarde 10 segundos e escaneie o novo código QR.`);
  }

  // Se a sessão não está em memória, tentamos garantir/startar.
  // Isso permite que, após restart do servidor, a sessão seja retomada a partir do auth state em disco.
  try {
    await runner.ensureSession(tenantId, channelAccountId, null, { qrCacheMs: 0 });
  } catch (e) {
    // segue para lançar erro padronizado abaixo
  }
  sock = runner.sessions.get(key);
  return sock || null;
}

class WhatsAppProviderQr extends WhatsAppProvider {
  constructor() {
    super();
  }

  async sendText(tenantId, to, text, context) {
    let channelAccountId = context?.channelAccountId || context?.channel_account_id;
    if (!channelAccountId) channelAccountId = await resolveChannelAccountIdFromSettings(tenantId);
    if (!channelAccountId) throw new Error('channelAccountId obrigatório no context para envio via QR');

    const sock = await getOrStartSocket(tenantId, channelAccountId);
    if (!sock) throw new Error('Sessão WhatsApp QR não iniciada ou não conectada');

    const jid = to.includes('@s.whatsapp.net') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

    logger.info('WA_QR_SEND', 'sendText requested', {
      tenantId,
      channelAccountId,
      to: String(to),
      jid,
      textPreview: String(text || '').slice(0, 200),
    });

    let result;
    try {
      result = await sock.sendMessage(jid, { text });
    } catch (err) {
      logger.error('WA_QR_SEND', 'Erro ao enviar mensagem via Baileys', {
        tenantId,
        channelAccountId,
        to: String(to),
        jid,
        errorMessage: err?.message,
        errorCode: err?.code,
      });
      throw err;
    }

    // Validação: result pode vir null/undefined ou sem propriedade key
    if (!result) {
      logger.warn('WA_QR_SEND', 'Baileys retornou resultado vazio para sendMessage', {
        tenantId,
        channelAccountId,
        to: String(to),
        jid,
      });
    }

    const messageId = result?.key?.id || null;
    logger.info('WA_QR_SEND', 'sendText done', {
      tenantId,
      channelAccountId,
      to: String(to),
      jid,
      messageId,
      resultHasKey: !!result?.key,
    });

    return { messages: [{ id: messageId }] };
  }

  async sendMedia(tenantId, to, mediaType, mediaUrlOrPath, caption, context) {
    let channelAccountId = context?.channelAccountId || context?.channel_account_id;
    if (!channelAccountId) channelAccountId = await resolveChannelAccountIdFromSettings(tenantId);
    if (!channelAccountId) throw new Error('channelAccountId obrigatório no context para envio via QR');

    const sock = await getOrStartSocket(tenantId, channelAccountId);
    if (!sock) throw new Error('Sessão WhatsApp QR não iniciada ou não conectada');

    const jid = to.includes('@s.whatsapp.net') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

    let msg = {};
    if (mediaType === 'image') msg = { image: { url: mediaUrlOrPath }, caption };
    else if (mediaType === 'video') msg = { video: { url: mediaUrlOrPath }, caption };
    else if (mediaType === 'audio') msg = { audio: { url: mediaUrlOrPath } };
    else if (mediaType === 'document') msg = { document: { url: mediaUrlOrPath }, caption };
    else throw new Error('Tipo de mídia não suportado');

    logger.info('WA_QR_SEND', 'sendMedia requested', {
      tenantId,
      channelAccountId,
      to: String(to),
      jid,
      mediaType,
      captionPreview: caption ? String(caption).slice(0, 200) : null,
    });

    let result;
    try {
      result = await sock.sendMessage(jid, msg);
    } catch (err) {
      logger.error('WA_QR_SEND', 'Erro ao enviar mídia via Baileys', {
        tenantId,
        channelAccountId,
        to: String(to),
        jid,
        mediaType,
        errorMessage: err?.message,
        errorCode: err?.code,
      });
      throw err;
    }

    // Validação: result pode vir null/undefined ou sem propriedade key
    if (!result) {
      logger.warn('WA_QR_SEND', 'Baileys retornou resultado vazio para sendMedia', {
        tenantId,
        channelAccountId,
        to: String(to),
        jid,
        mediaType,
      });
    }

    const messageId = result?.key?.id || null;
    logger.info('WA_QR_SEND', 'sendMedia done', {
      tenantId,
      channelAccountId,
      to: String(to),
      jid,
      mediaType,
      messageId,
      resultHasKey: !!result?.key,
    });

    return { messages: [{ id: messageId }] };
  }

  async sendTemplate() {
    throw new Error('Templates não suportados via Baileys');
  }
}

module.exports = WhatsAppProviderQr;
