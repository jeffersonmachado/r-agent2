/**
 * Simulador de conversa baseado na engine de fluxo.
 *
 * Objetivo:
 * - Fornecer uma forma simples de executar um fluxo passo a passo,
 *   acumulando eventos e saídas em uma "transcript" de conversa.
 *
 * Importante:
 * - A lógica de execução continua sendo a função stateless runStep.
 * - Este módulo oferece apenas "conveniências" para testes, debug
 *   e ferramentas como o botão de simulação do frontend.
 */

const { runStep } = require('./runner');

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 * @typedef {import('./flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('./nodeRegistry').NodeRegistry} NodeRegistry
 */

/**
 * Representa um passo da simulação.
 *
 * @typedef {Object} SimulationStep
 * @property {number} index
 * @property {ConversationState} stateBefore
 * @property {ConversationState} stateAfter
 * @property {EngineStepOutput["output"]} output
 * @property {EngineEvent[]} events
 */

/**
 * Opcões para simulação contínua.
 *
 * @typedef {Object} SimulationOptions
 * @property {number} [maxSteps] - Limite de passos para evitar loops infinitos (default: 100)
 * @property {function(ConversationState, EngineStepOutput, number): (Promise<any>|any)} [inputProvider]
 *   Função opcional chamada antes de cada passo que pode fornecer "input"
 *   para a engine (por exemplo, mensagem do usuário). Recebe:
 *   - estado atual
 *   - saída do passo anterior (ou null no primeiro passo)
 *   - índice do próximo passo
 */

/**
 * Executa o fluxo em modo "auto", passo a passo, até:
 * - currentNodeId ser null (conversa encerrada), ou
 * - atingir maxSteps
 *
 * Pode opcionalmente usar um inputProvider para simular a entrada
 * do usuário (por exemplo, testes automatizados).
 *
 * @param {FlowDefinition} flow
 * @param {ConversationState} initialState
 * @param {NodeRegistry} registry
 * @param {SimulationOptions} [options]
 * @returns {Promise<{ steps: SimulationStep[], events: EngineEvent[], finalState: ConversationState, haltedReason: string }>}
 */
async function runUntilHalt(flow, initialState, registry, options) {
  const maxSteps = (options && options.maxSteps) || 100;
  const inputProvider = options && options.inputProvider;

  /** @type {SimulationStep[]} */
  const steps = [];
  /** @type {EngineEvent[]} */
  const allEvents = [];

  let currentState = initialState;
  /** @type {EngineStepOutput|null} */
  let lastStepOutput = null;

  let haltedReason = '';

  for (let i = 0; i < maxSteps; i += 1) {
    if (!currentState.currentNodeId) {
      haltedReason = 'NO_CURRENT_NODE';
      break;
    }

    let input = undefined;
    if (typeof inputProvider === 'function') {
      input = await inputProvider(currentState, lastStepOutput, i);
    }

    const stepResult = await runStep(flow, currentState, registry, input);

    const simStep = {
      index: i,
      stateBefore: currentState,
      stateAfter: stepResult.nextState,
      output: stepResult.output,
      events: stepResult.events,
    };
    steps.push(simStep);
    allEvents.push(...stepResult.events);

    currentState = stepResult.nextState;
    lastStepOutput = stepResult;

    // Se a conversa terminou neste passo, encerramos.
    if (!currentState.currentNodeId) {
      haltedReason = 'CONVERSATION_ENDED';
      break;
    }
  }

  if (!haltedReason) {
    haltedReason = 'MAX_STEPS_REACHED';
  }

  return {
    steps,
    events: allEvents,
    finalState: currentState,
    haltedReason,
  };
}

/**
 * Cria um pequeno "driver" de simulação orientado a métodos,
 * útil em ferramentas interativas (ex.: playground).
 *
 * Importante:
 * - Este driver mantém estado internamente apenas para conveniência.
 *   A engine em si continua completamente stateless.
 *
 * API:
 * - getState(): estado atual
 * - isFinished(): boolean
 * - step(input?): executa um passo e retorna SimulationStep
 *
 * @param {FlowDefinition} flow
 * @param {ConversationState} initialState
 * @param {NodeRegistry} registry
 */
function createSimulator(flow, initialState, registry) {
  /** @type {ConversationState} */
  let currentState = initialState;
  /** @type {number} */
  let index = 0;

  return {
    /**
     * Retorna o estado atual da conversa.
     *
     * @returns {ConversationState}
     */
    getState() {
      return currentState;
    },

    /**
     * Indica se a conversa terminou (currentNodeId === null).
     *
     * @returns {boolean}
     */
    isFinished() {
      return !currentState.currentNodeId;
    },

    /**
     * Executa um único passo da simulação.
     *
     * @param {any} [input] - Input opcional (ex.: mensagem do usuário)
     * @returns {Promise<SimulationStep>}
     */
    async step(input) {
      const before = currentState;
      const result = await runStep(flow, before, registry, input);

      const simStep = {
        index,
        stateBefore: before,
        stateAfter: result.nextState,
        output: result.output,
        events: result.events,
      };

      currentState = result.nextState;
      index += 1;

      return simStep;
    },
  };
}

module.exports = {
  runUntilHalt,
  createSimulator,
};


