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
const { ReplaySystem } = require('../lib/replaySystem');
const { RecordingSystem } = require('../lib/recordingSystem');
const path = require('path');

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
    // Inicializa replay se não existir no input
    let replay = input?.replay;
    const shouldRecordReplay = process.env.ENABLE_CHAOS_REPLAY !== 'false';
    const shouldRecord = process.env.ENABLE_CHAOS_RECORDING !== 'false';
    let recording = null;
    let recordingId = null;
    
    if (shouldRecordReplay && !replay) {
      replay = new ReplaySystem({
        storagePath: path.join(process.cwd(), 'replays', 'chaos'),
        context: 'chaos',
        enableScreenshots: false,
      });
      
      const replayId = `chaos-${node.id}-${Date.now()}`;
      replay.start(replayId, {
        nodeId: node.id,
        nodeType: node.type,
        chaosEnabled: true,
      });
    }

    if (shouldRecord) {
      recording = new RecordingSystem({
        storagePath: path.join(process.cwd(), 'recordings', 'chaos'),
        context: 'chaos',
        enableTimestamps: false,
      });
      
      recordingId = `chaos-${node.id}-${Date.now()}`;
      recording.start(recordingId, {
        name: `Caos - ${node.type}`,
        description: 'Teste de caos em handler',
        nodeId: node.id,
        nodeType: node.type,
        source: 'automatic',
      });
    }

    // Atraso aleatório opcional
    const maxDelay = typeof chaosConfig.maxDelayMs === 'number' && chaosConfig.maxDelayMs > 0
      ? chaosConfig.maxDelayMs
      : 0;
    if (maxDelay > 0) {
      const delay = Math.floor(Math.random() * maxDelay);
      
      if (replay) {
        replay.recordEvent('chaos_delay_injected', { delayMs: delay });
      }
      if (recording) {
        recording.recordAction({
          type: 'chaos-delay',
          step: 'delay-injected',
          value: { delayMs: delay },
        });
      }
      
      // eslint-disable-next-line no-promise-executor-return
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Falha sintética opcional
    if (shouldFail(chaosConfig)) {
      const err = new Error('Injected chaos failure');
      // @ts-ignore
      err.code = 'CHAOS_INJECTED_FAILURE';
      
      if (replay) {
        replay.recordError(err, node.id, {
          type: 'injected_failure',
          nodeType: node.type,
        });
        replay.recordEvent('chaos_failure_injected', {
          nodeId: node.id,
          nodeType: node.type,
        });
        replay.stop();
        replay.save(`chaos-${node.id}-failure`);
      }
      if (recording) {
        recording.recordCustom('error', {
          step: 'failure-injected',
          value: { error: err.message, nodeId: node.id },
        });
        recording.stop();
        recording.save(`${recordingId}-failure`);
      }
      
      throw err;
    }

    // Executa handler real
    try {
      const result = await handler(node, state, input);
      
      if (replay) {
        replay.recordEvent('chaos_handler_success', {
          nodeId: node.id,
        });
      }
      if (recording) {
        recording.recordAction({
          type: 'chaos-handler',
          step: 'handler-success',
          value: { nodeId: node.id, nodeType: node.type },
        });
        recording.stop();
        recording.save(recordingId);
      }
      
      return result;
    } catch (error) {
      if (replay) {
        replay.recordError(error, node.id, {
          type: 'handler_error',
          nodeType: node.type,
        });
        replay.stop();
        replay.save(`chaos-${node.id}-error`);
      }
      if (recording) {
        recording.recordCustom('error', {
          step: 'handler-error',
          value: { error: error.message, nodeId: node.id },
        });
        recording.stop();
        recording.save(`${recordingId}-error`);
      }
      throw error;
    }
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
  // Inicializa replay do sistema
  const replay = new ReplaySystem({
    storagePath: path.join(process.cwd(), 'replays', 'chaos'),
    context: 'chaos',
    enableScreenshots: false,
  });

  const replayId = `chaos-simulation-${flow.id}-${Date.now()}`;
  replay.start(replayId, {
    flowId: flow.id,
    sessionId: initialState.sessionId,
    maxSteps: options?.maxSteps,
  });

  // Inicializa recording se habilitado
  const shouldRecord = process.env.ENABLE_CHAOS_RECORDING !== 'false';
  let recording = null;
  let recordingId = null;
  
  if (shouldRecord) {
    recording = new RecordingSystem({
      storagePath: path.join(process.cwd(), 'recordings', 'chaos'),
      context: 'chaos',
      enableTimestamps: false,
    });
    
    recordingId = `chaos-simulation-${flow.id}-${Date.now()}`;
    recording.start(recordingId, {
      name: `Caos - Simulação`,
      description: 'Teste de caos em simulação completa',
      flowId: flow.id,
      source: 'automatic',
    });
  }

  replay.recordEvent('chaos_simulation_started', {
    flowId: flow.id,
    initialNodeId: initialState.currentNodeId,
  });

  if (recording) {
    recording.recordAction({
    type: 'chaos-simulation',
    step: 'simulate',
    value: {
      flowId: flow.id,
      initialNodeId: initialState.currentNodeId,
      options: options ? Object.keys(options) : [],
    },
  });

  const simulationStartTime = new Date().toISOString();
  const simulation = await runUntilHalt(flow, initialState, registry, {
    maxSteps: options && options.maxSteps,
    inputProvider: options && options.inputProvider,
  });
  const simulationEndTime = new Date().toISOString();

  const conversationReplay = buildConversationReplay(simulation.events);

  // Registra resultado da simulação
  replay.recordAction(
    {
      type: 'chaos_simulation',
      step: 'run-simulation',
    },
    {
      success: true,
      startTime: simulationStartTime,
      endTime: simulationEndTime,
      actual: {
        stepsCount: simulation.steps?.length || 0,
        eventsCount: simulation.events?.length || 0,
        haltedReason: simulation.haltedReason,
        finalNodeId: simulation.finalState?.currentNodeId,
      },
    }
  );

  replay.recordEvent('chaos_simulation_completed', {
    stepsCount: simulation.steps?.length || 0,
    haltedReason: simulation.haltedReason,
  });

  replay.stop();
  const replayPath = replay.save(replayId);

  // Finaliza e salva gravação se foi inicializada
  let recordingPath = null;
  if (recording) {
    recording.recordAction({
      type: 'chaos-simulation',
      step: 'simulation-completed',
      value: {
        stepsCount: simulation.steps?.length || 0,
        eventsCount: simulation.events?.length || 0,
        haltedReason: simulation.haltedReason,
        finalNodeId: simulation.finalState?.currentNodeId,
      },
    });
    recording.stop();
    recordingPath = recording.save(recordingId);
  }

  return {
    simulation,
    replay: conversationReplay,
    replayPath, // Adiciona caminho do replay do sistema
    recordingPath, // Adiciona caminho da gravação (pode ser null se recording não foi habilitado)
  };
}

module.exports = {
  wrapHandlerWithChaos,
  runChaosSimulation,
  _internal: {
    shouldFail,
  },
};


