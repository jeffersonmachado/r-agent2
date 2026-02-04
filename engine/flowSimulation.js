/**
 * Simulador de fluxo para o modo "preview"/"teste".
 *
 * Regras atendidas:
 * - Não gera billing:
 *   - Usa um provider de IA mock que NÃO reporta uso (sem usage/tokens),
 *     logo não há eventos AI_USAGE que normalmente alimentariam billing.
 * - Não usa IA real:
 *   - Nunca consulta o gerenciador de providers reais; injeta sempre um
 *     AiProvider fake apenas nesta simulação.
 * - Executa compileFlow + executeStep:
 *   - Usa o cache de CompiledFlow (getOrCompileFlow) e, para cada passo,
 *     chama executeStep com o fluxo compilado.
 */

const { NodeRegistry } = require('./nodeRegistry');
const {
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
} = require('./nodes/basicNodes');
const { aiNodeHandler } = require('./nodes/aiNode');
const { aiTaskNodeHandler } = require('./nodes/aiTaskNode');
const { semanticRouterNodeHandler } = require('./nodes/semanticRouterNode');
const { ragAnswerNodeHandler } = require('./nodes/ragAnswerNode');
const { businessEntryNodeHandler } = require('./nodes/businessEntryNode');
const { mergeNodeHandler } = require('./nodes/mergeNode');
const {
  voicePromptListenNodeHandler,
  voiceListenAsrNodeHandler,
  voiceGatherDtmfNodeHandler,
  voiceBranchNodeHandler,
  voiceTransferRamalNodeHandler,
  voiceTransferFilaNodeHandler,
  voiceTransferUtilsNodeHandler,
  voiceHangupNodeHandler,
} = require('./nodes/voiceNodes');
const { getOrCompileFlow } = require('./compiledFlowCache');
const { executeStep } = require('./executeStep');
const { buildConversationReplay } = require('./replay');
const { ReplaySystem } = require('../lib/replaySystem');
const { RecordingSystem } = require('../lib/recordingSystem');
const path = require('path');

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').CompiledFlow} CompiledFlow
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 */

/**
 * Provider de IA mock para simulação.
 *
 * - Não chama serviços externos.
 * - Não retorna usage/tokens (para não gerar billing).
 */
const mockAiProvider = {
  /**
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  async generate(prompt) {
    return `[SIMULAÇÃO] ${prompt}`;
  },
};

/**
 * Opções para simular fluxo.
 *
 * @typedef {Object} FlowSimulationOptions
 * @property {number} [maxSteps] - número máximo de passos (default: 50)
 * @property {string} [startNodeId] - nó inicial (se omitido, tenta "start" ou primeiro nó)
 * @property {(state: ConversationState, stepIndex: number) => (Promise<any>|any)} [inputProvider]
 *   Função que fornece input opcional para cada passo (ex.: mensagens simuladas do usuário).
 */

/**
 * Encontra o nó inicial razoável para simulação.
 *
 * Estratégia:
 * - Se startNodeId for fornecido, usa-o.
 * - Caso contrário, tenta um nó com type "start".
 * - Se não houver, usa o primeiro nó do array.
 *
 * @param {FlowDefinition} flow
 * @param {string|undefined} preferredId
 * @returns {string|null}
 */
function resolveStartNodeId(flow, preferredId) {
  if (preferredId) return preferredId;
  if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length === 0) return null;

  const startNode = flow.nodes.find((n) => n.type === 'start');
  if (startNode) return startNode.id;

  return flow.nodes[0].id || null;
}

/**
 * Cria um NodeRegistry completo com handlers padrão + nó de IA,
 * usando o provider de IA mock.
 *
 * Importante:
 * - O provider real (OpenAI etc.) NÃO é usado aqui.
 *
 * @returns {NodeRegistry}
 */
