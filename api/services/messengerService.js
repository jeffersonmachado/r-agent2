/**
 * Serviço de integração com Facebook Messenger.
 *
 * Responsabilidades:
 * - Processar mensagens do Facebook Messenger
 * - Enviar mensagens via Messenger API
 * - Gerenciar webhooks do Messenger
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const { processWhatsAppMessage } = require('./messageProcessor');

/**
 * Verifica webhook do Facebook Messenger.
 * @param {string} mode
 * @param {string} token
 * @param {string} challenge
 * @returns {boolean}
 */
function verifyMessengerWebhook(mode, token, challenge) {
  const verifyToken = config.get('messenger.verifyToken');
  
  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('[Messenger] Webhook verificado com sucesso');
    return true;
  }
  
  return false;
}

/**
 * Envia mensagem de texto via Messenger.
 * @param {string} recipientId - ID do destinatário
 * @param {string} text - Texto da mensagem
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendMessengerMessage(recipientId, text) {
  try {
    const pageAccessToken = config.get('messenger.pageAccessToken');
    if (!pageAccessToken) {
      throw new Error('Page Access Token do Messenger não configurado');
    }
    
    const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${pageAccessToken}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Messenger API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    logger.info('[Messenger] Mensagem enviada com sucesso', {
      recipientId,
      messageId: data.message_id,
    });
    
    return {
      success: true,
      messageId: data.message_id,
    };
  } catch (error) {
    logger.error('[Messenger] Erro ao enviar mensagem:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Processa mensagem recebida do Messenger.
 * @param {Object} messageData - Dados da mensagem do webhook
 * @param {Map} flows - Map de fluxos
 * @param {Map} sessionEvents - Map de eventos de sessão
 * @returns {Promise<void>}
 */
async function processMessengerMessage(messageData, flows, sessionEvents) {
  try {
    const entry = messageData.entry?.[0];
    if (!entry) {
      logger.warn('[Messenger] Entrada inválida no webhook');
      return;
    }
    
    const messaging = entry.messaging?.[0];
    if (!messaging) {
      logger.warn('[Messenger] Mensagem inválida no webhook');
      return;
    }
    
    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id;
    const message = messaging.message;
    
    if (!senderId || !message) {
      logger.warn('[Messenger] Dados incompletos na mensagem');
      return;
    }
    
    // Extrai texto da mensagem
    let text = '';
    if (message.text) {
      text = message.text;
    } else if (message.attachments) {
      // Processa anexos (imagens, áudios, etc.)
      text = '[Mensagem com anexo recebida]';
      logger.info('[Messenger] Mensagem com anexo recebida', {
        senderId,
        attachmentType: message.attachments[0]?.type,
      });
    }
    
    // Cria mensagem no formato compatível com WhatsApp para reutilizar processador
    const compatibleMessage = {
      from: senderId,
      id: message.mid,
      text: {
        body: text,
      },
      type: message.text ? 'text' : 'attachment',
    };
    
    const compatibleValue = {
      metadata: {
        phone_number_id: recipientId,
      },
    };
    
    // Processa usando o mesmo processador do WhatsApp
    await processWhatsAppMessage(compatibleMessage, compatibleValue, {
      flows,
      sessionEvents,
    });
    
    logger.info('[Messenger] Mensagem processada com sucesso', { senderId });
  } catch (error) {
    logger.error('[Messenger] Erro ao processar mensagem:', error);
    throw error;
  }
}

/**
 * Envia mensagem com botões via Messenger.
 * @param {string} recipientId
 * @param {string} text
 * @param {Array} buttons - Array de {type: 'postback'|'web_url', title: string, payload?: string, url?: string}
 * @returns {Promise<{success: boolean, messageId?: string}>}
 */
async function sendMessengerButtons(recipientId, text, buttons) {
  try {
    const pageAccessToken = config.get('messenger.pageAccessToken');
    if (!pageAccessToken) {
      throw new Error('Page Access Token do Messenger não configurado');
    }
    
    const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${pageAccessToken}`;
    
    const quickReplies = buttons.map(btn => {
      if (btn.type === 'postback') {
        return {
          content_type: 'text',
          title: btn.title,
          payload: btn.payload || btn.title,
        };
      } else if (btn.type === 'web_url') {
        return {
          content_type: 'text',
          title: btn.title,
          url: btn.url,
        };
      }
      return null;
    }).filter(Boolean);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          text,
          quick_replies: quickReplies,
        },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Messenger API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      success: true,
      messageId: data.message_id,
    };
  } catch (error) {
    logger.error('[Messenger] Erro ao enviar botões:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  verifyMessengerWebhook,
  sendMessengerMessage,
  processMessengerMessage,
  sendMessengerButtons,
};

