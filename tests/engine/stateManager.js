/**
 * Gerenciador de estado da conversa.
 * 
 * Mantém estado previsível e determinístico da conversa.
 */

class StateManager {
  constructor() {
    this.state = {
      currentNode: null,
      variables: {},
      history: [],
      sessionId: null,
      flowId: null,
      startedAt: null
    };
  }
  
  /**
   * Inicializa estado para uma nova conversa.
   * 
   * @param {string} flowId - ID do fluxo
   * @param {string} sessionId - ID da sessão
   */
  initialize(flowId, sessionId) {
    this.state = {
      currentNode: null,
      variables: {},
      history: [],
      sessionId: sessionId || this.generateSessionId(flowId),
      flowId,
      startedAt: new Date().toISOString()
    };
  }
  
  /**
   * Gera ID de sessão determinístico.
   * 
   * @param {string} flowId - ID do fluxo
   * @returns {string} ID de sessão
   */
  generateSessionId(flowId) {
    // ID determinístico baseado no flowId e timestamp fixo
    return `test-session-${flowId}-${Date.now()}`;
  }
  
  /**
   * Define nó atual.
   * 
   * @param {string} nodeId - ID do nó
   */
  setCurrentNode(nodeId) {
    this.state.currentNode = nodeId;
  }
  
  /**
   * Retorna nó atual.
   * 
   * @returns {string|null} ID do nó atual
   */
  getCurrentNode() {
    return this.state.currentNode;
  }
  
  /**
   * Define variável de contexto.
   * 
   * @param {string} name - Nome da variável
   * @param {any} value - Valor da variável
   */
  setVariable(name, value) {
    this.state.variables[name] = value;
  }
  
  /**
   * Obtém variável de contexto.
   * 
   * @param {string} name - Nome da variável
   * @returns {any} Valor da variável
   */
  getVariable(name) {
    return this.state.variables[name];
  }
  
  /**
   * Obtém todas as variáveis.
   * 
   * @returns {object} Todas as variáveis
   */
  getVariables() {
    return { ...this.state.variables };
  }
  
  /**
   * Adiciona entrada ao histórico.
   * 
   * @param {object} entry - Entrada do histórico
   */
  addHistoryEntry(entry) {
    this.state.history.push({
      ...entry,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Retorna histórico completo.
   * 
   * @returns {array} Histórico da conversa
   */
  getHistory() {
    return [...this.state.history];
  }
  
  /**
   * Retorna estado completo.
   * 
   * @returns {object} Estado completo
   */
  getState() {
    return {
      ...this.state,
      variables: { ...this.state.variables },
      history: [...this.state.history]
    };
  }
  
  /**
   * Reseta estado.
   */
  reset() {
    this.state = {
      currentNode: null,
      variables: {},
      history: [],
      sessionId: null,
      flowId: null,
      startedAt: null
    };
  }
}

module.exports = { StateManager };










