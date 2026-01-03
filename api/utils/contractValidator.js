/**
 * Validador de contratos JSON.
 * 
 * Valida payloads contra contratos formais definidos em contracts/.
 * Garante que a IA nunca decide usar RAG ou scraping - tudo deve vir explicitamente do formulário.
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Carrega um contrato JSON.
 * 
 * @param {string} contractPath - Caminho relativo ao contrato (ex: 'generation.interface.json')
 * @returns {Object|null} Contrato carregado ou null se não encontrado
 */
function loadContract(contractPath) {
  try {
    const fullPath = path.join(__dirname, '..', '..', 'contracts', contractPath);
    if (!fs.existsSync(fullPath)) {
      logger.warn(`Contrato não encontrado: ${contractPath}`);
      return null;
    }
    
    const content = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    logger.error(`Erro ao carregar contrato ${contractPath}:`, err);
    return null;
  }
}

/**
 * Valida um payload contra o contrato de geração.
 * 
 * @param {Object} payload - Payload a ser validado
 * @returns {{valid: boolean, errors: Array<string>}} Resultado da validação
 */
function validateGenerationContract(payload) {
  const contract = loadContract('generation.interface.json');
  if (!contract || !contract.generateFlow) {
    logger.warn('Contrato de geração não encontrado, validação básica aplicada');
    return validateBasicGenerationPayload(payload);
  }

  const errors = [];
  const inputs = contract.generateFlow.inputs;

  // Valida campos obrigatórios
  if (!payload.name || typeof payload.name !== 'string' || payload.name.trim() === '') {
    errors.push('Campo "name" é obrigatório e deve ser uma string não vazia');
  }

  if (!payload.description || typeof payload.description !== 'string' || payload.description.trim() === '') {
    errors.push('Campo "description" é obrigatório e deve ser uma string não vazia');
  }

  // Valida useRag
  if (payload.useRag !== undefined && typeof payload.useRag !== 'boolean') {
    errors.push('Campo "useRag" deve ser um boolean');
  }

  // Valida ragSources (apenas se useRag = true)
  if (payload.useRag === true) {
    if (!Array.isArray(payload.ragSources)) {
      errors.push('Campo "ragSources" deve ser um array quando useRag = true');
    } else {
      const validSources = ['flows', 'qa', 'docs'];
      const invalidSources = payload.ragSources.filter(s => !validSources.includes(s));
      if (invalidSources.length > 0) {
        errors.push(`Fontes RAG inválidas: ${invalidSources.join(', ')}. Válidas: ${validSources.join(', ')}`);
      }
      // Verifica duplicatas
      if (new Set(payload.ragSources).size !== payload.ragSources.length) {
        errors.push('Campo "ragSources" não pode conter valores duplicados');
      }
    }
  } else {
    // Se useRag = false, ragSources deve estar vazio ou não definido
    if (Array.isArray(payload.ragSources) && payload.ragSources.length > 0) {
      errors.push('Campo "ragSources" não deve ser fornecido quando useRag = false');
    }
  }

  // Valida useWebScraping
  if (payload.useWebScraping !== undefined && typeof payload.useWebScraping !== 'boolean') {
    errors.push('Campo "useWebScraping" deve ser um boolean');
  }

  // Valida scrapingTargets (apenas se useWebScraping = true)
  if (payload.useWebScraping === true) {
    if (!Array.isArray(payload.scrapingTargets)) {
      errors.push('Campo "scrapingTargets" deve ser um array quando useWebScraping = true');
    } else if (payload.scrapingTargets.length === 0) {
      errors.push('Campo "scrapingTargets" deve conter pelo menos uma URL quando useWebScraping = true');
    } else {
      // Valida URLs
      const urlPattern = /^https?:\/\/.+/;
      const invalidUrls = payload.scrapingTargets.filter(url => !urlPattern.test(url));
      if (invalidUrls.length > 0) {
        errors.push(`URLs inválidas: ${invalidUrls.join(', ')}`);
      }
    }
  } else {
    // Se useWebScraping = false, scrapingTargets deve estar vazio ou não definido
    if (Array.isArray(payload.scrapingTargets) && payload.scrapingTargets.length > 0) {
      errors.push('Campo "scrapingTargets" não deve ser fornecido quando useWebScraping = false');
    }
  }

  // Valida generateRpaTest
  if (payload.generateRpaTest !== undefined && typeof payload.generateRpaTest !== 'boolean') {
    errors.push('Campo "generateRpaTest" deve ser um boolean');
  }

  // Valida rpaMode
  if (payload.rpaMode !== undefined) {
    const validModes = ['infer', 'record', 'hybrid'];
    if (!validModes.includes(payload.rpaMode)) {
      errors.push(`Campo "rpaMode" inválido: ${payload.rpaMode}. Válidos: ${validModes.join(', ')}`);
    }
  }

  // REGRA FUNDAMENTAL: A IA NUNCA decide usar RAG ou scraping
  // Se useRag ou useWebScraping não estiverem explicitamente definidos, devem ser false
  if (payload.useRag === undefined) {
    payload.useRag = false;
  }
  if (payload.useWebScraping === undefined) {
    payload.useWebScraping = false;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validação básica quando o contrato não está disponível.
 * 
 * @param {Object} payload - Payload a ser validado
 * @returns {{valid: boolean, errors: Array<string>}} Resultado da validação
 */
function validateBasicGenerationPayload(payload) {
  const errors = [];

  if (!payload.description || typeof payload.description !== 'string' || payload.description.trim() === '') {
    errors.push('Campo "description" é obrigatório');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Valida metadata de geração.
 * 
 * @param {Object} metadata - Metadata a ser validado
 * @returns {{valid: boolean, errors: Array<string>}} Resultado da validação
 */
function validateGenerationMetadata(metadata) {
  const errors = [];

  if (!metadata.generatedAt) {
    errors.push('Metadata deve conter "generatedAt"');
  } else {
    // Valida formato ISO 8601
    const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    if (!isoPattern.test(metadata.generatedAt) && isNaN(Date.parse(metadata.generatedAt))) {
      errors.push('Campo "generatedAt" deve ser uma data ISO 8601 válida');
    }
  }

  if (!Array.isArray(metadata.sources)) {
    errors.push('Metadata deve conter "sources" como array');
  } else {
    const validSources = ['rag', 'scraping', 'none'];
    const invalidSources = metadata.sources.filter(s => !validSources.includes(s));
    if (invalidSources.length > 0) {
      errors.push(`Fontes inválidas em metadata: ${invalidSources.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  loadContract,
  validateGenerationContract,
  validateGenerationMetadata,
};

