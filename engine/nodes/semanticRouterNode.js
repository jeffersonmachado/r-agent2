/**
 * Nó "semantic_router"
 *
 * Macro: ai_task(intent_classification) + roteamento por confidenceThreshold.
 *
 * Schema esperado (alto nível):
 * - inputs: texto (input.text ou variables.user_input)
 * - outputs: main | fallback  (mapeados em node.next.{main,fallback})
 * - config:
 *   - confidenceThreshold: number (default 0.6)
 *   - examples: string[] (exemplos que disparam o caminho "main")
 *
 * Observação:
 * - Não substitui ai_task/router; apenas encapsula uma combinação frequente.
 * - Para compatibilidade com ferramentas de debug, grava em variables:
 *   - ai.<nodeId>.value
 *   - ai.<nodeId>.confidence
 */
const { createEngineEvent } = require('../utils');
const { executeAiTask } = require('../utils/aiTaskExecutor');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('../flowTypes').EngineEvent} EngineEvent
 */

function cloneState(state) {
  return {
    ...state,
    variables: { ...(state.variables || {}) },
    history: Array.isArray(state.history) ? [...state.history] : [],
    metadata: state.metadata ? { ...state.metadata } : undefined,
    context: state.context ? { ...state.context } : undefined,
  };
}

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function normalizeNextTarget(nodeNext, key) {
  if (!nodeNext) return null;
  if (typeof nodeNext === 'string') return nodeNext;
  if (Array.isArray(nodeNext)) return nodeNext.length > 0 ? nodeNext[0] : null;
  if (typeof nodeNext === 'object') {
    const candidate =
      (key && nodeNext[key] != null ? nodeNext[key] : null) ??
      (nodeNext.out != null ? nodeNext.out : null) ??
      (nodeNext.default != null ? nodeNext.default : null);
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) return candidate.length > 0 ? candidate[0] : null;
  }
  return null;
}

/**
 * @param {import('../flowTypes').FlowNode} node
 * @param {ConversationState} state
 * @param {{ text?: string }} [input]
 * @param {import('../flowTypes').NodeDependencies} [deps]
 * @returns {Promise<EngineStepOutput>}
 */
async function semanticRouterNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);

  /** @type {EngineEvent[]} */
  const events = [];

  const config = node.config || {};
  const threshold =
    typeof config.confidenceThreshold === 'number' && Number.isFinite(config.confidenceThreshold)
      ? config.confidenceThreshold
      : 0.6;

  const examples = Array.isArray(config.examples)
    ? config.examples.map((x) => safeString(x).trim()).filter(Boolean).slice(0, 50)
    : [];

  // Texto de entrada: preferir input.text; senão, reaproveitar variável padrão do sistema.
  const inputText = safeString(input?.text || nextState.variables?.user_input || '').trim();

  // Construímos uma "tarefa" determinística de intent_classification para um único rótulo: "main".
  // Usamos confidenceThreshold=0.0 para NÃO deixar o executor bloquear o match internamente;
  // o roteamento final é feito aqui com o threshold configurado no semantic_router.
  const aiConfig = {
    task: 'intent_classification',
    allowedOutputs: ['main'],
    fallback: 'fallback',
    confidenceThreshold: 0.0,
    keywords: {
      main: examples,
    },
  };

  let aiResult = null;
  let confidence = 0.0;
  let route = 'fallback';

  try {
    aiResult = await executeAiTask('intent_classification', inputText, aiConfig, {
      variables: nextState.variables,
      history: nextState.history || [],
      tenantId: nextState.tenantId || null,
      tenantContext: null,
    });

    confidence = typeof aiResult?.confidence === 'number' ? aiResult.confidence : 0.0;

    // Grava no mesmo padrão do ai_task, para compatibilidade de debug.
    const outputVariable = `ai.${node.id}`;
    nextState.variables[`${outputVariable}.value`] = aiResult?.value;
    nextState.variables[`${outputVariable}.confidence`] = confidence;

    if (aiResult?.value === 'main' && confidence >= threshold) {
      route = 'main';
    } else {
      route = 'fallback';
    }
  } catch (err) {
    const errorMessage = err && err.message ? err.message : String(err);
    events.push(
      createEngineEvent('SEMANTIC_ROUTER_ERROR', {
        nodeId: node.id,
        error: errorMessage,
      }),
    );

    // Em falha, roteia para fallback (best-effort).
    const outputVariable = `ai.${node.id}`;
    nextState.variables[`${outputVariable}.value`] = null;
    nextState.variables[`${outputVariable}.confidence`] = 0.0;
    confidence = 0.0;
    route = 'fallback';
  }

  const chosenNext = normalizeNextTarget(node.next, route);

  events.push(
    createEngineEvent('SEMANTIC_ROUTER_DECISION', {
      nodeId: node.id,
      threshold,
      confidence,
      route,
      chosenNext,
    }),
  );

  // Roteamento por portas (main/fallback): o runner respeita currentNodeId quando muda.
  if (chosenNext && chosenNext !== state.currentNodeId) {
    nextState.currentNodeId = chosenNext;
  }

  return {
    nextState,
    events,
    output: {
      type: 'semantic_router',
      route,
      confidence,
      threshold,
      chosenNext,
    },
  };
}

module.exports = {
  semanticRouterNodeHandler,
};

