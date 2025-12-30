/**
 * Handler de nó de IA.
 *
 * Regras de design:
 * - IA apenas em nós explicitamente do tipo IA (este handler só é usado
 *   se o chamador registrar "ai" no NodeRegistry).
 * - OpenAI (ou qualquer outro) entra apenas como provider intercambiável,
 *   injetado via input (campo aiProvider), nunca acoplado diretamente.
 * - Output da IA é validado contra um JSON Schema simples, definido na
 *   configuração do nó (config.outputSchema).
 * - Falha de IA (erro de provider, JSON inválido, schema inválido) NUNCA
 *   quebra a execução: o handler captura erros, emite eventos de erro
 *   e devolve um output de fallback em vez de lançar exceção.
 */

const { createEngineEvent } = require('../utils');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('../flowTypes').EngineEvent} EngineEvent
 */

/**
 * Medidas de uso de IA (tipicamente tokens).
 *
 * Observação:
 * - Mantemos um modelo genérico o suficiente para ser preenchido
 *   a partir de qualquer provider (OpenAI, modelos locais, etc.).
 *
 * @typedef {Object} AiUsage
 * @property {number} [promptTokens]
 * @property {number} [completionTokens]
 * @property {number} [totalTokens]
 */

/**
 * Resultado de uma chamada de IA.
 *
 * @typedef {Object} AiResult
 * @property {string} text
 * @property {AiUsage} [usage]
 */

/**
 * Interface esperada de um provider de IA.
 *
 * OpenAI é apenas uma possível implementação deste contrato.
 *
 * generate pode retornar:
 * - string simples (texto)
 * - ou um objeto { text, usage }
 *
 * @typedef {Object} AiProvider
 * @property {(prompt: string, context: AiRequestContext) => Promise<string|AiResult>} generate
 */

/**
 * Contexto enviado ao provider de IA.
 *
 * @typedef {Object} AiRequestContext
 * @property {string} sessionId
 * @property {string} flowId
 * @property {string} nodeId
 * @property {Object<string, any>} variables
 */

/**
 * Clona superficialmente o estado de conversa, mantendo a ideia de
 * imutabilidade (não alteramos o objeto original).
 *
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    history: Array.isArray(state.history) ? [...state.history] : [],
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

const { renderTemplate } = require('../utils/templateRenderer');
const { validateJsonSchema } = require('../utils/jsonSchemaValidator');

// Alias para compatibilidade com código existente
const renderPromptTemplate = renderTemplate;

/**
 * Handler de nó "ai".
 *
 * Config esperada no nó:
 * - promptTemplate: string   (pode conter placeholders {{variavel}})
 * - outputVariable: string   (nome da variável onde o resultado estruturado será salvo)
 * - outputSchema: object     (JSON Schema simples para validação da saída)
 * - fallbackText?: string    (mensagem fallback em caso de falha)
 *
 * Input esperado (opcional):
 * - { aiProvider?: AiProvider }
 *
 * Observação:
 * - Este handler NUNCA decide o próximo nó; isso continua a cargo
 *   do runner (baseado em node.next, routers, etc.).
 *
 * @param {import('../flowTypes').FlowNode} node
 * @param {ConversationState} state
 * @param {{ aiProvider?: AiProvider }} [input]
 * @param {import('../flowTypes').NodeDependencies} [deps] - Dependências opcionais
 * @returns {Promise<EngineStepOutput>}
 */
