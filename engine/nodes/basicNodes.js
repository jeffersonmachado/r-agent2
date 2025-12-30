/**
 * Handlers de nós básicos da engine.
 *
 * Alinhado ao catálogo de nodes do chatbot builder:
 * - Controle de fluxo: start, router, end
 * - Interação com usuário: message, user_input
 * - Contexto/variáveis: set_variable
 * - Handoff humano: handoff (equivalente a human_handoff)
 *
 * Importante:
 * - Nenhum handler persiste estado; apenas lê e devolve uma nova versão.
 */

const { createEngineEvent } = require('../utils');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 */

/**
 * Cria uma cópia superficial do estado da conversa.
 * Ajuda a reforçar a ideia de imutabilidade.
 *
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

const { renderTemplate } = require('../utils/templateRenderer');

/**
 * Nó "start"
 * - Ponto lógico de entrada do fluxo.
 * - Não altera o estado; serve como âncora semântica.
 */
async function startNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'start',
    },
  };

  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'NODE_START',
    }),
  );

  return result;
}

/**
 * Nó "message"
 * - Emite uma mensagem de saída para o usuário.
 * - Suporta interpolação de variáveis usando sintaxe {{variavel}}.
 *
 * config:
 * - text: string (pode conter placeholders {{variavel}})
 *
 * Exemplo:
 * - text: "Olá {{nome}}! Como posso ajudar?"
 * - Se a variável "nome" contém "João", a mensagem será: "Olá João! Como posso ajudar?"
 */
async function messageNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  const textTemplate = node.config && node.config.text ? String(node.config.text) : '';
  // Renderiza o template substituindo variáveis
  const renderedText = renderTemplate(textTemplate, nextState.variables || {});

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'message',
      text: renderedText,
    },
  };

  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'MESSAGE_OUT',
      payload: {
        text: result.output.text,
      },
    }),
  );

  return result;
}

/**
 * Nó "user_input"
 * - Representa um ponto onde esperamos input do usuário.
 * - A engine em si não bloqueia; o "mundo externo" controla
 *   quando chamar novamente a engine com o input.
 *
 * config:
 * - variable: string  (nome da variável onde o input será salvo)
 *
 * Input esperado:
 * - { text: string }
 */
async function userInputNodeHandler(node, state, input) {
  const nextState = cloneState(state);
  const variableName = node.config && node.config.variable ? String(node.config.variable) : 'user_input';
  const text = input && input.text ? String(input.text) : '';

  nextState.variables[variableName] = text;

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'user_input',
      storedAs: variableName,
      text,
    },
  };

  // Logamos a mensagem recebida
  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'MESSAGE_IN',
      payload: {
        text,
        variable: variableName,
      },
    }),
  );

  return result;
}

/**
 * Avalia uma condição simples em função das variáveis do estado.
 *
 * Decisão importante:
 * - Para manter segurança e simplicidade, evitamos eval().
 * - Implementamos um conjunto mínimo de operadores declarativos.
 *
 * Formato suportado (exemplos):
 * - { op: "always" }
 * - { op: "contains", var: "user_message", value: "suporte" }
 * - { op: "equals", var: "intent", value: "support" }
 */
function evaluateCondition(condition, state) {
  if (!condition || typeof condition !== 'object') return false;

  const op = condition.op || 'always';

  if (op === 'always') return true;

  if (op === 'contains') {
    const varName = condition.var;
    const value = condition.value;
    if (!varName) return false;
    const variableValue = String(state.variables[varName] ?? '');
    return variableValue.toLowerCase().includes(String(value ?? '').toLowerCase());
  }

  if (op === 'equals') {
    const varName = condition.var;
    if (!varName) return false;
    const variableValue = state.variables[varName];
    return variableValue === condition.value;
  }

  // Outras operações podem ser adicionadas aqui de forma segura.
  return false;
}

/**
 * Nó "router"
 * - Escolhe o próximo nó com base em regras declarativas.
 *
 * config:
 * - rules: Array<{ condition: object, next: string }>
 */
async function routerNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const rules = (node.config && Array.isArray(node.config.rules) ? node.config.rules : []);

  let chosenNext = null;

  for (const rule of rules) {
    if (evaluateCondition(rule.condition, state)) {
      chosenNext = rule.next || null;
      break;
    }
  }

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'router',
      chosenNext,
    },
  };

  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'NODE_ROUTED',
      payload: {
        chosenNext,
      },
    }),
  );

  // Atualizamos explicitamente o currentNodeId aqui?
  // Decisão: não; quem decide o próximo nó efetivo é o runner,
  // que combina "chosenNext" com o campo next padrão do nó.

  return result;
}

/**
 * Nó "handoff"
 * - Indica que a conversa deve ser transferida para atendimento humano.
 *
 * config:
 * - queue: string (nome/identificador da fila de atendimento)
 */
async function handoffNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  nextState.metadata = nextState.metadata || {};
  nextState.metadata.status = 'waiting_human';

  const queue = node.config && node.config.queue ? String(node.config.queue) : 'default';

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'handoff',
      queue,
    },
  };

  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'HANDOFF',
      payload: {
        queue,
      },
    }),
  );

  return result;
}

/**
 * Nó "set_variable"
 * - Atribui valores determinísticos a variáveis do contexto.
 *
 * config:
 * - assignments: Record<string, any>
 */
async function setVariableNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const assignments =
    node.config && typeof node.config === 'object' && node.config.assignments
      ? node.config.assignments
      : {};

  if (assignments && typeof assignments === 'object') {
    for (const [key, value] of Object.entries(assignments)) {
      nextState.variables[key] = value;
    }
  }

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'set_variable',
      changedKeys: Object.keys(assignments || {}),
    },
  };

  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'VARIABLES_SET',
      payload: {
        assignments,
      },
    }),
  );

  return result;
}

/**
 * Nó "end"
 * - Marca o fim do fluxo/conversa.
 * - currentNodeId passa a ser null.
 */
async function endNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  nextState.currentNodeId = null;

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'end',
    },
  };

  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'CONVERSATION_ENDED',
    }),
  );

  return result;
}

module.exports = {
  startNodeHandler,
  messageNodeHandler,
  userInputNodeHandler,
  routerNodeHandler,
  setVariableNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
};


