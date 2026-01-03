/**
 * Serviço de integração com Instagram Direct.
 *
 * Responsabilidades:
 * - Processar mensagens do Instagram Direct
 * - Enviar mensagens via Instagram Graph API
 * - Gerenciar webhooks do Instagram
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const { processWhatsAppMessage } = require('./messageProcessor');

/**
 * Verifica webhook do Instagram.
 * @param {string} mode
 * @param {string} token
 * @param {string} challenge
 * @returns {boolean}
 */
function verifyInstagramWebhook(mode, token, challenge) {
  const verifyToken = config.get('instagram.verifyToken');
  
  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('[Instagram] Webhook verificado com sucesso');
    return true;
  }
  
  return false;
}

/**
 * Envia mensagem de texto via Instagram Direct.
 * @param {string} recipientId - ID do destinatário (Instagram User ID)
 * @param {string} text - Texto da mensagem
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendInstagramMessage(recipientId, text) {
  try {
    const pageAccessToken = config.get('instagram.pageAccessToken') || config.get('messenger.pageAccessToken');
    if (!pageAccessToken) {
      throw new Error('Page Access Token do Instagram não configurado');
    }
    
    const pageId = config.get('instagram.pageId');
    if (!pageId) {
      throw new Error('Page ID do Instagram não configurado');
    }
    
    const url = `https://graph.facebook.com/v18.0/${pageId}/messages`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Instagram API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    logger.info('[Instagram] Mensagem enviada com sucesso', {
      recipientId,
      messageId: data.message_id,
    });
    
    return {
      success: true,
      messageId: data.message_id,
    };
  } catch (error) {
    logger.error('[Instagram] Erro ao enviar mensagem:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Processa mensagem recebida do Instagram.
 * @param {Object} messageData - Dados da mensagem do webhook
 * @param {Map} flows - Map de fluxos
 * @param {Map} sessionEvents - Map de eventos de sessão
 * @returns {Promise<void>}
 */
async function processInstagramMessage(messageData, flows, sessionEvents) {
  try {
    const entry = messageData.entry?.[0];
    if (!entry) {
      logger.warn('[Instagram] Entrada inválida no webhook');
      return;
    }
    
    const messaging = entry.messaging?.[0];
    if (!messaging) {
      logger.warn('[Instagram] Mensagem inválida no webhook');
      return;
    }
    
    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id;
    const message = messaging.message;
    
    if (!senderId || !message) {
      logger.warn('[Instagram] Dados incompletos na mensagem');
      return;
    }
    
    // Extrai texto da mensagem
    let text = '';
    if (message.text) {
      text = message.text;
    } else if (message.attachments) {
      text = '[Mensagem com anexo recebida]';
      logger.info('[Instagram] Mensagem com anexo recebida', {
        senderId,
        attachmentType: message.attachments[0]?.type,
      });
    }
    
    // Cria mensagem no formato compatível
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
    
    // Processa usando o mesmo processador
    await processWhatsAppMessage(compatibleMessage, compatibleValue, {
      flows,
      sessionEvents,
    });
    
    logger.info('[Instagram] Mensagem processada com sucesso', { senderId });
  } catch (error) {
    logger.error('[Instagram] Erro ao processar mensagem:', error);
    throw error;
  }
}

/**
 * Envia mensagem com mídia via Instagram.
 * @param {string} recipientId
 * @param {string} mediaUrl
 * @param {string} mediaType - 'image', 'video'
 * @returns {Promise<{success: boolean, messageId?: string}>}
 */
async function sendInstagramMedia(recipientId, mediaUrl, mediaType = 'image') {
  try {
    const pageAccessToken = config.get('instagram.pageAccessToken') || config.get('messenger.pageAccessToken');
    if (!pageAccessToken) {
      throw new Error('Page Access Token do Instagram não configurado');
    }
    
    const pageId = config.get('instagram.pageId');
    if (!pageId) {
      throw new Error('Page ID do Instagram não configurado');
    }
    
    const url = `https://graph.facebook.com/v18.0/${pageId}/messages`;
    
    const attachment = {
      type: mediaType,
      payload: {
        url: mediaUrl,
      },
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${pageAccessToken}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment,
        },
        messaging_type: 'RESPONSE',
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Instagram API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    return {
      success: true,
      messageId: data.message_id,
    };
  } catch (error) {
    logger.error('[Instagram] Erro ao enviar mídia:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  verifyInstagramWebhook,
  sendInstagramMessage,
  processInstagramMessage,
  sendInstagramMedia,
};

