/**
 * Validador de payload para criação de fluxo e geração de teste RPA por IA.
 * Baseado no schema JSON fornecido.
 * 
 * Schema de referência:
 * {
 *   "$schema": "http://json-schema.org/draft-07/schema#",
 *   "type": "object",
 *   "required": ["name", "description"],
 *   "properties": {
 *     "name": { "type": "string", "minLength": 3 },
 *     "description": { "type": "string", "minLength": 10 },
 *     "useRag": { "type": "boolean" },
 *     "ragSources": {
 *       "type": "array",
 *       "items": { "enum": ["flows", "qa", "docs"] },
 *       "minItems": 1
 *     },
 *     "useWebScraping": { "type": "boolean" },
 *     "scrapingTargets": {
 *       "type": "array",
 *       "items": { "type": "string", "format": "uri" },
 *       "minItems": 1
 *     },
 *     "generateRpaTest": { "type": "boolean" },
 *     "rpaMode": { "enum": ["record", "infer", "hybrid"] }
 *   },
 *   "allOf": [
 *     {
 *       "if": { "properties": { "useRag": { "const": true } } },
 *       "then": { "required": ["ragSources"] }
 *     },
 *     {
 *       "if": { "properties": { "useWebScraping": { "const": true } } },
 *       "then": { "required": ["scrapingTargets"] }
 *     }
 *   ]
 * }
 */

/**
 * Valida um payload de criação de fluxo e geração de teste RPA.
 * 
 * @param {Object} payload - O payload a ser validado
 * @returns {Object} - { valid: boolean, errors: Object }
 */
export function validateFlowRpaPayload(payload) {
  const errors = {};

  // Validação de campos obrigatórios
  if (!payload.name || typeof payload.name !== 'string') {
    errors.name = 'Nome do fluxo é obrigatório e deve ser uma string';
  } else if (payload.name.trim().length < 3) {
    errors.name = 'Nome do fluxo deve ter pelo menos 3 caracteres';
  }

  if (!payload.description || typeof payload.description !== 'string') {
    errors.description = 'Descrição é obrigatória e deve ser uma string';
  } else if (payload.description.trim().length < 10) {
    errors.description = 'Descrição deve ter pelo menos 10 caracteres';
  }

  // Validação de useRag
  if (payload.useRag !== undefined && typeof payload.useRag !== 'boolean') {
    errors.useRag = 'useRag deve ser um booleano';
  }

  // Validação de ragSources (obrigatório se useRag for true)
  if (payload.useRag === true) {
    if (!Array.isArray(payload.ragSources)) {
      errors.ragSources = 'ragSources deve ser um array quando useRag é true';
    } else if (payload.ragSources.length === 0) {
      errors.ragSources = 'Pelo menos uma fonte RAG deve ser selecionada';
    } else {
      const validSources = ['flows', 'qa', 'docs'];
      const invalidSources = payload.ragSources.filter(
        source => !validSources.includes(source)
      );
      if (invalidSources.length > 0) {
        errors.ragSources = `Fontes inválidas: ${invalidSources.join(', ')}. Valores permitidos: ${validSources.join(', ')}`;
      }
    }
  }

  // Validação de useWebScraping
  if (payload.useWebScraping !== undefined && typeof payload.useWebScraping !== 'boolean') {
    errors.useWebScraping = 'useWebScraping deve ser um booleano';
  }

  // Validação de scrapingTargets (obrigatório se useWebScraping for true)
  if (payload.useWebScraping === true) {
    if (!Array.isArray(payload.scrapingTargets)) {
      errors.scrapingTargets = 'scrapingTargets deve ser um array quando useWebScraping é true';
    } else if (payload.scrapingTargets.length === 0) {
      errors.scrapingTargets = 'Pelo menos uma URL deve ser fornecida';
    } else {
      const invalidUrls = [];
      payload.scrapingTargets.forEach((url, index) => {
        if (typeof url !== 'string' || !url.trim()) {
          invalidUrls.push(`URL ${index + 1} está vazia`);
        } else {
          try {
            new URL(url.trim());
          } catch {
            invalidUrls.push(`URL ${index + 1} é inválida: ${url}`);
          }
        }
      });
      if (invalidUrls.length > 0) {
        errors.scrapingTargets = invalidUrls.join('; ');
      }
    }
  }

  // Validação de generateRpaTest
  if (payload.generateRpaTest !== undefined && typeof payload.generateRpaTest !== 'boolean') {
    errors.generateRpaTest = 'generateRpaTest deve ser um booleano';
  }

  // Validação de rpaMode (obrigatório se generateRpaTest for true)
  if (payload.generateRpaTest === true) {
    if (!payload.rpaMode) {
      errors.rpaMode = 'rpaMode é obrigatório quando generateRpaTest é true';
    } else {
      const validModes = ['record', 'infer', 'hybrid'];
      if (!validModes.includes(payload.rpaMode)) {
        errors.rpaMode = `Modo inválido: ${payload.rpaMode}. Valores permitidos: ${validModes.join(', ')}`;
      }
    }
  }

  // Validação global: pelo menos uma fonte de conhecimento deve estar ativa
  if (payload.useRag !== true && payload.useWebScraping !== true) {
    errors._global = 'Pelo menos uma fonte de conhecimento deve estar ativa (useRag ou useWebScraping)';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Valida uma URL individual.
 * 
 * @param {string} url - A URL a ser validada
 * @returns {boolean} - true se a URL for válida
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return false;
  }
  try {
    new URL(url.trim());
    return true;
  } catch {
    return false;
  }
}

