/**
 * Serviço de Templates de Mensagens para WhatsApp Business API.
 *
 * Responsabilidades:
 * - Gerenciar templates de mensagens aprovados
 * - Criar e validar templates
 * - Enviar mensagens usando templates
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const { sendTextMessage } = require('./whatsappService');

/**
 * Envia mensagem usando template do WhatsApp Business API.
 * @param {string} to - Número do destinatário
 * @param {string} templateName - Nome do template aprovado
 * @param {string} languageCode - Código do idioma (ex: 'pt_BR')
 * @param {Array} parameters - Parâmetros do template
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendTemplateMessage(to, templateName, languageCode = 'pt_BR', parameters = []) {
  try {
    const phoneNumberId = config.get('whatsapp.phoneNumberId');
    const accessToken = config.get('whatsapp.accessToken');
    
    if (!phoneNumberId || !accessToken) {
      throw new Error('Credenciais do WhatsApp não configuradas');
    }
    
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
    
    const body = {
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''), // Remove + se presente
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
      },
    };
    
    // Adiciona componentes se houver parâmetros
    if (parameters && parameters.length > 0) {
      body.template.components = [
        {
          type: 'body',
          parameters: parameters.map(param => ({
            type: typeof param === 'number' ? 'text' : 'text',
            text: String(param),
          })),
        },
      ];
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `WhatsApp API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    logger.info('[WhatsAppTemplate] Mensagem template enviada com sucesso', {
      to,
      templateName,
      messageId: data.messages?.[0]?.id,
    });
    
    return {
      success: true,
      messageId: data.messages?.[0]?.id,
    };
  } catch (error) {
    logger.error('[WhatsAppTemplate] Erro ao enviar template:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Lista templates aprovados (requer acesso à API do WhatsApp).
 * @returns {Promise<Array>}
 */
async function listTemplates() {
  try {
    const wabaId = config.get('whatsapp.wabaId'); // WhatsApp Business Account ID
    const accessToken = config.get('whatsapp.accessToken');
    
    if (!wabaId || !accessToken) {
      logger.warn('[WhatsAppTemplate] WABA ID não configurado, não é possível listar templates');
      return [];
    }
    
    const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error('[WhatsAppTemplate] Erro ao listar templates:', errorData);
      return [];
    }
    
    const data = await response.json();
    
    return data.data || [];
  } catch (error) {
    logger.error('[WhatsAppTemplate] Erro ao listar templates:', error);
    return [];
  }
}

/**
 * Valida estrutura de template antes de criar.
 * @param {Object} template
 * @returns {{valid: boolean, error?: string}}
 */
function validateTemplate(template) {
  if (!template || typeof template !== 'object') {
    return { valid: false, error: 'Template deve ser um objeto' };
  }
  
  if (!template.name || typeof template.name !== 'string') {
    return { valid: false, error: 'Nome do template é obrigatório' };
  }
  
  if (!template.language || typeof template.language !== 'string') {
    return { valid: false, error: 'Idioma do template é obrigatório' };
  }
  
  if (!template.category || !['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(template.category)) {
    return { valid: false, error: 'Categoria deve ser MARKETING, UTILITY ou AUTHENTICATION' };
  }
  
  if (!template.components || !Array.isArray(template.components)) {
    return { valid: false, error: 'Componentes do template são obrigatórios' };
  }
  
  // Valida que há pelo menos um componente BODY
  const hasBody = template.components.some(comp => comp.type === 'BODY');
  if (!hasBody) {
    return { valid: false, error: 'Template deve ter pelo menos um componente BODY' };
  }
  
  return { valid: true };
}

/**
 * Cria template no WhatsApp Business API (requer aprovação do Meta).
 * @param {Object} template
 * @returns {Promise<{success: boolean, templateId?: string, error?: string}>}
 */
async function createTemplate(template) {
  try {
    const validation = validateTemplate(template);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    const wabaId = config.get('whatsapp.wabaId');
    const accessToken = config.get('whatsapp.accessToken');
    
    if (!wabaId || !accessToken) {
      throw new Error('Credenciais do WhatsApp não configuradas');
    }
    
    const url = `https://graph.facebook.com/v18.0/${wabaId}/message_templates`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(template),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `WhatsApp API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    logger.info('[WhatsAppTemplate] Template criado com sucesso', {
      templateId: data.id,
      templateName: template.name,
    });
    
    return {
      success: true,
      templateId: data.id,
    };
  } catch (error) {
    logger.error('[WhatsAppTemplate] Erro ao criar template:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Obtém informações de um template específico.
 * @param {string} templateId
 * @returns {Promise<Object|null>}
 */
async function getTemplate(templateId) {
  try {
    const wabaId = config.get('whatsapp.wabaId');
    const accessToken = config.get('whatsapp.accessToken');
    
    if (!wabaId || !accessToken) {
      return null;
    }
    
    const url = `https://graph.facebook.com/v18.0/${templateId}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (!response.ok) {
      return null;
    }
    
    return await response.json();
  } catch (error) {
    logger.error('[WhatsAppTemplate] Erro ao obter template:', error);
    return null;
  }
}

module.exports = {
  sendTemplateMessage,
  listTemplates,
  validateTemplate,
  createTemplate,
  getTemplate,
};

