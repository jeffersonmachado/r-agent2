/**
 * Handler de nó "ai_task".
 *
 * Responsabilidades:
 * - Executar tarefas de IA de forma controlada e determinística
 * - Não depender de APIs externas (usa implementação mock)
 * - Retornar respostas estruturadas e validáveis
 * - Suportar diferentes tipos de tarefas: intent_classification, entity_extraction, text_normalization, assisted_response
 *
 * Princípios:
 * - IA nunca decide o fluxo
 * - IA apenas produz dados estruturados
 * - O fluxo continua sendo a única autoridade de decisão
 */

const { createEngineEvent } = require('../utils');
const { executeAiTask } = require('../utils/aiTaskExecutor');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('../flowTypes').EngineEvent} EngineEvent
 */

const { SUPPORTED_TASKS } = require('../utils/aiTaskExecutor');

/**
 * Clona superficialmente o estado de conversa.
 */
function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    history: Array.isArray(state.history) ? [...state.history] : [],
    metadata: state.metadata ? { ...state.metadata } : undefined,
    context: state.context ? { ...state.context } : undefined,
  };
}

/**
 * Handler de nó "ai_task".
 *
 * Config esperada no nó:
 * - task: string (intent_classification, entity_extraction, text_normalization, assisted_response)
 * - allowedOutputs: array (para intent_classification)
 * - fallback: string (para intent_classification)
 * - confidenceThreshold: number (opcional, para intent_classification)
 * - keywords: object ou array (opcional, para intent_classification)
 *
 * Input esperado (opcional):
 * - { text?: string } - Texto de entrada do usuário
 *
 * @param {import('../flowTypes').FlowNode} node
 * @param {ConversationState} state
 * @param {{ text?: string }} [input]
 * @param {import('../flowTypes').NodeDependencies} [deps]
 * @returns {Promise<EngineStepOutput>}
 */
async function aiTaskNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);

  /** @type {EngineEvent[]} */
  const events = [];

  const config = node.config || {};
  const task = config.task;

  if (!task || typeof task !== 'string') {
    events.push(
      createEngineEvent('AI_TASK_ERROR', {
        nodeId: node.id,
        error: 'Campo "task" não encontrado ou inválido',
      }),
    );
    return {
      nextState,
      events,
      output: null,
    };
  }

  // Obtém input do contexto (geralmente do último user_input)
  const inputText = input?.text || state.variables?.user_input || '';

  try {
    const context = {
      variables: nextState.variables,
      history: nextState.history || [],
    };

    // Executa tarefa de IA
    const aiResult = await executeAiTask(task, inputText, config, context);

    // Armazena resultado no contexto
    if (!nextState.context) {
      nextState.context = {};
    }
    if (!nextState.context.ai) {
      nextState.context.ai = {};
    }
    nextState.context.ai[node.id] = aiResult;

    // Armazena resultado em variável específica baseada no tipo de tarefa
    const outputVariable = `ai.${node.id}`;
    if (task === SUPPORTED_TASKS.intent_classification) {
      nextState.variables[`${outputVariable}.value`] = aiResult.value;
      nextState.variables[`${outputVariable}.confidence`] = aiResult.confidence;
    } else if (task === SUPPORTED_TASKS.entity_extraction) {
      nextState.variables[`${outputVariable}.entities`] = aiResult.entities;
    } else if (task === SUPPORTED_TASKS.text_normalization) {
      nextState.variables[`${outputVariable}.normalized`] = aiResult.normalized;
      nextState.variables[`${outputVariable}.confidence`] = aiResult.confidence;
    } else if (task === SUPPORTED_TASKS.assisted_response) {
      nextState.variables[`${outputVariable}.response`] = aiResult.response;
      nextState.variables[`${outputVariable}.confidence`] = aiResult.confidence;
    }

    events.push(
      createEngineEvent('AI_TASK_SUCCESS', {
        nodeId: node.id,
        task,
        result: aiResult,
      }),
    );

    return {
      nextState,
      events,
      output: {
        type: 'ai_task',
        task,
        result: aiResult,
      },
    };
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    
    events.push(
      createEngineEvent('AI_TASK_ERROR', {
        nodeId: node.id,
        task,
        error: errorMessage,
      }),
    );

    // Em caso de erro, usa fallback se disponível
    const fallback = config.fallback || 'desconhecido';
    if (task === SUPPORTED_TASKS.intent_classification) {
      const outputVariable = `ai.${node.id}`;
      nextState.variables[`${outputVariable}.value`] = fallback;
      nextState.variables[`${outputVariable}.confidence`] = 0.0;
    }

    return {
      nextState,
      events,
      output: {
        type: 'ai_task',
        task,
        error: errorMessage,
        fallback: task === SUPPORTED_TASKS.intent_classification ? fallback : null,
      },
    };
  }
}

module.exports = {
  aiTaskNodeHandler,
};

