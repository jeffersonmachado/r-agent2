/**
 * Handler do nó FallbackNode.
 * 
 * Responsabilidades:
 * - Receber evento de falha
 * - Encaminhar dados para o FallbackController
 * - Executar a saída decidida (retry, options, human, end)
 * 
 * IMPORTANTE: O nó NÃO decide nada sozinho. Toda decisão vem do FallbackController.
 */

const { createEngineEvent } = require('../utils');
const {
  processFallback,
  createFallbackContext,
  FALLBACK_TYPES,
  FALLBACK_ACTIONS,
  ESCALATION_MODES,
} = require('../fallbackController');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 */

/**
 * Cria uma cópia superficial do estado da conversa.
 * 
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

/**
 * Obtém histórico de fallbacks do estado da sessão
 * 
 * @param {ConversationState} state
 * @returns {Array<{nodeId: string, timestamp: number}>}
 */
function getFallbackHistory(state) {
  if (!state.metadata || !state.metadata.fallbackHistory) {
    return [];
  }
  return Array.isArray(state.metadata.fallbackHistory) 
    ? state.metadata.fallbackHistory 
    : [];
}

/**
 * Atualiza histórico de fallbacks no estado
 * 
 * @param {ConversationState} state
 * @param {string} nodeId
 * @returns {ConversationState}
 */
function updateFallbackHistory(state, nodeId) {
  const history = getFallbackHistory(state);
  const updatedHistory = [
    ...history.slice(-4), // Mantém últimos 4
    { nodeId, timestamp: Date.now() },
  ].slice(-5); // Mantém no máximo 5
  
  const nextState = cloneState(state);
  nextState.metadata = {
    ...(nextState.metadata || {}),
    fallbackHistory: updatedHistory,
  };
  
  return nextState;
}

/**
 * Determina o tipo de fallback baseado no input e estado
 * 
 * @param {Object} input - Input do nó
 * @param {ConversationState} state - Estado da conversa
 * @returns {string} Tipo de fallback
 */
function determineFallbackType(input, state) {
  if (input && input.fallbackType) {
    return input.fallbackType;
  }
  
  // Tenta inferir do input
  if (input && input.error) {
    if (input.error.code === 'NODE_TIMEOUT' || input.error.type === 'timeout') {
      return FALLBACK_TYPES.TIMEOUT;
    }
    if (input.error.type === 'intent_error' || input.error.type === 'no_match') {
      return FALLBACK_TYPES.NO_MATCH;
    }
    if (input.error.type === 'flow_error') {
      return FALLBACK_TYPES.FLOW;
    }
    if (input.error.type === 'data_error') {
      return FALLBACK_TYPES.DATA;
    }
    return FALLBACK_TYPES.SYSTEM;
  }
  
  // Tenta inferir do estado (quando erro foi armazenado pelo runner)
  if (state && state.metadata && state.metadata.lastError) {
    const lastError = state.metadata.lastError;
    if (lastError.type === 'timeout') {
      return FALLBACK_TYPES.TIMEOUT;
    }
    if (lastError.type === 'intent_error' || lastError.type === 'no_match') {
      return FALLBACK_TYPES.NO_MATCH;
    }
    if (lastError.type === 'flow_error') {
      return FALLBACK_TYPES.FLOW;
    }
    if (lastError.type === 'data_error') {
      return FALLBACK_TYPES.DATA;
    }
    return FALLBACK_TYPES.SYSTEM;
  }
  
  // Default
  return FALLBACK_TYPES.SYSTEM;
}

/**
 * Obtém mensagem do usuário do estado ou input
 * 
 * @param {ConversationState} state
 * @param {Object} input
 * @returns {string|null}
 */
function getUserMessage(state, input) {
  if (input && input.userMessage) {
    return String(input.userMessage);
  }
  
  // Tenta obter da última mensagem do histórico
  if (state.history && Array.isArray(state.history) && state.history.length > 0) {
    const lastUserMessage = state.history
      .filter(h => h.role === 'user')
      .slice(-1)[0];
    if (lastUserMessage && lastUserMessage.text) {
      return String(lastUserMessage.text);
    }
  }
  
  return null;
}

/**
 * Handler do FallbackNode
 * 
 * @param {Object} node - Nó do fluxo
 * @param {ConversationState} state - Estado da conversa
 * @param {Object} input - Input opcional (pode conter erro, fallbackType, etc.)
 * @param {Object} deps - Dependências opcionais
 * @returns {Promise<EngineStepOutput>}
 */
