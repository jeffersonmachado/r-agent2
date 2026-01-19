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
 * - Marca início explícito do fluxo.
 */
async function startNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  // Valida que start tem next definido
  const hasValidNext =
    typeof node.next === 'string' ||
    Array.isArray(node.next) ||
    (node.next && typeof node.next === 'object' && (node.next.out || Object.keys(node.next).length > 0));

  if (!node.next || !hasValidNext) {
    const error = new Error(`Start node "${node.id}" deve ter um campo "next" apontando para o próximo nó.`);
    // @ts-ignore
    error.code = 'ENGINE_START_MISSING_NEXT';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  // Marca início explícito do fluxo
  nextState.metadata = nextState.metadata || {};
  nextState.metadata.flowStarted = true;
  nextState.metadata.flowStartTime = new Date().toISOString();

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
      payload: {
        flowStarted: true,
      },
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
  
  // Valida configuração
  if (!node.config || typeof node.config !== 'object' || !node.config.text || typeof node.config.text !== 'string' || node.config.text.trim() === '') {
    const error = new Error(`Message node "${node.id}" deve ter "config.text" não vazio.`);
    // @ts-ignore
    error.code = 'ENGINE_MESSAGE_EMPTY_TEXT';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  const textTemplate = String(node.config.text);
  
  // Renderiza o template substituindo variáveis
  let renderedText;
  const warnings = [];
  
  try {
    renderedText = renderTemplate(textTemplate, nextState.variables || {});
    
    // Detecta variáveis não definidas (warnings)
    const varMatches = textTemplate.match(/\{\{(\w+)\}\}/g);
    if (varMatches) {
      for (const match of varMatches) {
        const varName = match.replace(/\{\{|\}\}/g, '');
        if (!nextState.variables || !nextState.variables.hasOwnProperty(varName)) {
          warnings.push(`Variável "${varName}" não está definida no contexto.`);
        }
      }
    }
  } catch (err) {
    // Erro na renderização - lança erro explícito
    const error = new Error(`Message node "${node.id}" falhou ao renderizar template: ${err.message}`);
    // @ts-ignore
    error.code = 'ENGINE_MESSAGE_RENDER_ERROR';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    // @ts-ignore
    error.originalError = err.message;
    throw error;
  }

  // Valida que texto renderizado não está vazio
  if (!renderedText || renderedText.trim() === '') {
    const error = new Error(`Message node "${node.id}" renderizou texto vazio.`);
    // @ts-ignore
    error.code = 'ENGINE_MESSAGE_EMPTY_RENDERED';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

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
        warnings: warnings.length > 0 ? warnings : undefined,
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
 * - expectedType: string (opcional: 'string', 'number', 'intent')
 * - defaultValue: any (opcional: valor padrão para testes)
 *
 * Input esperado:
 * - { text: string }
 */
async function userInputNodeHandler(node, state, input) {
  const nextState = cloneState(state);
  
  // Valida configuração
  if (!node.config || typeof node.config !== 'object' || !node.config.variable || typeof node.config.variable !== 'string' || node.config.variable.trim() === '') {
    const error = new Error(`User input node "${node.id}" deve ter "config.variable" válido.`);
    // @ts-ignore
    error.code = 'ENGINE_USER_INPUT_INVALID_CONFIG';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  const variableName = node.config.variable;
  const expectedType = node.config.expectedType;
  const defaultValue = node.config.defaultValue;
  
  // Em modo teste, usa valor padrão se fornecido e input não disponível
  const isTestMode = state.metadata && state.metadata.testMode === true;
  let text = '';
  const files = input?.files || [];
  
  if (input && input.text !== undefined && input.text !== null) {
    text = String(input.text);
  } else if (isTestMode && defaultValue !== undefined) {
    text = String(defaultValue);
  } else if (!input || (!input.text && files.length === 0)) {
    // Em runtime normal, erro se input não foi capturado (mas permite apenas arquivos)
    const error = new Error(`User input node "${node.id}" não recebeu input do usuário.`);
    // @ts-ignore
    error.code = 'ENGINE_USER_INPUT_MISSING';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  // Processa arquivos se houver
  let enhancedText = text;
  if (files.length > 0) {
    // Salva arquivos no estado para uso posterior
    nextState.variables = nextState.variables || {};
    nextState.variables.lastFiles = files;
    
    // Indexa arquivos no RAG se configurado
    const autoIndexFiles = node.config?.autoIndexFiles !== false; // true por padrão
    if (autoIndexFiles) {
      try {
        const { indexFilesInRag } = require('../services/fileRagService');
        const tenantId = state.tenantId || 'demo-tenant';
        
        // Indexa em background (não bloqueia)
        indexFilesInRag(files, tenantId, {
          category: 'chat_upload',
          metadata: {
            sessionId: state.sessionId,
            flowId: state.flowId,
            nodeId: node.id,
          },
        }).catch((indexError) => {
          // Loga erro mas não falha o processamento
          const logger = require('../../api/utils/logger');
          logger.warn('Erro ao indexar arquivos no RAG (não bloqueante)', {
            error: indexError.message,
            filesCount: files.length,
          });
        });
      } catch (requireError) {
        // Se o serviço não estiver disponível, continua sem indexar
        const logger = require('../../api/utils/logger');
        logger.debug('Serviço de indexação RAG não disponível', {
          error: requireError.message,
        });
      }
    }
    
    // Extrai texto dos arquivos para contexto
    const filesText = files
      .map(f => {
        if (f.content && !f.content.startsWith('[')) {
          return `[Arquivo: ${f.name}]\n${f.content}`;
        }
        return `[Arquivo: ${f.name}]`;
      })
      .join('\n\n');
    
    // Adiciona conteúdo dos arquivos ao texto do usuário
    if (text) {
      enhancedText = `${text}\n\n[Arquivos anexados]:\n${filesText}`;
    } else {
      enhancedText = `[Arquivos anexados]:\n${filesText}`;
    }
  }

  // Valida tipo se esperado (apenas para texto, não para arquivos)
  if (expectedType && text) {
    if (expectedType === 'number' && isNaN(Number(text))) {
      const error = new Error(`User input node "${node.id}" esperava número mas recebeu: "${text}".`);
      // @ts-ignore
      error.code = 'ENGINE_USER_INPUT_TYPE_MISMATCH';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }
  }

  // Armazena texto (potencialmente enriquecido com conteúdo de arquivos)
  nextState.variables[variableName] = enhancedText;

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'user_input',
      storedAs: variableName,
      text: enhancedText,
      files: files.length > 0 ? files : undefined,
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
        text: enhancedText,
        variable: variableName,
        expectedType,
        filesCount: files.length,
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
 * - APENAS igualdade simples (===) e always são permitidos.
 *
 * Formato suportado (exemplos):
 * - { op: "always" } - Sempre verdadeiro (fallback)
 * - { op: "equals", var: "intent", value: "support" } - Igualdade simples
 *
 * PROIBIDO:
 * - Operadores matemáticos: > < >= <=
 * - Operadores de string: contains, regex
 * - Acesso profundo: obj.prop (deve ser achatado antes)
 */
function evaluateCondition(condition, state) {
  if (!condition || typeof condition !== 'object') return false;

  const op = condition.op || 'always';

  // Operadores permitidos: apenas 'always' e 'equals'
  const validOps = ['always', 'equals'];
  if (!validOps.includes(op)) {
    // Operador inválido: retorna false e loga erro
    const logger = require('../../api/utils/logger');
    logger.warn('Router: operador proibido detectado', {
      operator: op,
      validOperators: validOps,
      condition,
    });
    return false;
  }

  if (op === 'always') return true;

  if (op === 'equals') {
    const varName = condition.var;
    if (!varName) return false;
    const variableValue = state.variables[varName];
    // Igualdade estrita (===)
    return variableValue === condition.value;
  }

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

  // Valida regras antes de executar (segurança)
  const validOps = ['always', 'equals'];
  for (let i = 0; i < rules.length; i += 1) {
    const rule = rules[i];
    if (!rule || typeof rule !== 'object') {
      const error = new Error(`Router node "${node.id}" tem regra ${i + 1} inválida.`);
      // @ts-ignore
      error.code = 'ENGINE_ROUTER_INVALID_RULE';
      // @ts-ignore
      error.type = 'flow';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }
    
    const condition = rule.condition;
    if (!condition || typeof condition !== 'object') {
      const error = new Error(`Router node "${node.id}" tem condição inválida na regra ${i + 1}.`);
      // @ts-ignore
      error.code = 'ENGINE_ROUTER_INVALID_CONDITION';
      // @ts-ignore
      error.type = 'flow';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }
    
    const op = condition.op;
    if (!op || !validOps.includes(op)) {
      const error = new Error(`Router node "${node.id}" tem operador proibido "${op}" na regra ${i + 1}. Use apenas: ${validOps.join(', ')}.`);
      // @ts-ignore
      error.code = 'ENGINE_ROUTER_PROHIBITED_OPERATOR';
      // @ts-ignore
      error.type = 'flow';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }
    
    // Detecta acesso profundo (obj.prop)
    if (op === 'equals' && condition.var && condition.var.includes('.')) {
      const error = new Error(`Router node "${node.id}" tenta acessar propriedade profunda "${condition.var}" na regra ${i + 1}. Aplaine antes (ex: user_role em vez de user.role).`);
      // @ts-ignore
      error.code = 'ENGINE_ROUTER_DEEP_ACCESS';
      // @ts-ignore
      error.type = 'flow';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }
  }

  let chosenNext = null;
  let matchedRule = null;

  for (const rule of rules) {
    if (evaluateCondition(rule.condition, state)) {
      chosenNext = rule.next || null;
      matchedRule = rule;
      break;
    }
  }

  // Se nenhuma rota casou, tenta usar defaultNext (campo next do nó)
  if (!chosenNext) {
    chosenNext = node.next || null;
  }

  // Se ainda não há próximo nó, lança erro explícito
  if (!chosenNext) {
    const error = new Error(`Router node "${node.id}" não encontrou rota correspondente e não tem fallback definido.`);
    // @ts-ignore
    error.code = 'ENGINE_ROUTER_NO_MATCH';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    // @ts-ignore
    error.variablesSnapshot = { ...state.variables };
    throw error;
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
        matchedRule: matchedRule ? matchedRule.condition : null,
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

  if (!assignments || typeof assignments !== 'object') {
    const error = new Error(`Set variable node "${node.id}" não tem assignments válidos.`);
    // @ts-ignore
    error.code = 'ENGINE_SET_VARIABLE_INVALID';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  const changedKeys = [];
  const warnings = [];

  for (const [key, value] of Object.entries(assignments)) {
    // Valida nome da variável
    if (!key || typeof key !== 'string' || key.trim() === '') {
      const error = new Error(`Set variable node "${node.id}" tem nome de variável inválido: "${key}".`);
      // @ts-ignore
      error.code = 'ENGINE_SET_VARIABLE_INVALID_NAME';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Valida que o valor não é undefined
    if (value === undefined) {
      const error = new Error(`Set variable node "${node.id}" tentou setar valor undefined para variável "${key}". Use null para valores vazios.`);
      // @ts-ignore
      error.code = 'ENGINE_SET_VARIABLE_UNDEFINED_VALUE';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Warning ao sobrescrever variável existente
    if (state.variables && state.variables.hasOwnProperty(key)) {
      warnings.push(`Variável "${key}" foi sobrescrita.`);
    }

    nextState.variables[key] = value;
    changedKeys.push(key);
  }

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'set_variable',
      changedKeys,
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
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    }),
  );

  return result;
}

/**
 * Nó "end"
 * - Marca o fim do fluxo/conversa.
 * - currentNodeId passa a ser null.
 * - Bloqueia execução posterior.
 */
async function endNodeHandler(node, state, input, deps = null) {
  // Bloqueia execução se já foi finalizado
  if (state.metadata && state.metadata.executionBlocked === true) {
    const error = new Error(`Tentativa de executar após nó end. Conversa já finalizada.`);
    // @ts-ignore
    error.code = 'ENGINE_END_EXECUTED';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  const nextState = cloneState(state);
  
  // Valida que end não tem saídas
  if (node.next) {
    const error = new Error(`End node "${node.id}" não pode ter saídas. Nós end devem ser folhas do fluxo.`);
    // @ts-ignore
    error.code = 'ENGINE_END_HAS_OUTPUTS';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }
  
  // Marca estado final explicitamente
  nextState.currentNodeId = null;
  nextState.metadata = nextState.metadata || {};
  nextState.metadata.flowEnded = true;
  nextState.metadata.flowEndTime = new Date().toISOString();
  
  // Bloqueia execução posterior
  nextState.metadata.executionBlocked = true;

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
      payload: {
        flowEnded: true,
        executionBlocked: true,
      },
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

/**
 * Nó "options"
 * - Exibe opções interativas para o usuário (botões, checkboxes, etc.)
 * - Captura a resposta do usuário e armazena em uma variável
 * - Suporta múltiplos tipos de interação: button, checkbox, radio, list
 *
 * config:
 * - message: string (opcional) - Mensagem a ser exibida antes das opções
 * - optionsType: string - Tipo de opções ('button', 'checkbox', 'radio', 'list')
 * - options: Array<{id: string, label: string, value?: any}> - Lista de opções
 * - variable: string (opcional) - Nome da variável onde a resposta será salva
 * - allowMultiple: boolean (opcional) - Se permite múltipla seleção
 *
 * Input esperado (quando o usuário responde):
 * - { text: string } ou { optionId: string } ou { optionIds: string[] }
 *
 * Output:
 * - type: 'options'
 * - message: string (mensagem renderizada)
 * - optionsType: string
 * - options: array de opções
 * - selectedOption: string ou string[] (dependendo do tipo)
 */
async function optionsNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  const config = node.config || {};
  const optionsType = config.optionsType || 'button';
  const options = Array.isArray(config.options) ? config.options : [];
  const messageTemplate = config.message ? String(config.message) : '';
  const variableName = config.variable || 'user_option';
  const allowMultiple = config.allowMultiple === true;

  // Renderiza a mensagem substituindo variáveis
  const renderedMessage = renderTemplate(messageTemplate, nextState.variables || {});

  // Se há input do usuário, processa a seleção
  if (input) {
    let selectedValue = null;
    let selectedOption = null;

    // Processa diferentes formatos de input
    if (input.optionId) {
      // Input direto com ID da opção
      selectedValue = input.optionId;
      selectedOption = options.find(opt => opt.id === selectedValue);
    } else if (Array.isArray(input.optionIds)) {
      // Múltiplas seleções
      selectedValue = input.optionIds;
      selectedOption = input.optionIds.map(id => options.find(opt => opt.id === id)).filter(Boolean);
    } else if (input.text) {
      // Input como texto - tenta encontrar por label ou value
      const text = String(input.text).trim().toLowerCase();
      selectedOption = options.find(opt => {
        const optLabel = String(opt.label || '').toLowerCase();
        const optValue = String(opt.value || opt.id || '').toLowerCase();
        return optLabel === text || optValue === text || optLabel.includes(text);
      });
      if (selectedOption) {
        selectedValue = selectedOption.id;
      }
    }

    // Salva a resposta na variável
    if (selectedValue !== null) {
      if (Array.isArray(selectedValue)) {
        // Múltiplas seleções - salva array de valores
        nextState.variables[variableName] = selectedValue.map(id => {
          const opt = options.find(o => o.id === id);
          return opt && opt.value !== undefined ? opt.value : id;
        });
      } else {
        // Seleção única - salva o valor
        const opt = options.find(o => o.id === selectedValue);
        nextState.variables[variableName] = opt && opt.value !== undefined ? opt.value : selectedValue;
      }
    }
  }

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events: [],
    output: {
      type: 'options',
      message: renderedMessage,
      optionsType,
      options: options.map(opt => ({
        id: opt.id,
        label: renderTemplate(String(opt.label || ''), nextState.variables || {}),
        value: opt.value !== undefined ? opt.value : opt.id,
      })),
      allowMultiple: allowMultiple && (optionsType === 'checkbox' || optionsType === 'list'),
    },
  };

  // Se há seleção, adiciona ao output
  if (input && (input.optionId || Array.isArray(input.optionIds))) {
    result.output.selectedOption = input.optionId || input.optionIds;
  }

  // Evento de opções exibidas
  result.events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'OPTIONS_OUT',
      payload: {
        message: renderedMessage,
        optionsType,
        options: result.output.options,
        allowMultiple: result.output.allowMultiple,
      },
    }),
  );

  // Se há input, registra a seleção
  if (input && (input.optionId || Array.isArray(input.optionIds) || input.text)) {
    result.events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'OPTIONS_IN',
        payload: {
          selectedOption: result.output.selectedOption,
          variable: variableName,
          value: nextState.variables[variableName],
        },
      }),
    );
  }

  return result;
}

/**
 * Nó "subflow"
 * - Chama outro fluxo como subfluxo.
 * - O subfluxo é executado completamente até chegar ao nó "end".
 * - Dados são compartilhados via contexto flat (variáveis).
 * - Sem recursão, sem paralelismo.
 *
 * config:
 * - flowId: string (obrigatório) - ID do fluxo a ser chamado
 * - timeout: number (opcional) - Timeout em milissegundos
 *
 * Regras:
 * - Previne recursão infinita (subfluxo não pode chamar o fluxo principal)
 * - Executa subfluxo até chegar ao end
 * - Variáveis são compartilhadas (flat)
 * - Retorna ao fluxo principal após execução
 */
async function subflowNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);
  
  // Valida configuração
  if (!node.config || typeof node.config !== 'object' || !node.config.flowId || typeof node.config.flowId !== 'string') {
    const error = new Error(`Subflow node "${node.id}" deve ter "config.flowId" válido.`);
    // @ts-ignore
    error.code = 'ENGINE_SUBFLOW_INVALID_CONFIG';
    // @ts-ignore
    error.type = 'data';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  const subflowId = node.config.flowId;
  const timeout = node.config.timeout || 30000; // 30 segundos padrão
  const mainFlowId = state.flowId;

  // Previne recursão infinita: subfluxo não pode chamar o fluxo principal
  if (subflowId === mainFlowId) {
    const error = new Error(`Subflow node "${node.id}" tenta chamar o próprio fluxo principal (recursão infinita).`);
    // @ts-ignore
    error.code = 'ENGINE_SUBFLOW_RECURSION';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  // Previne recursão via pilha de chamadas
  const callStack = state.metadata?.subflowCallStack || [];
  if (callStack.includes(subflowId)) {
    const error = new Error(`Subflow node "${node.id}" cria recursão: ${callStack.join(' -> ')} -> ${subflowId}`);
    // @ts-ignore
    error.code = 'ENGINE_SUBFLOW_RECURSION';
    // @ts-ignore
    error.type = 'flow';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  // Valida que deps está disponível
  if (!deps || !deps.persistence || !deps.persistence.getFlow) {
    const error = new Error(`Subflow node "${node.id}" requer dependências de persistência para carregar o subfluxo.`);
    // @ts-ignore
    error.code = 'ENGINE_SUBFLOW_MISSING_DEPS';
    // @ts-ignore
    error.type = 'system';
    // @ts-ignore
    error.nodeId = node.id;
    throw error;
  }

  try {
    // Carrega o subfluxo
    const subflowDefinition = await deps.persistence.getFlow(subflowId);
    if (!subflowDefinition) {
      const error = new Error(`Subfluxo "${subflowId}" não encontrado.`);
      // @ts-ignore
      error.code = 'ENGINE_SUBFLOW_NOT_FOUND';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Valida que o subfluxo tem nó start e end
    const hasStart = subflowDefinition.nodes && subflowDefinition.nodes.some(n => 
      (n.type || (n.data && n.data.type)) === 'start'
    );
    const hasEnd = subflowDefinition.nodes && subflowDefinition.nodes.some(n => 
      (n.type || (n.data && n.data.type)) === 'end'
    );

    if (!hasStart) {
      const error = new Error(`Subfluxo "${subflowId}" não tem nó "start".`);
      // @ts-ignore
      error.code = 'ENGINE_SUBFLOW_INVALID';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    if (!hasEnd) {
      const error = new Error(`Subfluxo "${subflowId}" não tem nó "end".`);
      // @ts-ignore
      error.code = 'ENGINE_SUBFLOW_INVALID';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Compila o subfluxo
    const { getOrCompileFlow } = require('../compiledFlowCache');
    const compiledSubflow = getOrCompileFlow(subflowDefinition);

    // Prepara estado do subfluxo (compartilha variáveis, mas muda flowId)
    const subflowState = {
      ...nextState,
      flowId: subflowId,
      flowVersion: compiledSubflow.version,
      // Mantém variáveis compartilhadas (flat)
      variables: { ...nextState.variables },
      // Adiciona à pilha de chamadas
      metadata: {
        ...nextState.metadata,
        subflowCallStack: [...callStack, mainFlowId],
        subflowParent: mainFlowId,
        subflowParentNode: node.id,
      },
    };

    // Encontra nó start do subfluxo
    const startNode = compiledSubflow.nodes.find(n => n.type === 'start');
    if (!startNode) {
      const error = new Error(`Subfluxo "${subflowId}" não tem nó "start" válido.`);
      // @ts-ignore
      error.code = 'ENGINE_SUBFLOW_INVALID';
      // @ts-ignore
      error.type = 'data';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Inicia execução do subfluxo a partir do start
    subflowState.currentNodeId = startNode.id;

    // Executa subfluxo até chegar ao end
    const { executeStep } = require('../executeStep');
    
    // Obtém registry das dependências (adicionado pelo runner)
    const registry = deps?.registry;
    if (!registry) {
      const error = new Error(`Subflow node "${node.id}" requer registry nas dependências.`);
      // @ts-ignore
      error.code = 'ENGINE_SUBFLOW_MISSING_REGISTRY';
      // @ts-ignore
      error.type = 'system';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Executa subfluxo com limite de passos para prevenir loops infinitos
    const MAX_SUBFLOW_STEPS = 100;
    let currentSubflowState = subflowState;
    let stepCount = 0;
    const allSubflowEvents = [];

    const startTime = Date.now();

    while (currentSubflowState.currentNodeId && stepCount < MAX_SUBFLOW_STEPS) {
      // Verifica timeout
      if (Date.now() - startTime > timeout) {
        const error = new Error(`Subfluxo "${subflowId}" excedeu timeout de ${timeout}ms.`);
        // @ts-ignore
        error.code = 'ENGINE_SUBFLOW_TIMEOUT';
        // @ts-ignore
        error.type = 'system';
        // @ts-ignore
        error.nodeId = node.id;
        throw error;
      }

      // Executa um passo do subfluxo
      const stepResult = await executeStep(
        compiledSubflow,
        currentSubflowState,
        {
          registry,
          input: stepCount === 0 ? input : undefined, // Passa input apenas no primeiro passo
          deps,
        }
      );

      stepCount++;
      currentSubflowState = stepResult.state;
      allSubflowEvents.push(...stepResult.events);

      // Verifica se chegou ao end
      const currentNode = compiledSubflow.nodes.find(n => n.id === currentSubflowState.currentNodeId);
      if (currentNode && currentNode.type === 'end') {
        // Subfluxo terminou
        break;
      }

      // Se não há nó atual, subfluxo terminou
      if (!currentSubflowState.currentNodeId) {
        break;
      }
    }

    if (stepCount >= MAX_SUBFLOW_STEPS) {
      const error = new Error(`Subfluxo "${subflowId}" excedeu limite de ${MAX_SUBFLOW_STEPS} passos (possível loop infinito).`);
      // @ts-ignore
      error.code = 'ENGINE_SUBFLOW_MAX_STEPS';
      // @ts-ignore
      error.type = 'flow';
      // @ts-ignore
      error.nodeId = node.id;
      throw error;
    }

    // Retorna ao fluxo principal
    // Restaura flowId original, mas mantém variáveis atualizadas
    const finalState = {
      ...currentSubflowState,
      flowId: mainFlowId,
      flowVersion: state.flowVersion, // Mantém versão do fluxo principal
      currentNodeId: node.next || null, // Próximo nó do fluxo principal
      metadata: {
        ...currentSubflowState.metadata,
        subflowCallStack: callStack, // Remove da pilha
        subflowParent: undefined,
        subflowParentNode: undefined,
      },
    };

    /** @type {EngineStepOutput} */
    const result = {
      nextState: finalState,
      events: [
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'SUBFLOW_CALLED',
          payload: {
            subflowId,
            stepCount,
            completed: true,
          },
        }),
        ...allSubflowEvents.map(event => ({
          ...event,
          // Marca eventos como sendo do subfluxo
          flowId: state.flowId, // Mantém flowId principal para rastreamento
          metadata: {
            ...event.metadata,
            subflowId,
            subflowParent: mainFlowId,
          },
        })),
      ],
      output: {
        type: 'subflow',
        subflowId,
        stepCount,
        completed: true,
      },
    };

    return result;
  } catch (err) {
    // Em caso de erro, retorna ao fluxo principal
    const errorEvent = createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'ERROR',
      payload: {
        message: err.message || String(err),
        operation: 'subflow',
        subflowId,
      },
    });

    return {
      nextState: {
        ...nextState,
        currentNodeId: node.next || null, // Continua no fluxo principal mesmo com erro
      },
      events: [errorEvent],
      output: {
        type: 'subflow',
        subflowId,
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
  optionsNodeHandler,
  subflowNodeHandler,
};


