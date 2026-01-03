/**
 * Executor determinístico de fluxos.
 * 
 * Executa fluxos de forma determinística, sem IA real nem aleatoriedade.
 */

const { StateManager } = require('./stateManager');
const { MockAiProvider } = require('./mockProviders');

class FlowExecutor {
  constructor() {
    this.stateManager = new StateManager();
    this.mockAiProvider = new MockAiProvider();
    this.currentFlow = null;
    this.logs = [];
  }
  
  /**
   * Carrega um fluxo.
   * 
   * @param {object} flow - Definição do fluxo
   */
  loadFlow(flow) {
    this.currentFlow = flow;
    this.stateManager.initialize(flow.id, null);
  }
  
  /**
   * Encontra um nó por ID.
   * 
   * @param {string} nodeId - ID do nó
   * @returns {object|null} Nó encontrado
   */
  findNode(nodeId) {
    if (!this.currentFlow || !this.currentFlow.nodes) {
      return null;
    }
    return this.currentFlow.nodes.find(n => n.id === nodeId) || null;
  }
  
  /**
   * Encontra conexões de um nó.
   * 
   * @param {string} nodeId - ID do nó
   * @returns {array} Conexões do nó
   */
  findConnections(nodeId) {
    if (!this.currentFlow || !this.currentFlow.connections) {
      return [];
    }
    return this.currentFlow.connections.filter(c => c.from === nodeId) || [];
  }
  
  /**
   * Processa um nó do tipo "start".
   * 
   * @param {object} node - Nó start
   * @returns {object} Resultado do processamento
   */
  processStartNode(node) {
    this.stateManager.setCurrentNode(node.id);
    this.addLog('start', node.id, 'Iniciando fluxo');
    
    // Usa next do nó se disponível, senão usa conexões
    if (node.next) {
      return {
        nextNodeId: typeof node.next === 'string' ? node.next : node.next[0],
        output: null,
        variables: this.stateManager.getVariables()
      };
    }
    
    // Encontra próxima conexão
    const connections = this.findConnections(node.id);
    if (connections.length > 0) {
      return {
        nextNodeId: connections[0].to,
        output: null,
        variables: this.stateManager.getVariables()
      };
    }
    
    return {
      nextNodeId: null,
      output: null,
      variables: this.stateManager.getVariables()
    };
  }
  
  /**
   * Processa um nó do tipo "message".
   * 
   * @param {object} node - Nó message
   * @returns {object} Resultado do processamento
   */
  processMessageNode(node) {
    this.stateManager.setCurrentNode(node.id);
    // Suporta formato novo (config.text) e antigo (data.text)
    const message = node.config?.text || node.data?.text || '';
    this.addLog('message', node.id, message);
    
    // Usa next do nó se disponível, senão usa conexões
    if (node.next) {
      return {
        nextNodeId: typeof node.next === 'string' ? node.next : node.next[0],
        output: message,
        variables: this.stateManager.getVariables()
      };
    }
    
    // Encontra próxima conexão
    const connections = this.findConnections(node.id);
    if (connections.length > 0) {
      return {
        nextNodeId: connections[0].to,
        output: message,
        variables: this.stateManager.getVariables()
      };
    }
    
    return {
      nextNodeId: null,
      output: message,
      variables: this.stateManager.getVariables()
    };
  }
  
  /**
   * Processa um nó do tipo "userInput".
   * 
   * @param {object} node - Nó userInput
   * @param {string} userInput - Input do usuário
   * @returns {object} Resultado do processamento
   */
  processUserInputNode(node, userInput) {
    this.stateManager.setCurrentNode(node.id);
    // Suporta formato novo (config.variable) e antigo (data.variable)
    const variableName = node.config?.variable || node.data?.variable || 'userInput';
    this.stateManager.setVariable(variableName, userInput || '');
    this.addLog('userInput', node.id, userInput || '');
    
    // Usa next do nó se disponível, senão usa conexões
    if (node.next) {
      return {
        nextNodeId: typeof node.next === 'string' ? node.next : node.next[0],
        output: null,
        variables: this.stateManager.getVariables()
      };
    }
    
    // Encontra próxima conexão
    const connections = this.findConnections(node.id);
    if (connections.length > 0) {
      return {
        nextNodeId: connections[0].to,
        output: null,
        variables: this.stateManager.getVariables()
      };
    }
    
    return {
      nextNodeId: null,
      output: null,
      variables: this.stateManager.getVariables()
    };
  }
  
