/**
 * Validador de Capacidades (CDR - Capability-Driven Responses)
 * 
 * Garante que respostas do chatbot estejam limitadas às capacidades
 * explicitamente declaradas em capabilities.json.
 * 
 * Regra Fundamental: O chatbot NUNCA deve responder como se fosse capaz
 * de executar uma ação que não esteja explicitamente declarada e implementada.
 */

const fs = require('fs');
const path = require('path');

let capabilitiesCache = null;

/**
 * Carrega o arquivo de capacidades
 * @returns {Object|null} Objeto de capacidades ou null se não encontrado
 */
function loadCapabilities() {
  if (capabilitiesCache) {
    return capabilitiesCache;
  }

  try {
    const capabilitiesPath = path.join(__dirname, '../../capabilities.json');
    const capabilitiesContent = fs.readFileSync(capabilitiesPath, 'utf8');
    capabilitiesCache = JSON.parse(capabilitiesContent);
    return capabilitiesCache;
  } catch (error) {
    console.error('[capabilityValidator] Erro ao carregar capabilities.json:', error.message);
    return null;
  }
}

/**
 * Verifica se uma capacidade existe e está ativa
 * @param {string} capabilityId - ID da capacidade
 * @returns {boolean} True se a capacidade existe e está ativa
 */
function hasCapability(capabilityId) {
  const capabilities = loadCapabilities();
  if (!capabilities || !capabilities.capabilities) {
    return false;
  }

  const capability = capabilities.capabilities[capabilityId];
  return capability && capability.status === 'active';
}

/**
 * Obtém informações sobre uma capacidade
 * @param {string} capabilityId - ID da capacidade
 * @returns {Object|null} Informações da capacidade ou null
 */
function getCapability(capabilityId) {
  const capabilities = loadCapabilities();
  if (!capabilities || !capabilities.capabilities) {
    return null;
  }

  return capabilities.capabilities[capabilityId] || null;
}

/**
 * Lista todas as capacidades ativas
 * @returns {Array<Object>} Lista de capacidades ativas
 */
function listActiveCapabilities() {
  const capabilities = loadCapabilities();
  if (!capabilities || !capabilities.capabilities) {
    return [];
  }

  return Object.values(capabilities.capabilities)
    .filter(cap => cap.status === 'active')
    .map(cap => ({
      id: cap.id,
      name: cap.name,
      description: cap.description
    }));
}

/**
 * Verifica se uma resposta contém frases proibidas
 * @param {string} response - Texto da resposta
 * @returns {Object} { hasProhibited: boolean, phrases: string[] }
 */
function checkProhibitedPhrases(response) {
  const capabilities = loadCapabilities();
  if (!capabilities || !capabilities.responsePatterns) {
    return { hasProhibited: false, phrases: [] };
  }

  const prohibitedPhrases = capabilities.responsePatterns.prohibitedPhrases || [];
  const responseLower = response.toLowerCase();
  const foundPhrases = prohibitedPhrases.filter(phrase => 
    responseLower.includes(phrase.toLowerCase())
  );

  return {
    hasProhibited: foundPhrases.length > 0,
    phrases: foundPhrases
  };
}

/**
 * Valida se uma resposta está dentro das capacidades permitidas
 * @param {string} response - Texto da resposta a validar
 * @param {string} [context] - Contexto opcional (ex: "ai_response", "flow_generation")
 * @returns {Object} { valid: boolean, errors: string[], warnings: string[] }
 */
