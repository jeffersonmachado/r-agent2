/**
 * Handlers de nós de sistema (utilitários).
 * 
 * Estes nós fornecem funcionalidades úteis do sistema como:
 * - Obter data/hora atual
 * - Gerar UUID
 * - Aguardar (delay)
 * - Formatar datas
 * - Gerar números aleatórios
 * - Obter informações do usuário
 */

const { createEngineEvent } = require('../utils');
const { v4: uuidv4 } = require('uuid');

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
 * Nó "get_current_time" - Obtém a data/hora atual
 */
async function getCurrentTimeNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const outputVariable = node.config?.outputVariable || 'current_time';
  const format = node.config?.format || 'ISO';
  const timezone = node.config?.timezone;

  try {
    const now = new Date();
    let formattedTime;

    switch (format.toUpperCase()) {
      case 'ISO':
        formattedTime = now.toISOString();
        break;
      case 'TIMESTAMP':
        formattedTime = now.getTime().toString();
        break;
      default:
        // Formato customizado usando toLocaleString
        if (timezone) {
          formattedTime = now.toLocaleString('pt-BR', {
            timeZone: timezone,
            ...parseCustomFormat(format),
          });
        } else {
          formattedTime = now.toLocaleString('pt-BR', parseCustomFormat(format));
        }
    }

    nextState.variables[outputVariable] = formattedTime;

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'SYSTEM_OPERATION',
      payload: {
        operation: 'get_current_time',
        format,
        result: formattedTime,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'current_time',
        value: formattedTime,
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
        operation: 'get_current_time',
      },
    });

    nextState.variables[outputVariable] = null;

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao obter data/hora: ${err.message}`,
      },
    };
  }
}

/**
 * Helper para parsear formato customizado
 */
function parseCustomFormat(format) {
  // Implementação simples - pode ser expandida
  const options = {};
  if (format.includes('YYYY') || format.includes('yyyy')) {
    options.year = 'numeric';
  }
  if (format.includes('MM')) {
    options.month = '2-digit';
  }
  if (format.includes('DD') || format.includes('dd')) {
    options.day = '2-digit';
  }
  if (format.includes('HH') || format.includes('hh')) {
    options.hour = '2-digit';
  }
  if (format.includes('mm')) {
    options.minute = '2-digit';
  }
  if (format.includes('ss')) {
    options.second = '2-digit';
  }
  return options;
}

/**
 * Nó "generate_uuid" - Gera um UUID único
 */
async function generateUuidNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const outputVariable = node.config?.outputVariable || 'uuid';

  try {
    const uuid = uuidv4();
    nextState.variables[outputVariable] = uuid;

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'SYSTEM_OPERATION',
      payload: {
        operation: 'generate_uuid',
        uuid,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'uuid',
        value: uuid,
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
        operation: 'generate_uuid',
      },
    });

    nextState.variables[outputVariable] = null;

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao gerar UUID: ${err.message}`,
      },
    };
  }
}

/**
 * Nó "delay" - Aguarda um tempo específico
 * 
 * IMPORTANTE: Em modo teste, o delay é virtualizado (ignorado) para garantir testes determinísticos.
 */
