/**
 * Handler do nó "api" - Faz chamadas HTTP para APIs externas
 * 
 * config:
 * - url: string (URL da API)
 * - method: string (GET, POST, PUT, DELETE, PATCH - padrão: GET)
 * - headers: object (opcional, headers HTTP)
 * - body: string|object (opcional, corpo da requisição)
 * - outputVariable: string (variável onde salvar a resposta, padrão: 'api_response')
 * - timeout: number (timeout em ms, padrão: 10000)
 */

const { createEngineEvent } = require('../utils');
const { renderTemplate } = require('../utils/templateRenderer');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('../flowTypes').FlowNode} FlowNode
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
 * Renderiza um objeto/string substituindo variáveis
 */
function renderValue(value, variables) {
  if (typeof value === 'string') {
    return renderTemplate(value, variables);
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) {
      return value.map(item => renderValue(item, variables));
    }
    const rendered = {};
    for (const [key, val] of Object.entries(value)) {
      rendered[key] = renderValue(val, variables);
    }
    return rendered;
  }
  return value;
}

/**
 * Handler do nó de API
 */
async function apiNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  const config = node.config || {};
  const url = config.url;
  const method = (config.method || 'GET').toUpperCase();
  const headers = config.headers || {};
  const body = config.body;
  const outputVariable = config.outputVariable || 'api_response';
  const timeout = config.timeout || 10000;

  // Validação básica
  if (!url || typeof url !== 'string') {
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: 'URL não especificada no config',
        operation: 'api_call',
      },
    });
    
    nextState.variables[outputVariable] = {
      success: false,
      error: 'URL não especificada',
    };
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: 'URL não especificada',
      },
    };
  }

  // Renderiza variáveis no URL, headers e body
  const renderedUrl = renderTemplate(url, nextState.variables);
  const renderedHeaders = renderValue(headers, nextState.variables);
  const renderedBody = body ? renderValue(body, nextState.variables) : undefined;

  // Prepara a requisição
  const requestOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...renderedHeaders,
    },
  };

  // Adiciona body se necessário
  if (renderedBody !== undefined && ['POST', 'PUT', 'PATCH'].includes(method)) {
    requestOptions.body = typeof renderedBody === 'string' 
      ? renderedBody 
      : JSON.stringify(renderedBody);
  }

  try {
    // Cria um AbortController para timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Faz a chamada HTTP
    // Nota: fetch está disponível no Node.js 18+
    const response = await fetch(renderedUrl, {
      ...requestOptions,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Lê a resposta
    const contentType = response.headers.get('content-type');
    let responseData;
    
    if (contentType && contentType.includes('application/json')) {
      responseData = await response.json();
    } else {
      responseData = await response.text();
    }

    // Salva a resposta na variável
    nextState.variables[outputVariable] = {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: responseData,
      headers: Object.fromEntries(response.headers.entries()),
    };

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'API_CALL',
      payload: {
        url: renderedUrl,
        method,
        status: response.status,
        success: response.ok,
      },
    });

    return {
      nextState,
      events: [successEvent],
      output: {
        type: 'api_response',
        success: response.ok,
        status: response.status,
        data: responseData,
        variable: outputVariable,
      },
    };
  } catch (err) {
    const errorMessage = err.name === 'AbortError' 
      ? `Timeout após ${timeout}ms`
      : err.message || String(err);

    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: errorMessage,
        operation: 'api_call',
        url: renderedUrl,
        method,
      },
    });
    
    nextState.variables[outputVariable] = {
      success: false,
      error: errorMessage,
      status: null,
    };
    
    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'error',
        message: `Erro na chamada de API: ${errorMessage}`,
      },
    };
  }
}

module.exports = {
  apiNodeHandler,
};


