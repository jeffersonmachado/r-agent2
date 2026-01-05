/**
 * Sistema centralizado de controle de fallback (versão engine/CommonJS).
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
 * 
 * Compatível com: frontend/src/core/FallbackController.js (mesma lógica)
 */

/**
 * Tipos de fallback suportados
 */
const FALLBACK_TYPES = {
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
const FALLBACK_ACTIONS = {
  RETRY: 'retry',          // Tentar novamente
  OPTIONS: 'options',      // Oferecer opções ao usuário
  HUMAN: 'human',          // Escalar para humano
  END: 'end',              // Encerrar conversa
};

/**
 * Modos de escalada humana suportados
 */
const ESCALATION_MODES = {
  TICKET: 'ticket',        // Escalada assíncrona via ticket
  HUMAN: 'human',          // Escalada síncrona para humano em tempo real
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
 * Logger simples para engine (sem dependência do frontend)
 */
function logEvent(eventType, payload) {
  // Em produção, isso pode ser integrado com sistema de logging real
  // Por enquanto, apenas console.log estruturado
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log(`[FALLBACK_EVENT] ${eventType}`, JSON.stringify(payload, null, 2));
  }
}

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
 * @param {Object} context - Contexto de fallback
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
 * @param {string} fallbackType - Tipo de fallback
 * @param {Object} context - Contexto de fallback
 * @param {Object} config - Configuração do FallbackNode
 * @returns {string} Ação a ser tomada
 */
function decideFallbackAction(fallbackType, context, config = {}) {
  const {
    maxAttempts = 3,
    enableEmotionCheck = true,
  } = config;
  
  const { attempt = 1, userMessage, recentFallbacks } = context;
  
  // 1. Detecção de loop: se detectado, escalar para humano imediatamente
  if (detectLoop(context)) {
    logEvent('fallback_loop_detected', {
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
    logEvent('fallback_frustration_detected', {
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
    logEvent('fallback_max_attempts_reached', {
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
 * @param {string} fallbackType - Tipo de fallback
 * @param {Object} context - Contexto de fallback
 * @param {Object} config - Configuração do FallbackNode
 * @returns {Object} Resultado da decisão
 * @property {string} action - Ação a ser tomada
 * @property {string} escalationMode - Modo de escalada ('ticket' ou 'human')
 * @property {Object} metadata - Metadados adicionais
 */
function processFallback(fallbackType, context, config = {}) {
  const action = decideFallbackAction(fallbackType, context, config);
  
  // Determina modo de escalada (padrão: ticket)
  const escalationMode = config.escalationMode || ESCALATION_MODES.TICKET;
  
  // Valida modo de escalada
  const validModes = Object.values(ESCALATION_MODES);
  const finalEscalationMode = validModes.includes(escalationMode) 
    ? escalationMode 
    : ESCALATION_MODES.TICKET;
  
  // Log estruturado do fallback com severidade aumentada
  const severity = action === FALLBACK_ACTIONS.HUMAN ? 'HIGH' : 'MEDIUM';
  logEvent('fallback_triggered', {
    fallbackType,
    attempt: context.attempt || 1,
    nodeId: context.nodeId,
    sessionId: context.sessionId,
    action,
    escalationMode: finalEscalationMode,
    timestamp: new Date().toISOString(),
    hasLoop: detectLoop(context),
    hasFrustration: detectFrustration(context.userMessage),
    severity,
    alert: `FALLBACK_${fallbackType.toUpperCase()}_${action.toUpperCase()}`,
  });
  
  // Registra no monitoramento de fallbacks
  try {
    const { recordFallback, FALLBACK_TYPES: MONITOR_TYPES } = require('./fallbackMonitor');
    // Mapeia tipos de fallback do controller para tipos do monitor
    const monitorType = MONITOR_TYPES.AI_PROVIDER_FALLBACK; // Fallback genérico do sistema
    recordFallback(monitorType, {
      fallbackType,
      action,
      attempt: context.attempt || 1,
      nodeId: context.nodeId,
      sessionId: context.sessionId,
    });
  } catch (monitorError) {
    // Não falha se monitoramento não estiver disponível
    // eslint-disable-next-line no-console
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[FallbackController] Monitoramento não disponível', monitorError.message);
    }
  }
  
  return {
    action,
    escalationMode: finalEscalationMode,
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
 * @returns {Object} Contexto de fallback
 */
function createFallbackContext(sessionId, nodeId, userMessage = null, previousFallbacks = []) {
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

module.exports = {
  FALLBACK_TYPES,
  FALLBACK_ACTIONS,
  ESCALATION_MODES,
  processFallback,
  createFallbackContext,
  decideFallbackAction,
};