async function aiNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);

  /** @type {EngineEvent[]} */
  const events = [];

  const config = node.config || {};
  const promptTemplate = config.promptTemplate || '';
  const outputVariable = config.outputVariable || 'ai_output';
  const outputSchema = config.outputSchema || null;
  const fallbackText = config.fallbackText || '[falha temporária ao gerar resposta automática]';

  const aiProvider = input && input.aiProvider;

  // Renderizamos o prompt final substituindo variáveis.
  const prompt = renderPromptTemplate(promptTemplate, nextState.variables || {});

  if (!aiProvider || typeof aiProvider.generate !== 'function') {
    // Sem provider de IA: não quebramos o fluxo, apenas registramos erro
    // e retornamos saída de fallback.
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'AI_ERROR',
        payload: {
          reason: 'NO_PROVIDER',
        },
      }),
    );

    const historyItem = {
      id: `${state.sessionId}-ai-${Date.now()}`,
      role: 'bot',
      type: 'message',
      text: fallbackText,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      payload: {
        aiUnavailable: true,
      },
    };
    nextState.history.push(historyItem);

    /** @type {EngineStepOutput} */
    const result = {
      nextState,
      events,
      output: {
        type: 'ai_unavailable',
        text: fallbackText,
      },
    };
    return result;
  }

  // Emitimos evento de requisição de IA (auditável).
  events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'AI_REQUESTED',
      payload: {
        prompt,
      },
    }),
  );

  let rawResponse = '';
  let parsed = null;
  let validationErrorMessages = [];
  let aiFailed = false;
  let aiErrorMessage = '';
  /** @type {AiUsage|null} */
  let aiUsage = null;

  try {
    const providerResult = await aiProvider.generate(prompt, {
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      variables: nextState.variables,
    });
    if (providerResult && typeof providerResult === 'object' && Object.prototype.hasOwnProperty.call(providerResult, 'text')) {
      rawResponse = providerResult.text != null ? String(providerResult.text) : '';
      aiUsage = providerResult.usage || null;
    } else {
      rawResponse = providerResult != null ? String(providerResult) : '';
    }

    if (outputSchema) {
      let json;
      try {
        json = JSON.parse(rawResponse);
      } catch (err) {
        aiFailed = true;
        aiErrorMessage = 'Resposta de IA não é JSON válido';
      }

      if (!aiFailed) {
        const validation = validateJsonSchema(outputSchema, json);
        if (!validation.valid) {
          aiFailed = true;
          validationErrorMessages = validation.errors;
          aiErrorMessage = 'Resposta de IA não atende ao JSON Schema definido';
        } else {
          parsed = json;
        }
      }
    } else {
      // Sem schema: consideramos a resposta como texto puro
      parsed = rawResponse;
    }
  } catch (err) {
    aiFailed = true;
    aiErrorMessage = err && err.message ? err.message : String(err);
  }

  if (aiFailed) {
    // Registramos evento de erro, mas NÃO quebramos a execução.
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'AI_ERROR',
        payload: {
          message: aiErrorMessage,
          validationErrors: validationErrorMessages,
        },
      }),
    );

    const historyItem = {
      id: `${state.sessionId}-ai-${Date.now()}`,
      role: 'bot',
      type: 'message',
      text: fallbackText,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      payload: {
        aiError: true,
        aiErrorMessage,
        validationErrors: validationErrorMessages,
      },
    };
    nextState.history.push(historyItem);

    /** @type {EngineStepOutput} */
    const result = {
      nextState,
      events,
      output: {
        type: 'ai_error',
        text: fallbackText,
      },
    };
    return result;
  }

  // Sucesso: resposta de IA válida conforme schema (se definido).
  // Atualizamos variável configurável com o resultado "parsed".
  nextState.variables[outputVariable] = parsed;

  const textForUser = typeof parsed === 'string' ? parsed : rawResponse;

  const historyItem = {
    id: `${state.sessionId}-ai-${Date.now()}`,
    role: 'bot',
    type: 'message',
    text: textForUser,
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    payload: {
      rawResponse,
    },
  };
  nextState.history.push(historyItem);

  // Evento de uso de IA (tokens/medidas), se fornecido pelo provider.
  if (aiUsage) {
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'AI_USAGE',
        payload: {
          usage: aiUsage,
        },
      }),
    );
  }

  // Também emitimos um evento de saída de mensagem para que o
  // replay de conversa consiga exibir a resposta da IA na timeline.
  events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'MESSAGE_OUT',
      payload: {
        text: textForUser,
        source: 'ai',
      },
    }),
  );

  events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'AI_RESPONSE',
      payload: {
        // Armazenamos apenas uma versão possivelmente truncada
        // para logs, evitando payloads gigantes.
        rawPreview: rawResponse.slice(0, 500),
      },
    }),
  );

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events,
    output: {
      type: 'ai',
      text: textForUser,
      variable: outputVariable,
    },
  };

  return result;
}

module.exports = {
  aiNodeHandler,
};


