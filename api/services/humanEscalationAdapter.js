const logger = require('../utils/logger');
/**
 * Adapter genérico de escalada humana.
 * 
 * Responsabilidades:
 * - Interface desacoplada para escalada humana
 * - Não depende de canal específico (WhatsApp, Web, etc.)
 * - Permite retorno controlado ao bot após atendimento humano
 * 
 * IMPORTANTE: Esta é apenas a INTERFACE do adapter.
 * A implementação real deve ser fornecida pelo sistema que usa a engine.
 */

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 */

/**
 * Dados necessários para escalada humana
 * 
 * @typedef {Object} HumanEscalationData
 * @property {string} sessionId - ID da sessão
 * @property {string} flowId - ID do fluxo
 * @property {string} reason - Motivo da escalada (tipo de fallback)
 * @property {number} attempt - Número da tentativa
 * @property {Array} history - Histórico da conversa
 * @property {Object<string, any>} variables - Variáveis do contexto
 * @property {string} [safeReturnNode] - Nó seguro para retorno
 * @property {Object<string, any>} [metadata] - Metadados adicionais
 */

/**
 * Resultado da escalada humana
 * 
 * @typedef {Object} HumanEscalationResult
 * @property {boolean} success - Se a escalada foi bem-sucedida
 * @property {string} [ticketId] - ID do ticket criado (se aplicável)
 * @property {string} [message] - Mensagem de confirmação
 * @property {Object<string, any>} [metadata] - Metadados adicionais
 */

/**
 * Interface do adapter de escalada humana.
 * 
 * Implementações devem fornecer:
 * - escalateToHuman(data): Promise<HumanEscalationResult>
 * - canReturnToBot(sessionId): Promise<boolean>
 * - returnToBot(sessionId, returnNodeId): Promise<boolean>
 */
class HumanEscalationAdapter {
  /**
   * Escala uma sessão para atendimento humano.
   * 
   * @param {HumanEscalationData} data - Dados da escalada
   * @returns {Promise<HumanEscalationResult>}
   */
  async escalateToHuman(data) {
    throw new Error('HumanEscalationAdapter.escalateToHuman() must be implemented');
  }

  /**
   * Verifica se uma sessão pode retornar ao bot.
   * 
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<boolean>}
   */
  async canReturnToBot(sessionId) {
    throw new Error('HumanEscalationAdapter.canReturnToBot() must be implemented');
  }

  /**
   * Retorna uma sessão ao bot após atendimento humano.
   * 
   * @param {string} sessionId - ID da sessão
   * @param {string} returnNodeId - ID do nó para retornar
   * @returns {Promise<boolean>}
   */
  async returnToBot(sessionId, returnNodeId) {
    throw new Error('HumanEscalationAdapter.returnToBot() must be implemented');
  }
}

/**
 * Adapter padrão (no-op) para desenvolvimento/testes.
 * 
 * Não faz nada, apenas retorna sucesso.
 */
class DefaultHumanEscalationAdapter extends HumanEscalationAdapter {
  async escalateToHuman(data) {
    // eslint-disable-next-line no-console
    logger.info('[HumanEscalationAdapter] Escalada simulada:', {
      sessionId: data.sessionId,
      reason: data.reason,
      attempt: data.attempt,
    });
    
    return {
      success: true,
      ticketId: `ticket_${Date.now()}`,
      message: 'Escalada para atendimento humano (simulado)',
      metadata: {
        simulated: true,
      },
    };
  }

  async canReturnToBot(sessionId) {
    return true;
  }

  async returnToBot(sessionId, returnNodeId) {
    // eslint-disable-next-line no-console
    logger.info('[HumanEscalationAdapter] Retorno ao bot:', {
      sessionId,
      returnNodeId,
    });
    return true;
  }
}

/**
 * Cria dados de escalada a partir do estado da conversa
 * 
 * @param {ConversationState} state - Estado da conversa
 * @param {string} reason - Motivo da escalada
 * @param {number} attempt - Número da tentativa
 * @param {string} [safeReturnNode] - Nó seguro para retorno
 * @returns {HumanEscalationData}
 */
function createEscalationData(state, reason, attempt, safeReturnNode = null) {
  return {
    sessionId: state.sessionId,
    flowId: state.flowId,
    reason,
    attempt,
    history: state.history || [],
    variables: state.variables || {},
    safeReturnNode,
    metadata: {
      ...(state.metadata || {}),
      escalatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  HumanEscalationAdapter,
  DefaultHumanEscalationAdapter,
  createEscalationData,
};

