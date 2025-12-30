/**
 * Serviço para integração com WhatsApp Cloud API.
 *
 * Responsabilidades:
 * - Enviar mensagens de texto para usuários do WhatsApp.
 * - Validar token de verificação do webhook (setup no painel do Meta).
 */

const https = require('https');
const config = require('../utils/config');

const WHATSAPP_API_URL = config.get('whatsapp.apiUrl', 'https://graph.facebook.com/v18.0');
const WHATSAPP_PHONE_NUMBER_ID = config.get('whatsapp.phoneNumberId');
const WHATSAPP_ACCESS_TOKEN = config.get('whatsapp.accessToken');
const WHATSAPP_VERIFY_TOKEN = config.get('whatsapp.verifyToken');

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

  const url = `${WHATSAPP_API_URL}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

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
          reject(new Error(`WhatsApp API error: ${res.statusCode} - ${data}`));
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
};


