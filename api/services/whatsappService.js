/**
 * Serviço para integração com WhatsApp Cloud API.
 *
 * Responsabilidades:
 * - Enviar mensagens de texto para usuários do WhatsApp.
 * - Validar token de verificação do webhook (setup no painel do Meta).
 */

const https = require('https');
const config = require('../utils/config');
const logger = require('../utils/logger');

const WHATSAPP_API_URL = config.getFromFile('whatsapp.apiUrl');
const WHATSAPP_PHONE_NUMBER_ID = config.getFromFile('whatsapp.phoneNumberId');
const WHATSAPP_ACCESS_TOKEN = config.getFromFile('whatsapp.accessToken');
const WHATSAPP_VERIFY_TOKEN = config.getFromFile('whatsapp.verifyToken');

function normalizeMediaType(type, mimeType) {
  const t = String(type || '').trim().toLowerCase();
  if (t === 'image' || t === 'video' || t === 'audio' || t === 'document') return t;
  if (t === 'media') {
    const mime = String(mimeType || '').trim().toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'document';
  }
  return '';
}

/**
 * Valida se as credenciais do WhatsApp são válidas (não são placeholders).
 *
 * @returns {boolean}
 */
function areCredentialsValid() {
  // Detecta placeholders comuns (aplicado a phoneNumberId, accessToken e
  // verifyToken — um placeholder em qualquer um deles torna a chamada à
  // Meta garantidamente inválida, ex.: 401 OAuthException por
  // "Malformed access token REPLACE_WITH_WHATSAPP_ACCESS_TOKEN").
  const placeholderPatterns = [
    /^\+?\s*1\s*555\s*059\s*7005/i, // "+1 555 059 7005"
    /REPLACE_WITH/i,
    /SEU_/i,
    /YOUR_/i,
    /PLACEHOLDER/i,
    /EXAMPLE/i,
    /TESTE/i,
    /^ID_DO_/i,
  ];

  // Verifica se phoneNumberId existe e não é um placeholder
  const phoneNumberId = WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    return false;
  }

  if (placeholderPatterns.some(pattern => pattern.test(phoneNumberId))) {
    return false;
  }

  // Verifica se accessToken existe, não é placeholder e tem tamanho plausível
  if (!WHATSAPP_ACCESS_TOKEN || typeof WHATSAPP_ACCESS_TOKEN !== 'string') {
    return false;
  }

  if (placeholderPatterns.some(pattern => pattern.test(WHATSAPP_ACCESS_TOKEN))) {
    return false;
  }

  if (WHATSAPP_ACCESS_TOKEN.length < 20) {
    return false; // Token muito curto, provavelmente inválido
  }

  // verifyToken também não pode ser placeholder (webhook verify + guarda simétrica)
  if (!WHATSAPP_VERIFY_TOKEN || typeof WHATSAPP_VERIFY_TOKEN !== 'string'
    || placeholderPatterns.some(pattern => pattern.test(WHATSAPP_VERIFY_TOKEN))) {
    return false;
  }

  return true;
}

/**
 * Envia mensagem de texto via WhatsApp Cloud API.
 *
 * @param {string} to - Número do destinatário (formato: 5511999999999)
 * @param {string} text - Texto da mensagem
 * @returns {Promise<Object>}
 */
async function sendTextMessage(to, text) {
  if (!WHATSAPP_API_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_VERIFY_TOKEN) {
    throw new Error('required_config_missing:whatsapp');
  }
  
  // Valida se as credenciais não são placeholders
  if (!areCredentialsValid()) {
    logger.warn('[WhatsApp] Credenciais inválidas ou são placeholders. Não será possível enviar mensagens.');
    throw new Error('WhatsApp credentials são inválidas ou são placeholders. Configure credenciais reais em config.json');
  }

  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  function buildWhatsAppError(statusCode, rawBody, parsed) {
    const err = new Error(`WhatsApp API error: ${statusCode} - ${rawBody}`);
    err.statusCode = statusCode;
    err.details = parsed || null;
    // Meta pode retornar code/subcode em error
    const code = parsed?.error?.code ?? null;
    const subcode = parsed?.error?.error_subcode ?? null;
    const message = parsed?.error?.message ? String(parsed.error.message) : String(rawBody || '');
    err.wa_code = code;
    err.wa_subcode = subcode;

    // Heurística operacional: janela 24h expirada / precisa template
    const m = message.toLowerCase();
    const looksLikeOutsideWindow = m.includes('outside the allowed window')
      || m.includes('24 hour')
      || m.includes('24-hour')
      || m.includes('requires a template')
      || m.includes('message failed because it was outside')
      || m.includes('131047'); // aparece em alguns payloads/logs
    if (looksLikeOutsideWindow) {
      err.code = 'outside_window_24h';
    }
    return err;
  }

  return new Promise((resolve, reject) => {
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      },
    };

    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : {});
        } else {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (_) {
            parsed = null;
          }
          reject(buildWhatsAppError(res.statusCode, data, parsed));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function sendMediaMessage(to, { type, mimeType, fileName, caption, buffer, link } = {}) {
  if (!WHATSAPP_API_URL || !WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_VERIFY_TOKEN) {
    throw new Error('required_config_missing:whatsapp');
  }

  if (!areCredentialsValid()) {
    logger.warn('[WhatsApp] Credenciais inválidas ou são placeholders. Não será possível enviar mensagens.');
    throw new Error('WhatsApp credentials são inválidas ou são placeholders. Configure credenciais reais em config.json');
  }

  const mediaType = normalizeMediaType(type, mimeType);
  if (!mediaType) {
    throw new Error(`Tipo de mídia não suportado: ${String(type || '')}`);
  }

  let mediaObjectId = null;
  const normalizedLink = String(link || '').trim();

  if (normalizedLink) {
    // Usa link diretamente quando o arquivo já está em URL pública acessível pela Meta.
    mediaObjectId = null;
  } else {
    const mediaBuffer = Buffer.isBuffer(buffer) ? buffer : null;
    if (!mediaBuffer || mediaBuffer.length === 0) {
      throw new Error('Envio de mídia requer buffer ou link');
    }

    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append(
      'file',
      new Blob([mediaBuffer], { type: String(mimeType || 'application/octet-stream') }),
      String(fileName || 'upload.bin')
    );

    const uploadUrl = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/media`;
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
      },
      body: form,
    });

    const uploadData = await uploadResp.json().catch(() => ({}));
    if (!uploadResp.ok) {
      throw new Error(uploadData?.error?.message || `WhatsApp media upload error: ${uploadResp.status}`);
    }
    mediaObjectId = uploadData?.id || null;
    if (!mediaObjectId) {
      throw new Error('WhatsApp media upload retornou sem id');
    }
  }

  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const mediaPayload = mediaObjectId
    ? { id: mediaObjectId }
    : { link: normalizedLink };

  const captionText = String(caption || '').trim();
  if (captionText && (mediaType === 'image' || mediaType === 'video' || mediaType === 'document')) {
    mediaPayload.caption = captionText;
  }
  if (fileName && mediaType === 'document') {
    mediaPayload.filename = String(fileName);
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: mediaType,
    [mediaType]: mediaPayload,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || `WhatsApp API error: ${response.status}`);
  }

  return data;
}

/**
 * Valida token do webhook (verificação inicial do Meta).
 *
 * @param {string|null} mode
 * @param {string|null} token
 * @returns {boolean}
 */
function verifyWebhook(mode, token) {
  return mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN;
}

module.exports = {
  sendTextMessage,
  sendMediaMessage,
  verifyWebhook,
  areCredentialsValid,
};


