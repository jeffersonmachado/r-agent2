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

const WHATSAPP_API_URL = config.get('whatsapp.apiUrl', 'https://graph.facebook.com/v18.0');
const WHATSAPP_PHONE_NUMBER_ID = config.get('whatsapp.phoneNumberId');
const WHATSAPP_ACCESS_TOKEN = config.get('whatsapp.accessToken');
const WHATSAPP_VERIFY_TOKEN = config.get('whatsapp.verifyToken');

/**
 * Valida se as credenciais do WhatsApp são válidas (não são placeholders).
 *
 * @returns {boolean}
 */
function areCredentialsValid() {
  // Verifica se phoneNumberId não é um placeholder
  const phoneNumberId = WHATSAPP_PHONE_NUMBER_ID;
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    return false;
  }
  
  // Detecta placeholders comuns
  const placeholderPatterns = [
    /^\+?\s*1\s*555\s*059\s*7005/i, // "+1 555 059 7005"
    /SEU_/i,
    /YOUR_/i,
    /PLACEHOLDER/i,
    /EXAMPLE/i,
    /TESTE/i,
    /^ID_DO_/i,
  ];
  
  if (placeholderPatterns.some(pattern => pattern.test(phoneNumberId))) {
    return false;
  }
  
  // Verifica se accessToken existe e não é placeholder
  if (!WHATSAPP_ACCESS_TOKEN || typeof WHATSAPP_ACCESS_TOKEN !== 'string') {
    return false;
  }
  
  if (WHATSAPP_ACCESS_TOKEN.length < 20) {
    return false; // Token muito curto, provavelmente inválido
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
  if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
    throw new Error('WhatsApp credentials não configuradas');
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
  verifyWebhook,
  areCredentialsValid,
};


