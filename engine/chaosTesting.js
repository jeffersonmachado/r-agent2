/**
 * Modo de teste caótico (chaos testing) para a engine.
 *
 * Objetivos:
 * - Injetar falhas controladas em handlers de nós (para testar robustez).
 * - Verificar recuperação (usando os mecanismos de retry/fallback da engine).
 * - Garantir consistência do replay (construindo replay a partir dos eventos).
 *
 * Importante:
 * - Este módulo é voltado para testes e ambientes de QA.
 * - O core da engine continua determinístico; o "caos" é
 *   introduzido apenas por quem opta por usar estes helpers.
 */

const { runUntilHalt } = require('./simulator');
const { buildConversationReplay } = require('./replay');

/**
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('./flowTypes').EngineEvent} EngineEvent
 * @typedef {import('./nodeRegistry').NodeHandler} NodeHandler
 * @typedef {import('./nodeRegistry').NodeRegistry} NodeRegistry
 */

/**
 * Configuração de caos para um handler.
 *
 * Campos:
 * - enabled: ativa/desativa caos (default: false).
 * - failureProbability: probabilidade (0..1) de falha sintética.
 * - maxDelayMs: atraso aleatório máximo injetado antes de chamar o handler.
 * - failurePlan: sequência determinística de falhas/sucessos para testes
 *   (se fornecida, tem precedência sobre failureProbability).
 *
 * @typedef {Object} ChaosConfig
 * @property {boolean} [enabled]
 * @property {number} [failureProbability]
 * @property {number} [maxDelayMs]
 * @property {boolean[]} [failurePlan]
 */

/**
 * Decide se uma invocação deve falhar com base na ChaosConfig.
 *
 * - Se failurePlan for fornecido e não estiver vazio, usamos o próximo valor.
 * - Caso contrário, usamos failureProbability.
 *
 * @param {ChaosConfig} config
 * @returns {boolean}
 */
function shouldFail(config) {
  if (!config || !config.enabled) return false;

  if (Array.isArray(config.failurePlan) && config.failurePlan.length > 0) {
    return Boolean(config.failurePlan.shift());
  }

  const p = typeof config.failureProbability === 'number' ? config.failureProbability : 0;
  if (p <= 0) return false;
  if (p >= 1) return true;
  return Math.random() < p;
}

/**
 * Envolve um NodeHandler com comportamento caótico, injetando:
 * - Atrasos aleatórios (até maxDelayMs).
 * - Falhas sintéticas (erros lançados) conforme a ChaosConfig.
 *
 * Decisão importante:
 * - Não alteramos estado nem eventos; apenas decidimos se o
 *   handler real será chamado ou se lançaremos um erro sintético.
 * - A recuperação/fallback é totalmente tratada pelo runner da engine.
 *
 * @param {NodeHandler} handler
 * @param {ChaosConfig} config
 * @returns {NodeHandler}
 */
function wrapHandlerWithChaos(handler, config) {
  if (!config || !config.enabled) return handler;

  const chaosConfig = { ...config };

  /**
   * @type {NodeHandler}
   */
  async function chaoticHandler(node, state, input) {
    // Atraso aleatório opcional
    const maxDelay = typeof chaosConfig.maxDelayMs === 'number' && chaosConfig.maxDelayMs > 0
      ? chaosConfig.maxDelayMs
      : 0;
    if (maxDelay > 0) {
      const delay = Math.floor(Math.random() * maxDelay);
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Falha sintética opcional
    if (shouldFail(chaosConfig)) {
      const err = new Error('Injected chaos failure');
      // @ts-ignore
      err.code = 'CHAOS_INJECTED_FAILURE';
      throw err;
    }

    return handler(node, state, input);
  }

  return chaoticHandler;
}

/**
 * Executa uma simulação caótica completa de um fluxo, usando:
 * - runUntilHalt para percorrer o fluxo.
 * - buildConversationReplay para reconstruir o replay.
 *
 * Observação:
 * - Assume-se que o NodeRegistry já foi montado com handlers
 *   caóticos (via wrapHandlerWithChaos) onde desejado.
 *
 * @param {FlowDefinition} flow
 * @param {ConversationState} initialState
 * @param {NodeRegistry} registry
 * @param {{ maxSteps?: number, inputProvider?: (ConversationState, EngineStepOutput|null, number) => any }} [options]
 * @returns {Promise<{ simulation: { steps: any[], events: EngineEvent[], finalState: ConversationState, haltedReason: string }, replay: any }>}
 */
async function runChaosSimulation(flow, initialState, registry, options) {
  const simulation = await runUntilHalt(flow, initialState, registry, {
    maxSteps: options && options.maxSteps,
    inputProvider: options && options.inputProvider,
  });

  const replay = buildConversationReplay(simulation.events);

  return {
    simulation,
    replay,
  };
}

module.exports = {
  wrapHandlerWithChaos,
  runChaosSimulation,
  _internal: {
    shouldFail,
  },
};


