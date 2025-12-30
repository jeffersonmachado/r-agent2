/**
 * Sistema centralizado de controle de fallback.
 * 
 * Responsabilidades:
 * - Receber eventos de erro (intent, flow, data, system)
 * - Controlar número de tentativas por sessão/contexto
 * - Detectar loops simples (mesmo nó acionando fallback repetidamente)
 * - Decidir próxima ação: retry, options, human, end
 * - Detectar frustração básica por palavras-chave
 * - Emitir logs estruturados de fallback
 * 
 * IMPORTANTE: Este módulo é stateless por chamada (estado via contexto).
 */

import logger from '../utils/logger';

/**
 * Tipos de fallback suportados
 */
export const FALLBACK_TYPES = {
  INTENT: 'intent',        // Intenção não reconhecida
  FLOW: 'flow',            // Erro no fluxo (nó desconectado, etc)
  DATA: 'data',            // Erro de dados (validação, formato)
  SYSTEM: 'system',        // Erro de sistema (API, timeout, etc)
  TIMEOUT: 'timeout',      // Timeout específico
  NO_MATCH: 'no_match',    // Sem correspondência (NLU)
};

/**
 * Ações de fallback possíveis
 */
export const FALLBACK_ACTIONS = {
  RETRY: 'retry',          // Tentar novamente
  OPTIONS: 'options',      // Oferecer opções ao usuário
  HUMAN: 'human',          // Escalar para humano
  END: 'end',              // Encerrar conversa
};

/**
 * Palavras-chave que indicam frustração do usuário
 */
const FRUSTRATION_KEYWORDS = [
  'não entendi',
  'não funciona',
  'erro',
  'problema',
  'ruim',
  'horrível',
  'péssimo',
  'cancelar',
  'desistir',
  'não quero',
  'não ajuda',
  'inútil',
  'burro',
  'idiota',
];

/**
 * Contexto de fallback (passado externamente, não mantido internamente)
 * 
 * @typedef {Object} FallbackContext
 * @property {string} sessionId - ID da sessão
 * @property {string} nodeId - ID do nó que acionou o fallback
 * @property {number} attempt - Número da tentativa atual (1-indexed)
 * @property {Array<{nodeId: string, timestamp: number}>} [recentFallbacks] - Histórico recente de fallbacks
 * @property {string} [userMessage] - Última mensagem do usuário (para detecção de frustração)
 */

/**
 * Configuração do FallbackNode
 * 
 * @typedef {Object} FallbackConfig
 * @property {number} maxAttempts - Máximo de tentativas (default: 3)
 * @property {number} confidenceThreshold - Threshold de confiança (default: 0.75)
 * @property {boolean} enableEmotionCheck - Habilitar detecção de frustração (default: true)
 * @property {string} [safeReturnNode] - Nó seguro para retorno após escalada humana
 */

/**
 * Detecta se o usuário está frustrado baseado na mensagem
 * 
 * @param {string} userMessage - Mensagem do usuário
 * @returns {boolean}
 */
function detectFrustration(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    return false;
  }
  
  const lowerMessage = userMessage.toLowerCase().trim();
  return FRUSTRATION_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
}

/**
 * Detecta se há loop simples (mesmo nó acionando fallback repetidamente)
 * 
 * @param {FallbackContext} context - Contexto de fallback
 * @returns {boolean}
 */
function detectLoop(context) {
  if (!context.recentFallbacks || context.recentFallbacks.length < 2) {
    return false;
  }
  
  const recent = context.recentFallbacks.slice(-3); // Últimas 3 ocorrências
  const sameNodeCount = recent.filter(f => f.nodeId === context.nodeId).length;
  
  // Se o mesmo nó acionou fallback 2+ vezes nas últimas 3 ocorrências, é loop
  return sameNodeCount >= 2;
}

