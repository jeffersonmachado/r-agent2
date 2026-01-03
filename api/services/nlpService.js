/**
 * Serviço de Processamento de Linguagem Natural (NLP).
 * 
 * Cliente para o serviço Python NLP.
 */

const config = require('../utils/config');
const logger = require('../utils/logger');

const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || config.get('rag.serviceUrl', 'http://localhost:8000/rag');

/**
 * Analisa texto com NLP.
 * 
 * @param {string} text - Texto a analisar
 * @param {boolean} expand - Se deve expandir query
 * @returns {Promise<Object>} Resultado do NLP
 */
async function analyzeText(text, expand = true) {
  try {
    if (!text || !text.trim()) {
      throw new Error('Texto não pode ser vazio');
    }

    const url = `${RAG_SERVICE_URL}/analyze`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        expand,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Erro desconhecido' }));
      throw new Error(`Erro no serviço NLP: ${errorData.message || response.statusText}`);
    }

    const data = await response.json();
    logger.debug('[NLPService] Análise NLP concluída', { 
      intent: data.intent, 
      sentiment: data.sentiment,
      entitiesCount: Object.keys(data.entities || {}).length 
    });
    
    return data;
  } catch (error) {
    logger.error(`[NLPService] Erro ao analisar texto: ${error.message}`, error);
    throw error;
  }
}

/**
 * Normaliza texto simples (sem chamar serviço Python).
 * 
 * @param {string} text - Texto a normalizar
 * @returns {string} Texto normalizado
 */
function normalizeText(text) {
  if (!text) return '';
  
  // Remove acentos (simplificado)
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  
  return normalized;
}

/**
 * Extrai palavras-chave simples do texto.
 * 
 * @param {string} text - Texto
 * @returns {string[]} Lista de palavras-chave
 */
function extractKeywords(text) {
  if (!text) return [];
  
  const stopwords = new Set([
    'como', 'para', 'com', 'que', 'uma', 'mais', 'muito', 'sobre',
    'isso', 'quando', 'onde', 'qual', 'quais', 'este', 'esta',
    'esse', 'essa', 'aqui', 'lá', 'então', 'mas', 'por', 'porque', 'se',
    'o', 'a', 'os', 'as', 'um', 'de', 'do', 'da', 'dos', 'das',
    'em', 'no', 'na', 'nos', 'nas', 'sem'
  ]);
  
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length >= 4 && !stopwords.has(word));
  
  // Remove duplicatas
  return [...new Set(words)];
}

module.exports = {
  analyzeText,
  normalizeText,
  extractKeywords,
};