async function fallbackNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  // Obtém configuração do nó
  const config = node.config || {};
  const maxAttempts = config.maxAttempts || 3;
  const enableEmotionCheck = config.enableEmotionCheck !== false;
  const safeReturnNode = config.safeReturnNode || null;
  const escalationMode = config.escalationMode || ESCALATION_MODES.TICKET;
  const allowReturnToBot = config.allowReturnToBot !== false; // Default: true
  
  // Determina tipo de fallback
  const fallbackType = determineFallbackType(input, state);
  
  // Obtém mensagem do usuário
  const userMessage = getUserMessage(state, input);
  
  // Obtém histórico de fallbacks
  const previousFallbacks = getFallbackHistory(state);
  
  // Cria contexto de fallback
  const fallbackContext = createFallbackContext(
    state.sessionId,
    node.id,
    userMessage,
    previousFallbacks
  );
  
  // Processa fallback via FallbackController
  const fallbackResult = processFallback(fallbackType, fallbackContext, {
    maxAttempts,
    enableEmotionCheck,
    escalationMode,
  });
  
  const action = fallbackResult.action;
  
  // Atualiza histórico de fallbacks
  const stateWithHistory = updateFallbackHistory(nextState, node.id);
  
  // Determina próximo nó baseado na ação
  let nextNodeId = null;
  let outputType = 'fallback';
  let outputMessage = '';
  
  // Obtém conexões do nó (retry, options, human, end)
  const nodeNext = node.next || {};
  
  switch (action) {
    case FALLBACK_ACTIONS.RETRY:
      // Retry: volta ao nó configurado ou nó anterior
      if (nodeNext.retry) {
        nextNodeId = nodeNext.retry;
      } else if (state.metadata && state.metadata.lastNodeId) {
        nextNodeId = state.metadata.lastNodeId;
      } else {
        // Se não há nó de retry configurado, tenta voltar ao início
        nextNodeId = null; // Encerra se não há como retry
      }
      outputType = 'fallback_retry';
      outputMessage = 'Tentando novamente...';
      break;
      
    case FALLBACK_ACTIONS.OPTIONS:
      // Options: oferece opções ao usuário
      nextNodeId = nodeNext.options || null;
      outputType = 'fallback_options';
      outputMessage = 'Não entendi. Por favor, escolha uma opção:';
      break;
      
    case FALLBACK_ACTIONS.HUMAN:
      // Human: escala para atendimento humano
      nextNodeId = nodeNext.human || null;
      
      // Determina tipo de output baseado no modo de escalada
      const escalationMode = fallbackResult.escalationMode || ESCALATION_MODES.TICKET;
      
      if (escalationMode === ESCALATION_MODES.TICKET) {
        // Modo ticket: escalada assíncrona
        outputType = 'handoff'; // Compatível com sistema existente
        outputMessage = 'Vou transferir você para um atendente humano. Aguarde um momento, por favor. 📞';
        
        // Adiciona informações de ticket no output
        stateWithHistory.metadata = {
          ...stateWithHistory.metadata,
          humanEscalation: {
            mode: 'ticket',
            timestamp: new Date().toISOString(),
            reason: fallbackResult.metadata.fallbackType,
            attempt: fallbackResult.metadata.attempt,
            safeReturnNode,
            allowReturnToBot,
          },
        };
      } else {
        // Modo human: escalada síncrona
        outputType = 'fallback_human_live';
        outputMessage = 'Conectando você com um atendente humano em tempo real...';
        
        // Marca escalada humana síncrona no estado
        stateWithHistory.metadata = {
          ...stateWithHistory.metadata,
          humanEscalation: {
            mode: 'human',
            timestamp: new Date().toISOString(),
            reason: fallbackResult.metadata.fallbackType,
            attempt: fallbackResult.metadata.attempt,
            safeReturnNode,
            allowReturnToBot,
          },
        };
      }
      break;
      
    case FALLBACK_ACTIONS.END:
    default:
      // End: encerra conversa
      nextNodeId = nodeNext.end || null;
      outputType = 'fallback_end';
      outputMessage = 'Desculpe, não consegui ajudar. A conversa será encerrada.';
      break;
  }
  
  // Cria eventos
  const events = [
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'FALLBACK_PROCESSED',
      payload: {
        fallbackType,
        action,
        attempt: fallbackContext.attempt,
        nextNodeId,
      },
    }),
  ];
  
  // Se escalou para humano, cria evento adicional
  if (action === FALLBACK_ACTIONS.HUMAN) {
    const escalationMode = fallbackResult.escalationMode || ESCALATION_MODES.TICKET;
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'HUMAN_ESCALATION',
        payload: {
          reason: fallbackType,
          attempt: fallbackContext.attempt,
          safeReturnNode,
          escalationMode,
          allowReturnToBot,
        },
      })
    );
  }
  
  // Atualiza currentNodeId
  const finalState = {
    ...stateWithHistory,
    currentNodeId: nextNodeId,
  };
  
  // Prepara output com informações de escalada se aplicável
  const output = {
    type: outputType,
    message: outputMessage,
    action,
    fallbackType,
    attempt: fallbackContext.attempt,
  };
  
  // Adiciona informações de escalada no output se for escalada humana
  if (action === FALLBACK_ACTIONS.HUMAN) {
    const escalationMode = fallbackResult.escalationMode || ESCALATION_MODES.TICKET;
    output.escalationMode = escalationMode;
    output.allowReturnToBot = allowReturnToBot;
    
    // Para modo ticket, adiciona queue (se configurado)
    if (escalationMode === ESCALATION_MODES.TICKET) {
      output.queue = config.queue || 'default';
    }
  }
  
  return {
    nextState: finalState,
    events,
    output,
  };
}

module.exports = {
  fallbackNodeHandler,
};

