/**
 * Handlers de nós que utilizam serviços de persistência.
 * 
 * Estes nós demonstram como acessar dados de flows.json, queues.json e config.json
 * durante a execução de um fluxo.
 */

const { createEngineEvent } = require('../utils');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 */

/**
 * Cria uma cópia superficial do estado da conversa.
 */
function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

/**
 * Nó "get_flow_info" - Obtém informações de outro fluxo
 * 
 * config:
 * - flowId: string (ID do fluxo a buscar)
 * - outputVariable: string (variável onde salvar o resultado, padrão: 'flow_info')
 * 
 * Exemplo de uso:
 * - Buscar informações de outro fluxo e usar em condições ou mensagens
 */
async function getFlowInfoNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  if (!deps || !deps.persistence) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'getFlowInfoNodeHandler: deps.persistence é obrigatório',
      },
    });
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'Serviços de persistência não disponíveis',
      },
    };
  }

  const flowId = node.config?.flowId;
  const outputVariable = node.config?.outputVariable || 'flow_info';

  if (!flowId || typeof flowId !== 'string') {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'flowId não especificado no config',
      },
    });
    
    nextState.variables[outputVariable] = null;
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'flowId não especificado',
      },
    };
  }

  try {
    const flow = await deps.persistence.getFlow(flowId);
    
    // Salva informações do fluxo na variável
    nextState.variables[outputVariable] = flow ? {
      id: flow.id,
      name: flow.name,
      version: flow.version,
      tenantId: flow.tenantId,
      nodeCount: flow.nodes ? flow.nodes.length : 0,
      found: true,
    } : {
      found: false,
      id: flowId,
    };

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'PERSISTENCE_ACCESS',
      payload: {
        operation: 'get_flow',
        flowId,
        found: !!flow,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'flow_info',
        flowId,
        found: !!flow,
        variable: outputVariable,
      },
    };
  } catch (err) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: err.message || String(err),
        operation: 'get_flow',
      },
    });
    
    nextState.variables[outputVariable] = { found: false, error: err.message };
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao buscar fluxo: ${err.message}`,
      },
    };
  }
}

/**
 * Nó "get_queue_status" - Obtém status de uma fila de atendimento
 * 
 * config:
 * - queueName: string (nome da fila)
 * - outputVariable: string (variável onde salvar o resultado, padrão: 'queue_status')
 * 
 * Exemplo de uso:
 * - Verificar quantos tickets estão aguardando antes de fazer handoff
 */
async function getQueueStatusNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  if (!deps || !deps.persistence) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'getQueueStatusNodeHandler: deps.persistence é obrigatório',
      },
    });
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'Serviços de persistência não disponíveis',
      },
    };
  }

  const queueName = node.config?.queueName;
  const outputVariable = node.config?.outputVariable || 'queue_status';

  if (!queueName || typeof queueName !== 'string') {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'queueName não especificado no config',
      },
    });
    
    nextState.variables[outputVariable] = null;
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'queueName não especificado',
      },
    };
  }

  try {
    const queueInfo = await deps.persistence.getQueueInfo(queueName);
    const tickets = await deps.persistence.getQueueTickets(queueName);
    
    // Salva informações da fila na variável
    nextState.variables[outputVariable] = {
      queueName,
      exists: queueInfo.exists,
      ticketCount: queueInfo.ticketCount,
      activeTickets: queueInfo.activeTickets,
      closedTickets: queueInfo.closedTickets,
      waitingTickets: tickets.filter(t => t.status === 'waiting').length,
      inProgressTickets: tickets.filter(t => t.status === 'in_progress').length,
    };

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'PERSISTENCE_ACCESS',
      payload: {
        operation: 'get_queue_status',
        queueName,
        ...nextState.variables[outputVariable],
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'queue_status',
        queueName,
        ...nextState.variables[outputVariable],
      },
    };
  } catch (err) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: err.message || String(err),
        operation: 'get_queue_status',
      },
    });
    
    nextState.variables[outputVariable] = { error: err.message };
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao buscar status da fila: ${err.message}`,
      },
    };
  }
}

/**
 * Nó "get_config_value" - Obtém um valor da configuração do sistema
 * 
 * config:
 * - configPath: string (caminho da config, ex: 'api.port' ou 'whatsapp.apiUrl')
 * - outputVariable: string (variável onde salvar o resultado, padrão: 'config_value')
 * 
 * Exemplo de uso:
 * - Usar valores de configuração em mensagens ou condições
 */
async function getConfigValueNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  if (!deps || !deps.persistence) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'getConfigValueNodeHandler: deps.persistence é obrigatório',
      },
    });
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'Serviços de persistência não disponíveis',
      },
    };
  }

  const configPath = node.config?.configPath;
  const outputVariable = node.config?.outputVariable || 'config_value';
  const defaultValue = node.config?.defaultValue;

  if (!configPath || typeof configPath !== 'string') {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'configPath não especificado no config',
      },
    });
    
    nextState.variables[outputVariable] = defaultValue !== undefined ? defaultValue : null;
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'configPath não especificado',
      },
    };
  }

  try {
    const value = await deps.persistence.getConfigValue(configPath, defaultValue);
    
    nextState.variables[outputVariable] = value;

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'PERSISTENCE_ACCESS',
      payload: {
        operation: 'get_config_value',
        configPath,
        value,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'config_value',
        configPath,
        value,
        variable: outputVariable,
      },
    };
  } catch (err) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: err.message || String(err),
        operation: 'get_config_value',
      },
    });
    
    nextState.variables[outputVariable] = defaultValue !== undefined ? defaultValue : null;
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao buscar valor de config: ${err.message}`,
      },
    };
  }
}

/**
 * Nó "list_flows" - Lista fluxos disponíveis
 * 
 * config:
 * - tenantId: string (opcional, filtrar por tenant)
 * - nameFilter: string (opcional, filtrar por nome)
 * - outputVariable: string (variável onde salvar o resultado, padrão: 'flows_list')
 * 
 * Exemplo de uso:
 * - Listar fluxos disponíveis para o usuário escolher
 */
async function listFlowsNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  if (!deps || !deps.persistence) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'listFlowsNodeHandler: deps.persistence é obrigatório',
      },
    });
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'Serviços de persistência não disponíveis',
      },
    };
  }

  const outputVariable = node.config?.outputVariable || 'flows_list';
  const criteria = {};

  if (node.config?.tenantId) {
    criteria.tenantId = node.config.tenantId;
  }
  
  if (node.config?.nameFilter) {
    criteria.name = node.config.nameFilter;
  }

  try {
    const flows = await deps.persistence.findFlows(criteria);
    
    // Salva lista simplificada de fluxos
    nextState.variables[outputVariable] = flows.map(flow => ({
      id: flow.id,
      name: flow.name,
      version: flow.version,
      tenantId: flow.tenantId,
    }));

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'PERSISTENCE_ACCESS',
      payload: {
        operation: 'list_flows',
        count: flows.length,
        criteria,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'flows_list',
        count: flows.length,
        variable: outputVariable,
      },
    };
  } catch (err) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: err.message || String(err),
        operation: 'list_flows',
      },
    });
    
    nextState.variables[outputVariable] = [];
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao listar fluxos: ${err.message}`,
      },
    };
  }
}

module.exports = {
  getFlowInfoNodeHandler,
  getQueueStatusNodeHandler,
  getConfigValueNodeHandler,
  listFlowsNodeHandler,
};


