/**
 * Decide a próxima ação de fallback baseado no contexto
 * 
 * @param {FALLBACK_TYPES} fallbackType - Tipo de fallback
 * @param {FallbackContext} context - Contexto de fallback
 * @param {FallbackConfig} config - Configuração do FallbackNode
 * @returns {FALLBACK_ACTIONS} Ação a ser tomada
 */
export function decideFallbackAction(fallbackType, context, config = {}) {
  const {
    maxAttempts = 3,
    enableEmotionCheck = true,
  } = config;
  
  const { attempt = 1, userMessage, recentFallbacks } = context;
  
  // 1. Detecção de loop: se detectado, escalar para humano imediatamente
  if (detectLoop(context)) {
    logger.event('fallback_loop_detected', {
      fallbackType,
      attempt,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
    });
    return FALLBACK_ACTIONS.HUMAN;
  }
  
  // 2. Detecção de frustração: se detectada, escalar para humano
  if (enableEmotionCheck && detectFrustration(userMessage)) {
    logger.event('fallback_frustration_detected', {
      fallbackType,
      attempt,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      userMessage: userMessage?.substring(0, 100), // Limita tamanho
      timestamp: new Date().toISOString(),
    });
    return FALLBACK_ACTIONS.HUMAN;
  }
  
  // 3. Máximo de tentativas atingido: escalar para humano
  if (attempt >= maxAttempts) {
    logger.event('fallback_max_attempts_reached', {
      fallbackType,
      attempt,
      maxAttempts,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
    });
    return FALLBACK_ACTIONS.HUMAN;
  }
  
  // 4. Primeira tentativa: retry
  if (attempt === 1) {
    return FALLBACK_ACTIONS.RETRY;
  }
  
  // 5. Segunda tentativa: oferecer opções
  if (attempt === 2) {
    return FALLBACK_ACTIONS.OPTIONS;
  }
  
  // 6. Terceira tentativa ou mais: escalar para humano
  return FALLBACK_ACTIONS.HUMAN;
}

/**
 * Processa um evento de fallback e retorna a decisão
 * 
 * @param {FALLBACK_TYPES} fallbackType - Tipo de fallback
 * @param {FallbackContext} context - Contexto de fallback
 * @param {FallbackConfig} config - Configuração do FallbackNode
 * @returns {Object} Resultado da decisão
 * @property {FALLBACK_ACTIONS} action - Ação a ser tomada
 * @property {Object} metadata - Metadados adicionais
 */
export function processFallback(fallbackType, context, config = {}) {
  const action = decideFallbackAction(fallbackType, context, config);
  
  // Log estruturado do fallback
  logger.event('fallback_triggered', {
    fallbackType,
    attempt: context.attempt || 1,
    nodeId: context.nodeId,
    sessionId: context.sessionId,
    action,
    timestamp: new Date().toISOString(),
    hasLoop: detectLoop(context),
    hasFrustration: detectFrustration(context.userMessage),
  });
  
  return {
    action,
    metadata: {
      fallbackType,
      attempt: context.attempt || 1,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Cria um contexto de fallback inicial
 * 
 * @param {string} sessionId - ID da sessão
 * @param {string} nodeId - ID do nó
 * @param {string} [userMessage] - Mensagem do usuário
 * @param {Array} [previousFallbacks] - Fallbacks anteriores
 * @returns {FallbackContext}
 */
export function createFallbackContext(sessionId, nodeId, userMessage = null, previousFallbacks = []) {
  // Conta tentativas para este nó específico
  const nodeAttempts = previousFallbacks.filter(f => f.nodeId === nodeId).length;
  const attempt = nodeAttempts + 1;
  
  // Mantém histórico recente (últimos 5 fallbacks)
  const recentFallbacks = [
    ...previousFallbacks.slice(-4),
    { nodeId, timestamp: Date.now() },
  ].slice(-5);
  
  return {
    sessionId,
    nodeId,
    attempt,
    recentFallbacks,
    userMessage,
  };
}

