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

  // Em modo teste, usa mock obrigatoriamente (nenhuma dependência externa permitida)
  const isTestMode = state.metadata && (state.metadata.testMode === true || state.metadata.mode === 'test' || state.metadata.mode === 'simulation');
  
  let response;
  
  try {
    if (isTestMode) {
      // Em modo teste, NUNCA faz chamada HTTP real
      // Usa MockApiProvider se disponível via deps, senão cria resposta mock padrão
      let mockProvider = null;
      if (deps && deps.apiProvider) {
        mockProvider = deps.apiProvider;
      } else {
        // Tenta carregar MockApiProvider do módulo de testes
        try {
          const { MockApiProvider } = require('../../../tests/engine/mockProviders');
          mockProvider = new MockApiProvider();
        } catch (err) {
          // Se não conseguir carregar, cria mock inline
          mockProvider = null;
        }
      }
      
      if (mockProvider && typeof mockProvider.fetch === 'function') {
        // Usa mock provider
        response = await mockProvider.fetch(renderedUrl, requestOptions);
      } else {
        // Mock padrão determinístico
        response = {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Map([['content-type', 'application/json']]),
          json: async () => ({ success: true, mocked: true, url: renderedUrl }),
          text: async () => JSON.stringify({ success: true, mocked: true, url: renderedUrl }),
        };
      }
    } else {
      // Em produção, faz chamada HTTP real
      // Cria um AbortController para timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Faz a chamada HTTP
      // Nota: fetch está disponível no Node.js 18+
      response = await fetch(renderedUrl, {
        ...requestOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
    }

    // Lê a resposta
    const contentType = response.headers && typeof response.headers.get === 'function' 
      ? response.headers.get('content-type')
      : (response.headers?.['content-type'] || 'application/json');
    let responseData;
    
    if (contentType && contentType.includes('application/json')) {
      responseData = typeof response.json === 'function' 
        ? await response.json()
        : (response.data || { success: true });
    } else {
      responseData = typeof response.text === 'function'
        ? await response.text()
        : (response.data || 'OK');
    }

    // Salva a resposta na variável
    const responseHeaders = response.headers && typeof response.headers.entries === 'function'
      ? Object.fromEntries(response.headers.entries())
      : (response.headers || {});
    
    nextState.variables[outputVariable] = {
      success: response.ok !== false,
      status: response.status || 200,
      statusText: response.statusText || 'OK',
      data: responseData,
      headers: responseHeaders,
      mocked: isTestMode,
    };

    const successEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'API_CALL',
      payload: {
        url: renderedUrl,
        method,
        status: response.status || 200,
        success: response.ok !== false,
        mocked: isTestMode,
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