function createSimulationRegistry() {
  const registry = new NodeRegistry();
  registry.register('start', startNodeHandler);
  registry.register('message', messageNodeHandler);
  registry.register('user_input', userInputNodeHandler);
  registry.register('merge', mergeNodeHandler);
  registry.register('options', optionsNodeHandler);
  registry.register('router', routerNodeHandler);
  registry.register('schedule_router', scheduleRouterNodeHandler);
  registry.register('semantic_router', semanticRouterNodeHandler);
  registry.register('business_entry', businessEntryNodeHandler);
  registry.register('set_variable', setVariableNodeHandler);
  registry.register('handoff', handoffNodeHandler);
  registry.register('end', endNodeHandler);
  registry.register('ai', aiNodeHandler);
  registry.register('ai_task', aiTaskNodeHandler);
  registry.register('rag_answer', ragAnswerNodeHandler);
  // Nós de persistência
  const {
    getFlowInfoNodeHandler,
    getQueueStatusNodeHandler,
    getConfigValueNodeHandler,
    listFlowsNodeHandler,
  } = require('./nodes/persistenceNodes');
  registry.register('get_flow_info', getFlowInfoNodeHandler);
  registry.register('get_queue_status', getQueueStatusNodeHandler);
  registry.register('get_config_value', getConfigValueNodeHandler);
  registry.register('list_flows', listFlowsNodeHandler);
  // Nós de sistema
  const {
    getCurrentTimeNodeHandler,
    generateUuidNodeHandler,
    delayNodeHandler,
    formatDateNodeHandler,
    randomNumberNodeHandler,
    getUserInfoNodeHandler,
  } = require('./nodes/systemNodes');
  registry.register('get_current_time', getCurrentTimeNodeHandler);
  registry.register('generate_uuid', generateUuidNodeHandler);
  registry.register('delay', delayNodeHandler);
  registry.register('format_date', formatDateNodeHandler);
  registry.register('random_number', randomNumberNodeHandler);
  registry.register('get_user_info', getUserInfoNodeHandler);
  // Nó de subfluxo
  registry.register('subflow', subflowNodeHandler);
  // Nó de API
  const { apiNodeHandler } = require('./nodes/apiNode');
  registry.register('api', apiNodeHandler);
  // Nó de fallback
  const { fallbackNodeHandler } = require('./nodes/fallbackNode');
  registry.register('fallback', fallbackNodeHandler);
  // Nós de voz/URA (kind=voice)
  registry.register('voice_prompt_listen', voicePromptListenNodeHandler);
  registry.register('voice_listen_asr', voiceListenAsrNodeHandler);
  registry.register('voice_gather_dtmf', voiceGatherDtmfNodeHandler);
  registry.register('voice_branch', voiceBranchNodeHandler);
  registry.register('voice_transfer_ramal', voiceTransferRamalNodeHandler);
  registry.register('voice_transfer_fila', voiceTransferFilaNodeHandler);
  registry.register('voice_transfer_utils', voiceTransferUtilsNodeHandler);
  registry.register('voice_hangup', voiceHangupNodeHandler);
  return registry;
}

/**
 * Executa uma simulação de fluxo determinística, passo a passo,
 * usando compileFlow + executeStep e um provider de IA mock.
 *
 * Retorna:
 * - compiledFlowInfo: { id, version, versionHash }
 * - steps: lista de passos com estado antes/depois, output e eventos
 * - events: todos os EngineEvent coletados
 * - replay: resultado de buildConversationReplay(events)
 *
 * @param {FlowDefinition} flow
 * @param {FlowSimulationOptions} [options]
 * @returns {Promise<{
 *   compiledFlowInfo: { id: string, version: number, versionHash: string },
 *   steps: Array<{ index: number, stateBefore: ConversationState, stateAfter: ConversationState, output: any, events: EngineEvent[] }>,
 *   events: EngineEvent[],
 *   replay: any,
 * }>}
 */