  /**
   * Processa um nó do tipo "router".
   * 
   * @param {object} node - Nó router
   * @returns {object} Resultado do processamento
   */
  processRouterNode(node) {
    this.stateManager.setCurrentNode(node.id);
    const variables = this.stateManager.getVariables();
    
    // Suporta formato novo: config.rules
    if (node.config && Array.isArray(node.config.rules)) {
      for (const rule of node.config.rules) {
        if (rule && rule.condition) {
          if (this.evaluateConditionObject(rule.condition, variables)) {
            this.addLog('router', node.id, `Roteando para: ${rule.next} (regra: ${JSON.stringify(rule.condition)})`);
            return {
              nextNodeId: rule.next,
              output: null,
              variables
            };
          }
        }
      }
      // Se nenhuma regra casou, usa defaultNext (campo next do nó)
      if (node.next) {
        this.addLog('router', node.id, `Roteando para: ${node.next} (default)`);
        return {
          nextNodeId: node.next,
          output: null,
          variables
        };
      }
    }
    
    // Fallback: formato antigo - conexões do fluxo com condições
    const connections = this.findConnections(node.id);
    if (connections.length > 0) {
      // Processa conexões com condições primeiro
      for (const connection of connections) {
        if (connection.condition && connection.condition !== 'default') {
          if (this.evaluateCondition(connection.condition, variables)) {
            this.addLog('router', node.id, `Roteando para: ${connection.to} (condição: ${connection.condition})`);
            return {
              nextNodeId: connection.to,
              output: null,
              variables
            };
          }
        }
      }
      // Se nenhuma condição específica passou, procura default
      for (const connection of connections) {
        if (connection.condition === 'default' || !connection.condition) {
          this.addLog('router', node.id, `Roteando para: ${connection.to} (default)`);
          return {
            nextNodeId: connection.to,
            output: null,
            variables
          };
        }
      }
    }
    
    // Fallback: usa conditions do node.data (compatibilidade)
    const conditions = node.data?.conditions || [];
    // Processa condições específicas primeiro (não-default)
    for (const condition of conditions) {
      if (condition.condition !== 'default') {
        if (this.evaluateCondition(condition.condition, variables)) {
          this.addLog('router', node.id, `Roteando para: ${condition.target}`);
          return {
            nextNodeId: condition.target,
            output: null,
            variables
          };
        }
      }
    }
    // Se nenhuma condição específica passou, procura default
    for (const condition of conditions) {
      if (condition.condition === 'default') {
        this.addLog('router', node.id, `Roteando para: ${condition.target}`);
        return {
          nextNodeId: condition.target,
          output: null,
          variables
        };
      }
    }
    
    return {
      nextNodeId: null,
      output: null,
      variables
    };
  }
  
  /**
   * Avalia uma condição no formato novo (objeto declarativo).
   * 
   * @param {object} condition - Condição no formato { op, var, value }
   * @param {object} variables - Variáveis de contexto
   * @returns {boolean} Resultado da avaliação
   */
  evaluateConditionObject(condition, variables) {
    if (!condition || typeof condition !== 'object') return false;
    
    const op = condition.op;
    if (!op) return false;
    
    if (op === 'always') {
      return true;
    }
    
    const varName = condition.var;
    if (!varName) return false;
    
    const varValue = variables[varName];
    const conditionValue = condition.value;
    
    switch (op) {
      case 'equals':
        return varValue === conditionValue;
      case 'not_equals':
        return varValue !== conditionValue;
      case 'contains':
        return String(varValue || '').toLowerCase().includes(String(conditionValue || '').toLowerCase());
      case 'not_contains':
        return !String(varValue || '').toLowerCase().includes(String(conditionValue || '').toLowerCase());
      case 'greater_than':
        return Number(varValue) > Number(conditionValue);
      case 'less_than':
        return Number(varValue) < Number(conditionValue);
      default:
        return false;
    }
  }
  
  /**
   * Avalia uma condição simples.
   * 
   * @param {string} condition - Condição a avaliar
   * @param {object} variables - Variáveis de contexto
   * @returns {boolean} Resultado da avaliação
   */
  evaluateCondition(condition, variables) {
    // Avaliação simplificada - apenas para testes determinísticos
    try {
      // Substitui variáveis na condição
      let evalCondition = condition;
      for (const [key, value] of Object.entries(variables)) {
        // Usa regex para substituir apenas a palavra completa
        const regex = new RegExp(`\\b${key}\\b`, 'g');
        // Se o valor é string, usa JSON.stringify para garantir aspas corretas
        // Isso funciona tanto com aspas simples quanto duplas na condição
        const replacement = JSON.stringify(value);
        evalCondition = evalCondition.replace(regex, replacement);
      }
      
      // Avalia condição (apenas condições simples e seguras)
      return eval(evalCondition);
    } catch (error) {
      // Em caso de erro, retorna false
      return false;
    }
  }
  
  /**
   * Processa um nó do tipo "end".
   * 
   * @param {object} node - Nó end
   * @returns {object} Resultado do processamento
   */
  processEndNode(node) {
    this.stateManager.setCurrentNode(node.id);
    this.addLog('end', node.id, 'Fluxo finalizado');
    
    return {
      nextNodeId: null,
      output: null,
      variables: this.stateManager.getVariables(),
      completed: true
    };
  }
  
  /**
   * Processa um nó genérico.
   * 
   * @param {string} nodeId - ID do nó
   * @param {string} userInput - Input do usuário (opcional)
   * @returns {object} Resultado do processamento
   */
  processNode(nodeId, userInput = null) {
    const node = this.findNode(nodeId);
    if (!node) {
      throw new Error(`Nó não encontrado: ${nodeId}`);
    }
    
    switch (node.type) {
      case 'start':
        return this.processStartNode(node);
      case 'message':
        return this.processMessageNode(node);
      case 'userInput':
      case 'user_input':
        return this.processUserInputNode(node, userInput);
      case 'router':
        return this.processRouterNode(node);
      case 'end':
        return this.processEndNode(node);
      default:
        throw new Error(`Tipo de nó não suportado: ${node.type}`);
    }
  }
  
  /**
   * Adiciona entrada ao log.
   * 
   * @param {string} type - Tipo de log
   * @param {string} nodeId - ID do nó
   * @param {string} message - Mensagem
   */
  addLog(type, nodeId, message) {
    this.logs.push({
      type,
      nodeId,
      message,
      timestamp: new Date().toISOString(),
      state: this.stateManager.getState()
    });
  }
  
  /**
   * Retorna logs.
   * 
   * @returns {array} Logs da execução
   */
  getLogs() {
    return [...this.logs];
  }
  
  /**
   * Limpa logs.
   */
  clearLogs() {
    this.logs = [];
  }
  
  /**
   * Reseta executor.
   */
  reset() {
    this.stateManager.reset();
    this.currentFlow = null;
    this.logs = [];
    this.mockAiProvider.reset();
  }
}

module.exports = { FlowExecutor };