async function delayNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const duration = Number(node.config?.duration) || 1000;

  // Valida que o valor deve ser positivo
  if (isNaN(duration) || duration < 0) {
    const error = new Error(`Delay node "${node.id}" tem duração inválida: ${duration}ms (deve ser um número positivo).`);
    // @ts-ignore
    error.code = 'ENGINE_DELAY_INVALID_DURATION';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  if (duration > 60000) {
    const error = new Error(`Delay node "${node.id}" tem duração muito longa: ${duration}ms (máximo: 60000ms).`);
    // @ts-ignore
    error.code = 'ENGINE_DELAY_DURATION_TOO_LONG';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  // Em modo teste, virtualiza o delay (ignora o tempo real)
  const isTestMode = state.metadata && (state.metadata.testMode === true || state.metadata.mode === 'test' || state.metadata.mode === 'simulation');
  
  if (!isTestMode) {
    // Em produção, aguarda o tempo real
    try {
      await new Promise(resolve => setTimeout(resolve, duration));
    } catch (err) {
      const error = new Error(`Delay node "${node.id}" falhou ao aguardar: ${err.message}`);
      // @ts-ignore
      error.code = 'ENGINE_DELAY_EXECUTION_ERROR';
      // @ts-ignore
      error.type = 'system';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }
  }
  // Em modo teste, não aguarda nada (virtualizado)

  const successEvent = createEngineEvent({
    sessionId: state.sessionId,
    flowId: state.flowId,
    nodeId: node.id,
    type: 'SYSTEM_OPERATION',
    payload: {
      operation: 'delay',
      duration,
      virtualized: isTestMode,
    },
  });

  return {
    nextState,
    events: [successEvent],
    output: {
      type: 'delay_complete',
      duration,
      virtualized: isTestMode,
    },
  };
}

/**
 * Nó "format_date" - Formata uma data/hora
 */
async function formatDateNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const inputVariable = node.config?.inputVariable;
  const format = node.config?.format;
  const outputVariable = node.config?.outputVariable || 'formatted_date';

  if (!inputVariable || !format) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'inputVariable e format são obrigatórios',
        operation: 'format_date',
      },
    });

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'inputVariable e format são obrigatórios',
      },
    };
  }

  try {
    const inputValue = state.variables[inputVariable];
    if (!inputValue) {
      throw new Error(`Variável ${inputVariable} não encontrada ou vazia`);
    }

    const date = new Date(inputValue);
    if (isNaN(date.getTime())) {
      throw new Error(`Valor inválido para data: ${inputValue}`);
    }

    // Formatação simples - pode ser expandida
    let formatted;
    if (format === 'ISO') {
      formatted = date.toISOString();
    } else if (format === 'TIMESTAMP') {
      formatted = date.getTime().toString();
    } else {
      // Formato customizado básico
      formatted = formatDateCustom(date, format);
    }

    nextState.variables[outputVariable] = formatted;

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'SYSTEM_OPERATION',
      payload: {
        operation: 'format_date',
        inputVariable,
        format,
        result: formatted,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'formatted_date',
        value: formatted,
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
        operation: 'format_date',
      },
    });

    nextState.variables[outputVariable] = null;

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao formatar data: ${err.message}`,
      },
    };
  }
}

/**
 * Helper para formatar data customizada
 */
function formatDateCustom(date, format) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * Nó "random_number" - Gera um número aleatório
 */
async function randomNumberNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const min = Number(node.config?.min) || 0;
  const max = Number(node.config?.max);
  const outputVariable = node.config?.outputVariable || 'random_number';

  if (isNaN(max)) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'max é obrigatório e deve ser um número',
        operation: 'random_number',
      },
    });

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'max é obrigatório',
      },
    };
  }

  if (min >= max) {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: `min (${min}) deve ser menor que max (${max})`,
        operation: 'random_number',
      },
    });

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'min deve ser menor que max',
      },
    };
  }

  try {
    const random = Math.floor(Math.random() * (max - min + 1)) + min;
    nextState.variables[outputVariable] = random;

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'SYSTEM_OPERATION',
      payload: {
        operation: 'random_number',
        min,
        max,
        result: random,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'random_number',
        value: random,
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
        operation: 'random_number',
      },
    });

    nextState.variables[outputVariable] = null;

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao gerar número aleatório: ${err.message}`,
      },
    };
  }
}

/**
 * Nó "get_user_info" - Obtém informações do usuário atual
 */
async function getUserInfoNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const fields = node.config?.fields;
  const outputVariable = node.config?.outputVariable || 'user_info';

  try {
    // Obtém informações do usuário do estado ou metadata
    const userInfo = {
      phone: state.metadata?.from || state.sessionId || null,
      name: state.metadata?.userName || null,
      sessionId: state.sessionId,
      flowId: state.flowId,
    };

    // Se campos específicos foram solicitados, filtra
    let result = userInfo;
    if (fields && typeof fields === 'string') {
      const requestedFields = fields.split(',').map(f => f.trim());
      result = {};
      requestedFields.forEach(field => {
        if (userInfo[field] !== undefined) {
          result[field] = userInfo[field];
        }
      });
    }

    nextState.variables[outputVariable] = result;

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'SYSTEM_OPERATION',
      payload: {
        operation: 'get_user_info',
        fields: fields || 'all',
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'user_info',
        value: result,
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
        operation: 'get_user_info',
      },
    });

    nextState.variables[outputVariable] = null;

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro ao obter informações do usuário: ${err.message}`,
      },
    };
  }
}

module.exports = {
  getCurrentTimeNodeHandler,
  generateUuidNodeHandler,
  delayNodeHandler,
  formatDateNodeHandler,
  randomNumberNodeHandler,
  getUserInfoNodeHandler,
};