function validateResponse(response, context = null) {
  const errors = [];
  const warnings = [];

  if (!response || typeof response !== 'string') {
    return {
      valid: false,
      errors: ['Resposta deve ser uma string não vazia'],
      warnings: []
    };
  }

  // Verifica frases proibidas
  const prohibitedCheck = checkProhibitedPhrases(response);
  if (prohibitedCheck.hasProhibited) {
    errors.push(
      `Resposta contém frases proibidas: ${prohibitedCheck.phrases.join(', ')}. ` +
      'O chatbot não deve prometer ações que não pode executar.'
    );
  }

  // Validações específicas por contexto
  if (context === 'ai_response') {
    // Validações específicas para respostas de IA
    // Por exemplo, verificar se não promete ações externas
    const externalActionPatterns = [
      /vou (abrir|criar|solicitar|encaminhar|verificar)/i,
      /já (estou|foi|será)/i,
      /em breve/i,
      /será feito/i
    ];

    externalActionPatterns.forEach(pattern => {
      if (pattern.test(response)) {
        warnings.push(
          'Resposta pode estar prometendo ações que não podem ser executadas automaticamente.'
        );
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Gera mensagem de negação padrão quando uma capacidade não existe
 * @param {string} requestedAction - Ação solicitada
 * @param {string[]} [availableAlternatives] - Alternativas disponíveis
 * @returns {string} Mensagem de negação formatada
 */
function generateDenialMessage(requestedAction, availableAlternatives = null) {
  const capabilities = loadCapabilities();
  const template = capabilities?.responsePatterns?.denial?.template || 
    'No momento, eu não tenho a capacidade de executar essa ação. {availableAlternatives}';
  
  const defaultAlternatives = capabilities?.responsePatterns?.denial?.availableAlternatives ||
    'Posso ajudar consultando informações disponíveis ou explicando como o processo funciona.';

  const alternatives = availableAlternatives && availableAlternatives.length > 0
    ? availableAlternatives.join(' ')
    : defaultAlternatives;

  return template.replace('{availableAlternatives}', alternatives);
}

/**
 * Verifica se uma ação específica está dentro das capacidades
 * @param {string} action - Ação a verificar (ex: "criar_ticket", "consultar_banco")
 * @returns {Object} { allowed: boolean, capability?: string, reason?: string }
 */
function checkActionAllowed(action) {
  const capabilities = loadCapabilities();
  if (!capabilities || !capabilities.capabilities) {
    return {
      allowed: false,
      reason: 'Sistema de capacidades não disponível'
    };
  }

  // Mapeamento de ações para capacidades
  const actionToCapability = {
    'criar_ticket': 'human_handoff',
    'transferir_humano': 'human_handoff',
    'consultar_fila': 'queue_management',
    'gerar_fluxo': 'flow_generation',
    'executar_fluxo': 'flow_execution',
    'processar_ia': 'ai_processing',
    'consultar_rag': 'rag_integration',
    'classificar_intencao': 'ai_tasks',
    'extrair_entidades': 'ai_tasks',
    'chamar_api': 'external_apis',
    'enviar_whatsapp': 'whatsapp_integration',
    'enviar_messenger': 'messenger_integration',
    'enviar_instagram': 'instagram_integration',
    'consultar_fluxos': 'persistence',
    'consultar_config': 'persistence'
  };

  const capabilityId = actionToCapability[action];
  if (!capabilityId) {
    return {
      allowed: false,
      reason: `Ação "${action}" não está mapeada para nenhuma capacidade`
    };
  }

  const capability = capabilities.capabilities[capabilityId];
  if (!capability) {
    return {
      allowed: false,
      reason: `Capacidade "${capabilityId}" não encontrada`
    };
  }

  if (capability.status !== 'active') {
    return {
      allowed: false,
      capability: capabilityId,
      reason: `Capacidade "${capabilityId}" não está ativa`
    };
  }

  return {
    allowed: true,
    capability: capabilityId,
    capabilityInfo: capability
  };
}

/**
 * Limpa o cache de capacidades (útil para testes ou reload)
 */
function clearCache() {
  capabilitiesCache = null;
}

module.exports = {
  loadCapabilities,
  hasCapability,
  getCapability,
  listActiveCapabilities,
  checkProhibitedPhrases,
  validateResponse,
  generateDenialMessage,
  checkActionAllowed,
  clearCache
};

