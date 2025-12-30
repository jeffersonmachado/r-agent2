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
  setVariableNodeHandler,
  handoffNodeHandler,
  endNodeHandler,
} = require('./nodes/basicNodes');
const { aiNodeHandler } = require('./nodes/aiNode');
const { aiTaskNodeHandler } = require('./nodes/aiTaskNode');
const { getOrCompileFlow } = require('./compiledFlowCache');
const { executeStep } = require('./executeStep');
const { buildConversationReplay } = require('./replay');

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
  registry.register('router', routerNodeHandler);
  registry.register('set_variable', setVariableNodeHandler);
  registry.register('handoff', handoffNodeHandler);
  registry.register('end', endNodeHandler);
  registry.register('ai', aiNodeHandler);
  registry.register('ai_task', aiTaskNodeHandler);
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

  const compiled = getOrCompileFlow(flow);

  const startNodeId = resolveStartNodeId(flow, options && options.startNodeId);
  if (!startNodeId) {
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
    },
  };

  const maxSteps = (options && options.maxSteps) || 50;
  const inputProvider = options && options.inputProvider;

  const registry = createSimulationRegistry();

  /** @type {Array<{ index: number, stateBefore: ConversationState, stateAfter: ConversationState, output: any, events: EngineEvent[] }>} */
  const steps = [];
  /** @type {EngineEvent[]} */
  const allEvents = [];

  for (let i = 0; i < maxSteps; i += 1) {
    if (!state.currentNodeId) break;

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
    // eslint-disable-next-line no-await-in-loop
    const result = await executeStep(before, compiled, {
      registry,
      input: execInput,
    });

    const step = {
      index: i,
      stateBefore: before,
      stateAfter: result.state,
      output: result.output,
      events: result.events,
    };

    steps.push(step);
    allEvents.push(...result.events);

    state = result.state;
  }

  const replay = buildConversationReplay(allEvents);

  return {
    compiledFlowInfo: {
      id: compiled.id,
      version: compiled.version,
      versionHash: compiled.versionHash,
    },
    steps,
    events: allEvents,
    replay,
  };
}

module.exports = {
  simulateFlow,
};


