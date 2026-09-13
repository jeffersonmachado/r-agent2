const logger = require('../utils/logger');
/**
 * Adapter de atendimento humano em tempo real (síncrono).
 * 
 * Responsabilidades:
 * - Gerenciar sessões de atendimento humano síncrono
 * - Vincular sessão do bot com sessão humana
 * - Suspender execução do bot durante atendimento
 * - Permitir retorno controlado ao bot após atendimento
 * 
 * IMPORTANTE: Este é um MVP básico. A implementação real de WebSocket
 * ou integração com sistema externo deve ser feita pela camada de API.
 */

/**
 * @typedef {import('../../flowTypes').ConversationState} ConversationState
 */

/**
 * Estado de uma sessão de atendimento humano
 * 
 * @typedef {Object} HumanSession
 * @property {string} sessionId - ID da sessão do bot
 * @property {string} humanSessionId - ID da sessão humana (gerado)
 * @property {string} status - Status: 'active' | 'ended' | 'returned'
 * @property {string} createdAt - Data de criação (ISO string)
 * @property {string} [endedAt] - Data de encerramento (ISO string)
 * @property {string} [returnNodeId] - Nó para retornar após atendimento
 * @property {Object} context - Contexto da conversa no momento da escalada
 */

// Armazenamento em memória (em produção, usar Redis ou banco de dados)
/** @type {Map<string, HumanSession>} */
const humanSessions = new Map();

/**
 * Cria uma nova sessão de atendimento humano
 * 
 * @param {Object} params
 * @param {string} params.sessionId - ID da sessão do bot
 * @param {ConversationState} params.state - Estado da conversa
 * @param {string} [params.returnNodeId] - Nó para retornar após atendimento
 * @returns {HumanSession}
 */
function createHumanSession({ sessionId, state, returnNodeId = null }) {
  const humanSessionId = `human_${sessionId}_${Date.now()}`;
  const now = new Date().toISOString();
  
  const humanSession = {
    sessionId,
    humanSessionId,
    status: 'active',
    createdAt: now,
    returnNodeId,
    context: {
      flowId: state.flowId,
      variables: { ...state.variables },
      history: state.history ? [...state.history] : [],
      metadata: state.metadata ? { ...state.metadata } : {},
    },
  };
  
  humanSessions.set(sessionId, humanSession);
  
  // eslint-disable-next-line no-console
  logger.info(`[HumanLiveAdapter] Sessão humana criada: ${humanSessionId} para sessão ${sessionId}`);
  
  return humanSession;
}

/**
 * Obtém sessão humana ativa por sessionId
 * 
 * @param {string} sessionId - ID da sessão do bot
 * @returns {HumanSession|null}
 */
function getHumanSession(sessionId) {
  const session = humanSessions.get(sessionId);
  if (!session || session.status !== 'active') {
    return null;
  }
  return session;
}

/**
 * Verifica se uma sessão está em atendimento humano ativo
 * 
 * @param {string} sessionId - ID da sessão do bot
 * @returns {boolean}
 */
function isInHumanSession(sessionId) {
  const session = getHumanSession(sessionId);
  return session !== null;
}

/**
 * Encerra uma sessão de atendimento humano
 * 
 * @param {string} sessionId - ID da sessão do bot
 * @param {Object} [options]
 * @param {boolean} [options.returnToBot] - Se true, marca para retornar ao bot
 * @returns {HumanSession|null}
 */
function endHumanSession(sessionId, options = {}) {
  const session = humanSessions.get(sessionId);
  if (!session) {
    return null;
  }
  
  session.status = options.returnToBot ? 'returned' : 'ended';
  session.endedAt = new Date().toISOString();
  
  // eslint-disable-next-line no-console
  logger.info(`[HumanLiveAdapter] Sessão humana encerrada: ${session.humanSessionId} (status: ${session.status})`);
  
  return session;
}

/**
 * Remove sessão humana (limpeza)
 * 
 * @param {string} sessionId - ID da sessão do bot
 * @returns {boolean}
 */
function removeHumanSession(sessionId) {
  return humanSessions.delete(sessionId);
}

/**
 * Obtém todas as sessões humanas ativas
 * 
 * @returns {HumanSession[]}
 */
function getActiveHumanSessions() {
  return Array.from(humanSessions.values()).filter(s => s.status === 'active');
}

/**
 * Limpa sessões humanas antigas (mais de 24 horas)
 * 
 * @param {number} maxAgeHours - Idade máxima em horas (padrão: 24)
 * @returns {number} Número de sessões removidas
 */
function cleanupOldSessions(maxAgeHours = 24) {
  const now = Date.now();
  const maxAge = maxAgeHours * 60 * 60 * 1000;
  let cleaned = 0;
  
  for (const [sessionId, session] of humanSessions.entries()) {
    const sessionAge = now - new Date(session.createdAt).getTime();
    if (sessionAge > maxAge && session.status !== 'active') {
      humanSessions.delete(sessionId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    // eslint-disable-next-line no-console
    logger.info(`[HumanLiveAdapter] Limpeza: ${cleaned} sessão(ões) antiga(s) removida(s)`);
  }
  
  return cleaned;
}

module.exports = {
  createHumanSession,
  getHumanSession,
  isInHumanSession,
  endHumanSession,
  removeHumanSession,
  getActiveHumanSessions,
  cleanupOldSessions,
};

