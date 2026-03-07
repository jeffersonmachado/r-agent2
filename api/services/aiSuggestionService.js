/**
 * Serviço de Sugestão de Resposta e Reescrita Inteligente.
 *
 * Responsabilidades:
 * - Sugerir respostas baseadas no contexto da conversa
 * - Reescrever mensagens do atendente de forma mais profissional
 * - Melhorar tom e clareza das mensagens
 */

const { generateAiResponse } = require('./aiProviderService');
const { searchByContext } = require('./quickRepliesService');
const logger = require('../utils/logger');

/**
 * Gera sugestão de resposta baseada no contexto da conversa.
 * @param {Object} context
 * @param {string} context.userMessage - Última mensagem do usuário
 * @param {Array} context.conversationHistory - Histórico da conversa
 * @param {string} [context.ticketId] - ID do ticket (opcional)
 * @param {string} [context.tenantId] - ID do tenant
 * @returns {Promise<{suggestions: string[], quickReplies: Array, confidence: number|null}>}
 */
async function suggestResponse(context) {
  const { userMessage, conversationHistory = [], ticketId, tenantId } = context;
  
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
    return {
      suggestions: [],
      quickReplies: [],
      confidence: null,
    };
  }

  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId é obrigatório');
  }
  
  try {
    // Primeiro, busca respostas rápidas relevantes
    const quickReplies = searchByContext(userMessage, tenantId, 3);
    
    // Prepara contexto para IA
    const historyText = conversationHistory
      .slice(-5) // Últimas 5 mensagens
      .map(msg => {
        const sender = msg.sender === 'user' ? 'Cliente' : 'Atendente';
        return `${sender}: ${msg.text || msg.message || ''}`;
      })
      .join('\n');
    
    const prompt = `Você é um assistente de atendimento ao cliente. Baseado na conversa abaixo, sugira 3 respostas profissionais e empáticas para o atendente usar.

Histórico da conversa:
${historyText || 'Nenhum histórico disponível'}

Última mensagem do cliente: "${userMessage}"

Gere 3 sugestões de resposta curtas (máximo 2 frases cada), uma por linha, sem numeração. As respostas devem ser:
- Profissionais e empáticas
- Diretas e objetivas
- Apropriadas para o contexto
- Em português brasileiro

Apenas as 3 sugestões, uma por linha:`;
    
    const aiResponse = await generateAiResponse(prompt, tenantId, {
      sessionId: ticketId ? `ticket_${ticketId}` : undefined,
    });
    
    // Processa resposta da IA
    let suggestions = [];
    if (aiResponse && aiResponse.text) {
      const lines = aiResponse.text
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.match(/^\d+[\.\)]/)) // Remove numeração
        .slice(0, 3); // Máximo 3 sugestões
      
      suggestions = lines;
    }
    
    return {
      suggestions,
      quickReplies: quickReplies.map(qr => ({
        id: qr.id,
        title: qr.title,
        message: qr.message,
      })),
      confidence: Number.isFinite(Number(aiResponse?.confidence)) ? Number(aiResponse.confidence) : null,
    };
  } catch (error) {
    logger.error('[AISuggestion] Erro ao gerar sugestões:', error);
    // Em caso de erro, retorna apenas respostas rápidas
    const quickReplies = searchByContext(userMessage, tenantId, 3);
    return {
      suggestions: [],
      quickReplies: quickReplies.map(qr => ({
        id: qr.id,
        title: qr.title,
        message: qr.message,
      })),
      confidence: null,
    };
  }
}

/**
 * Reescreve uma mensagem de forma mais profissional e clara.
 * @param {Object} options
 * @param {string} options.message - Mensagem original
 * @param {string} [options.tone] - Tom desejado: 'professional', 'friendly', 'formal', 'casual'
 * @param {string} [options.context] - Contexto adicional
 * @param {string} [options.tenantId] - ID do tenant
 * @returns {Promise<{original: string, rewritten: string, improvements: string[], confidence: number|null}>}
 */
async function rewriteMessage(options) {
  const { message, tone = 'professional', context = '', tenantId } = options;
  
  if (!message || typeof message !== 'string' || message.trim() === '') {
    return {
      original: message || '',
      rewritten: message || '',
      improvements: [],
      confidence: null,
    };
  }

  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('tenantId é obrigatório');
  }
  
  try {
    const toneDescriptions = {
      professional: 'profissional e respeitoso',
      friendly: 'amigável e caloroso',
      formal: 'formal e cerimonioso',
      casual: 'casual e descontraído',
    };
    
    const toneDesc = toneDescriptions[tone] || toneDescriptions.professional;
    
    const prompt = `Você é um assistente que ajuda a melhorar mensagens de atendimento ao cliente.

Mensagem original:
"${message}"

${context ? `Contexto: ${context}\n` : ''}

Reescreva esta mensagem de forma mais ${toneDesc}, mantendo o mesmo significado e intenção. A mensagem deve ser:
- Clara e objetiva
- Profissional
- Empática
- Em português brasileiro
- Com o tom ${toneDesc}

Apenas a mensagem reescrita, sem explicações adicionais:`;
    
    const aiResponse = await generateAiResponse(prompt, tenantId);
    
    let rewritten = message;
    const improvements = [];
    
    if (aiResponse && aiResponse.text) {
      rewritten = aiResponse.text.trim();
      
      // Identifica melhorias (comparação simples)
      if (rewritten.length < message.length) {
        improvements.push('Mensagem mais concisa');
      }
      if (rewritten !== message) {
        improvements.push('Tom e clareza melhorados');
      }
    }
    
    return {
      original: message,
      rewritten,
      improvements,
      confidence: Number.isFinite(Number(aiResponse?.confidence)) ? Number(aiResponse.confidence) : null,
    };
  } catch (error) {
    logger.error('[AISuggestion] Erro ao reescrever mensagem:', error);
    return {
      original: message,
      rewritten: message,
      improvements: [],
      confidence: null,
    };
  }
}

/**
 * Melhora múltiplas sugestões de uma vez.
 * @param {Object} options
 * @param {string[]} options.messages - Array de mensagens
 * @param {string} [options.tone]
 * @param {string} [options.tenantId]
 * @returns {Promise<Array>}
 */
async function rewriteMultipleMessages(options) {
  const { messages, tone = 'professional', tenantId } = options;
  
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }
  
  const results = [];
  
  // Processa uma mensagem por vez para evitar sobrecarga
  for (const message of messages) {
    try {
      const result = await rewriteMessage({ message, tone, tenantId });
      results.push(result);
      
      // Pequeno delay para evitar rate limiting
      if (messages.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    } catch (error) {
      logger.error('[AISuggestion] Erro ao reescrever mensagem individual:', error);
      results.push({
        original: message,
        rewritten: message,
        improvements: [],
      });
    }
  }
  
  return results;
}

module.exports = {
  suggestResponse,
  rewriteMessage,
  rewriteMultipleMessages,
};