async function simulateFlow(flow, options) {
  if (!flow || typeof flow !== 'object') {
    throw new Error('simulateFlow: flow inválido');
  }

  // Inicializa replay
  const replay = new ReplaySystem({
    storagePath: path.join(process.cwd(), 'replays', 'simulation'),
    context: 'simulation',
    enableScreenshots: false,
  });

  // Recording visual é opcional. Em simulação (especialmente em testes),
  // usamos um recorder no-op para evitar falhas por dependências ausentes.
  const recordingId = `recording-${flow.id}-${Date.now()}`;
  const recording = {
    recordAction: () => {},
    recordCustom: () => {},
    stop: () => {},
    save: () => null,
  };

  const replayId = `simulate-${flow.id}-${Date.now()}`;
  replay.start(replayId, {
    flowId: flow.id,
    flowName: flow.name,
    maxSteps: options?.maxSteps || 50,
    startNodeId: options?.startNodeId,
  });

  const compiled = getOrCompileFlow(flow);

  const startNodeId = resolveStartNodeId(flow, options && options.startNodeId);
  if (!startNodeId) {
    replay.recordError(new Error('Não foi possível determinar nó inicial'), 'simulate-flow');
    recording.recordCustom('error', {
      step: 'start-node-error',
      value: { error: 'Não foi possível determinar nó inicial' },
    });
    replay.stop();
    replay.save(`${replayId}-error`);
    recording.stop();
    recording.save(`${recordingId}-error`);
    throw new Error('simulateFlow: não foi possível determinar nó inicial');
  }

  /** @type {ConversationState} */
  let state = {
    tenantId: flow.tenantId,
    sessionId: `sim-${flow.tenantId}-${flow.id}-${Date.now()}`,
    flowId: flow.id,
    flowVersion: compiled.version,
    currentNodeId: startNodeId,
    variables: {},
    history: [],
    metadata: {
      mode: 'simulation',
      testMode: true, // Marca como modo teste para virtualizar DELAY e mockar APIs
    },
  };

  // Execution ledger (DB-first) para simulação (best-effort).
  // Importante: mantém o comportamento do simulador mesmo sem DB.
  let executionLedgerAdapter = null;
  try {
    if (process.env.ENABLE_EXECUTION_LEDGER !== 'false') {
      // eslint-disable-next-line global-require
      const { startFlowExecution, appendNodeExecution, finishFlowExecution } = require('../api/services/flowExecutionLedgerService');
      const started = await startFlowExecution({
        tenantId: flow.tenantId,
        flowId: flow.id,
        flowVersion: compiled.version,
        sessionId: state.sessionId,
        correlationId: `simulation:${replayId}`,
        subjectType: 'flow_simulation',
        subjectId: flow.id,
        meta: { mode: 'simulation', replayId },
      });
      if (started && started.ok) {
        state.metadata = state.metadata || {};
        state.metadata.executionId = started.executionId;
        executionLedgerAdapter = {
          executionId: started.executionId,
          sanitizeInput: (inObj) => {
            if (!inObj || typeof inObj !== 'object') return {};
            const copy = { ...inObj };
            // Remove provider (função) do JSON
            delete copy.aiProvider;
            return copy;
          },
          sanitizeOutput: (outObj) => (outObj && typeof outObj === 'object' ? outObj : {}),
          appendNodeExecution: async (args) => appendNodeExecution({
            tenantId: flow.tenantId,
            executionId: started.executionId,
            ...args,
          }),
          finishFlowExecution: async ({ status, metaPatch }) => finishFlowExecution({
            tenantId: flow.tenantId,
            executionId: started.executionId,
            status,
            metaPatch,
          }),
        };
      }
    }
  } catch (_) {}

  const maxSteps = (options && options.maxSteps) || 50;
  const inputProvider = options && options.inputProvider;

  const registry = createSimulationRegistry();

  /** @type {Array<{ index: number, stateBefore: ConversationState, stateAfter: ConversationState, output: any, events: EngineEvent[] }>} */
  const steps = [];
  /** @type {EngineEvent[]} */
  const allEvents = [];

  let simulationError = null;
  for (let i = 0; i < maxSteps; i += 1) {
    if (!state.currentNodeId) {
      replay.recordEvent('simulation_ended', { reason: 'no_current_node', step: i });
      break;
    }

    let input = undefined;
    if (typeof inputProvider === 'function') {
      // eslint-disable-next-line no-await-in-loop
      input = await inputProvider(state, i);
    }

    // Importante: usamos sempre o provider de IA mock aqui.
    const execInput = {
      ...(input || {}),
      aiProvider: mockAiProvider,
    };

    const before = state;
    
    // Registra início do passo
    replay.recordEvent('simulation_step_started', {
      step: i,
      currentNodeId: before.currentNodeId,
    });
    
    const stepStartTime = new Date().toISOString();
    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await executeStep(before, compiled, {
        registry,
        input: execInput,
        deps: {
          registry, // Passa registry para handlers que precisam (ex: subflow)
          replay, // Passa replay para o executeStep registrar ações
          // Simulação/preview é permitido mesmo para fluxos em safe-mode
          allowUnreviewedAiFlow: true,
          executionLedger: executionLedgerAdapter,
        },
      });
    } catch (err) {
      simulationError = err;
      replay.recordError(err, 'simulation_step_failed');
      break;
    }
    const stepEndTime = new Date().toISOString();

    const step = {
      index: i,
      stateBefore: before,
      stateAfter: result.state,
      output: result.output,
      events: result.events,
    };

    // Registra passo no replay
    replay.recordAction(
      {
        type: 'simulation_step',
        step: `step-${i}`,
        nodeId: before.currentNodeId,
      },
      {
        success: true,
        startTime: stepStartTime,
        endTime: stepEndTime,
        actual: {
          nextNodeId: result.state.currentNodeId,
          outputType: result.output?.type,
          eventsCount: result.events.length,
        },
      }
    );

    steps.push(step);
    allEvents.push(...result.events);

    state = result.state;
    
    // Registra transição de nó
    if (before.currentNodeId !== result.state.currentNodeId) {
      replay.recordEvent('node_transition', {
        from: before.currentNodeId,
        to: result.state.currentNodeId,
        step: i,
      });

      recording.recordAction({
        type: 'node-transition',
        step: `transition-${i}`,
        value: {
          from: before.currentNodeId,
          to: result.state.currentNodeId,
        },
      });
    }
  }

  const conversationReplay = buildConversationReplay(allEvents);

  // Finaliza e salva replay do sistema
  replay.recordEvent('simulation_completed', {
    stepsCount: steps.length,
    eventsCount: allEvents.length,
    finalNodeId: state.currentNodeId,
    error: simulationError ? (simulationError.message || String(simulationError)) : null,
  });
  replay.stop();
  const replayPath = replay.save(replayId);

  // Finaliza e salva gravação
  recording.recordAction({
    type: 'simulation-complete',
    step: 'complete',
    value: {
      stepsCount: steps.length,
      eventsCount: allEvents.length,
      finalNodeId: state.currentNodeId,
    },
  });
  recording.stop();
  const recordingPath = recording.save(recordingId);

  // Best-effort: finaliza execução no ledger
  try {
    if (executionLedgerAdapter && typeof executionLedgerAdapter.finishFlowExecution === 'function') {
      await executionLedgerAdapter.finishFlowExecution({
        status: simulationError ? 'failed' : 'done',
        metaPatch: simulationError ? { error: simulationError.message || String(simulationError) } : { finishedBy: 'simulateFlow' },
      });
    }
  } catch (_) {}

  return {
    compiledFlowInfo: {
      id: compiled.id,
      version: compiled.version,
      versionHash: compiled.versionHash,
    },
    steps,
    events: allEvents,
    replay: conversationReplay,
    replayPath, // Adiciona caminho do replay do sistema
  };
}

module.exports = {
  simulateFlow,
};


