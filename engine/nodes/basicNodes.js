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

/**
 * Nó "schedule_router"
 * - Roteia o fluxo baseado no dia da semana e horário atual.
 *
 * config:
 * - schedules: Array<{ days: number[], startTime: string, endTime: string, next: string, label?: string }>
 * - defaultNext: string (opcional, ID do nó padrão)
 * - timezone: string (opcional, fuso horário)
 */
async function scheduleRouterNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  const schedules = (node.config && Array.isArray(node.config.schedules) ? node.config.schedules : []);
  const defaultNext = node.config?.defaultNext || null;
  const timezone = node.config?.timezone || 'UTC';

  let chosenNext = null;
  let matchedSchedule = null;

  try {
    // Obtém data/hora atual considerando timezone
    const now = new Date();
    let currentDate;
    
    if (timezone !== 'UTC') {
      // Converte para o timezone especificado
      const dateStr = now.toLocaleString('en-US', { timeZone: timezone });
      currentDate = new Date(dateStr);
    } else {
      currentDate = new Date();
    }

    // Obtém dia da semana (0 = domingo, 6 = sábado)
    const currentDay = currentDate.getDay();
    
    // Obtém horário atual (HH:MM)
    const currentHours = String(currentDate.getHours()).padStart(2, '0');
    const currentMinutes = String(currentDate.getMinutes()).padStart(2, '0');
    const currentTime = `${currentHours}:${currentMinutes}`;
    
    // Converte horário atual para minutos desde meia-noite
    const [currentH, currentM] = currentTime.split(':').map(Number);
    const currentTimeMinutes = currentH * 60 + currentM;

    // Verifica cada horário configurado
    for (const schedule of schedules) {
      // Verifica se o dia atual está na lista de dias do horário
      if (!schedule.days || !Array.isArray(schedule.days) || !schedule.days.includes(currentDay)) {
        continue;
      }

      // Converte horários de início e fim para minutos
      const [startH, startM] = schedule.startTime.split(':').map(Number);
      const [endH, endM] = schedule.endTime.split(':').map(Number);
      const startTimeMinutes = startH * 60 + startM;
      const endTimeMinutes = endH * 60 + endM;

      // Verifica se o horário atual está dentro do intervalo
      if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
        chosenNext = schedule.next || null;
        matchedSchedule = schedule;
        break;
      }
    }

    // Se nenhum horário correspondeu, usa o padrão
    if (!chosenNext) {
      chosenNext = defaultNext;
    }

    /** @type {EngineStepOutput} */
    const result = {
      nextState,
      events: [],
      output: {
        type: 'schedule_router',
        chosenNext,
        matchedSchedule: matchedSchedule ? {
          label: matchedSchedule.label,
          days: matchedSchedule.days,
          startTime: matchedSchedule.startTime,
          endTime: matchedSchedule.endTime,
        } : null,
        currentDay,
        currentTime,
        timezone,
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
          scheduleType: 'schedule_router',
          matchedSchedule: matchedSchedule ? matchedSchedule.label : null,
          currentDay,
          currentTime,
          timezone,
        },
      }),
    );

    return result;
  } catch (err) {
    // Em caso de erro, usa o padrão
    chosenNext = defaultNext;

    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: err.message || String(err),
        operation: 'schedule_router',
      },
    });

    return {
      nextState,
      events: [errorEvent],
      output: {
        type: 'schedule_router',
        chosenNext,
        error: err.message || String(err),
      },
    };
  }
}

module.exports = {
  startNodeHandler,
  messageNodeHandler,
  userInputNodeHandler,
  routerNodeHandler,
  scheduleRouterNodeHandler,
  setVariableNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
};


