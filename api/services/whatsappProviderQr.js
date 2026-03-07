const WhatsAppProvider = require('./whatsappProvider');

const runner = require('./whatsappQrRunnerInstance');
const logger = require('../utils/logger');
const tenantSettingsService = require('./tenantSettingsService');
const { getSupportMediaByPath } = require('./supportMediaService');
const { getDocumentFileFromDb } = require('./ragDocumentsService');

async function resolveChannelAccountIdFromSettings(tenantId) {
  try {
    const out = await tenantSettingsService.getSetting({ tenantId, key: 'whatsapp_connections' });
    if (!out?.ok) return null;
    const conns = Array.isArray(out.value?.connections) ? out.value.connections : [];
    const connected = conns.find((c) => String(c?.status || '').toLowerCase() === 'connected');
    const preferredQr = conns.find((c) => String(c?.provider || '').toLowerCase().includes('qr'));
    const fallback = conns[0] || null;
    const selected = connected || preferredQr || fallback;
    const id = selected?.id ? String(selected.id) : null;
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
    const err = new Error(`Sua conta WhatsApp foi detectada conectada em outro dispositivo. Um novo QR code está sendo gerado (detectado há ${secondsAgo}s). Por favor, aguarde 10 segundos e escaneie o novo código QR.`);
    err.code = 'wa_conflict';
    throw err;
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

function assertSocketReadyForSend(tenantId, channelAccountId, sock) {
  if (!sock || typeof sock.sendMessage !== 'function') {
    const err = new Error('Sessão WhatsApp QR não iniciada ou não conectada');
    err.code = 'qr_not_connected';
    throw err;
  }

  const key = `${tenantId}:${channelAccountId}`;
  const meta = runner.sessionMeta?.get ? runner.sessionMeta.get(key) : null;
  const status = String(meta?.status || '').toLowerCase();

  if (status && status !== 'connected') {
    const err = new Error('Sessão WhatsApp QR ainda não está pronta para envio');
    err.code = 'qr_not_connected';
    throw err;
  }

  if (status === 'connected' && !sock?.user?.id) {
    const err = new Error('Sessão WhatsApp QR conectada sem identidade ativa');
    err.code = 'qr_not_connected';
    throw err;
  }
}

function parseSupportMediaRef(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;
  const m = raw.match(/^\/public\/support-media\/([^/]+)\/([^/?#]+)/i);
  if (!m) return null;

  return {
    tenantId: decodeURIComponent(String(m[1] || '')).trim(),
    storageName: decodeURIComponent(String(m[2] || '')).trim(),
  };
}

function parseRagDocumentRef(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) return null;
  const m = raw.match(/^\/rag\/documents\/([^/]+)\/file(?:[?#].*)?$/i);
  if (!m) return null;
  return {
    documentId: decodeURIComponent(String(m[1] || '')).trim(),
  };
}

async function resolveMediaContentFromDb({ tenantId, mediaUrlOrPath }) {
  const ragRef = parseRagDocumentRef(mediaUrlOrPath);
  if (ragRef?.documentId) {
    const fileRow = await getDocumentFileFromDb(ragRef.documentId, tenantId);
    if (!fileRow?.data || !Buffer.isBuffer(fileRow.data) || fileRow.data.length === 0) {
      const err = new Error('Documento RAG sem binário disponível');
      err.code = 'qr_rag_media_not_found';
      throw err;
    }
    return {
      data: fileRow.data,
      mimeType: fileRow.mimeType || null,
      originalName: fileRow.filename || null,
      sizeBytes: Number.isFinite(fileRow.sizeBytes) ? fileRow.sizeBytes : null,
      source: 'rag_blob',
      documentId: ragRef.documentId,
    };
  }

  const ref = parseSupportMediaRef(mediaUrlOrPath);
  if (!ref?.tenantId || !ref?.storageName) {
    const err = new Error('Mídia deve referenciar /public/support-media/<tenant>/<arquivo> ou /rag/documents/:id/file');
    err.code = 'qr_media_db_required';
    throw err;
  }

  // Isolamento: nunca buscar arquivo de outro tenant no envio operacional.
  if (String(ref.tenantId) !== String(tenantId)) {
    logger.warn('WA_QR_SEND', 'tenant mismatch ao resolver mídia interna', {
      tenantId,
      refTenantId: ref.tenantId,
      storageName: ref.storageName,
    });
    const err = new Error('Mídia de outro tenant não pode ser enviada');
    err.code = 'qr_media_tenant_mismatch';
    throw err;
  }

  const media = await getSupportMediaByPath(ref.tenantId, ref.storageName);
  if (!media?.data || !Buffer.isBuffer(media.data) || media.data.length === 0) {
    const err = new Error('Mídia não encontrada no banco');
    err.code = 'qr_media_not_found';
    throw err;
  }
  return media;
}

class WhatsAppProviderQr extends WhatsAppProvider {
  constructor() {
    super();
  }

  async sendText(tenantId, to, text, context) {
    let channelAccountId = context?.channelAccountId || context?.channel_account_id;
    if (!channelAccountId) channelAccountId = await resolveChannelAccountIdFromSettings(tenantId);
    if (!channelAccountId) {
      const err = new Error('Conexão WhatsApp QR não encontrada para envio');
      err.code = 'qr_not_connected';
      throw err;
    }

    const sock = await getOrStartSocket(tenantId, channelAccountId);
    assertSocketReadyForSend(tenantId, channelAccountId, sock);

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
        errorName: err?.name,
        errorStack: err?.stack,
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
    if (!channelAccountId) {
      const err = new Error('Conexão WhatsApp QR não encontrada para envio');
      err.code = 'qr_not_connected';
      throw err;
    }

    const sock = await getOrStartSocket(tenantId, channelAccountId);
    assertSocketReadyForSend(tenantId, channelAccountId, sock);

    const jid = to.includes('@s.whatsapp.net') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;

    const mediaFromDb = await resolveMediaContentFromDb({ tenantId, mediaUrlOrPath });

    let msg = {};
    if (mediaType === 'image') {
      msg = { image: mediaFromDb.data, caption };
    } else if (mediaType === 'video') {
      msg = { video: mediaFromDb.data, caption, ...(mediaFromDb.mimeType ? { mimetype: mediaFromDb.mimeType } : {}) };
    } else if (mediaType === 'audio') {
      msg = { audio: mediaFromDb.data, ...(mediaFromDb.mimeType ? { mimetype: mediaFromDb.mimeType } : {}) };
    } else if (mediaType === 'document') {
      msg = {
        document: mediaFromDb.data,
        caption,
        fileName: mediaFromDb.originalName || 'arquivo',
        ...(mediaFromDb.mimeType ? { mimetype: mediaFromDb.mimeType } : {}),
      };
    }
    else throw new Error('Tipo de mídia não suportado');

    logger.info('WA_QR_SEND', 'sendMedia requested', {
      tenantId,
      channelAccountId,
      to: String(to),
      jid,
      mediaType,
      source: 'db_blob',
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
        errorName: err?.name,
        errorStack: err?.stack,
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
