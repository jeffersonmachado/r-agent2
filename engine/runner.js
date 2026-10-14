const timers = require('./shared/scheduler');
const clock = require('./shared/clock');
/**
 * Runner principal da engine de fluxo.
 *
 * Responsabilidades:
 * - Dado um fluxo, estado de conversa e input opcional,
 *   executa o nó atual e devolve:
 *   - próximo estado (stateless: não guarda nada internamente)
 *   - eventos estruturados (para log e replay)
 *   - uma saída de alto nível (ex: mensagem para o usuário)
 *
 * Design:
 * - Stateless por design: não há variáveis globais de sessão.
 * - Múltiplas sessões são triviais: basta chamar a função
 *   com estados de sessão diferentes.
 */

const { findNode, createEngineEvent, normalizeNext } = require('./utils');
const persistenceServices = require('./services/persistenceServices');
const { classifyErrorType, getErrorDefinition } = require('./errorCodes');
const { ReplaySystem } = require('../lib/replaySystem');
const path = require('path');

/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').ConversationState} ConversationState
 * @typedef {import('./flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('./nodeRegistry').NodeRegistry} NodeRegistry
 */

/**
 * Executa um único passo do fluxo, baseado no nó atual.
 *
 * @param {FlowDefinition} flow
 * @param {ConversationState} state
 * @param {NodeRegistry} registry
 * @param {Object<string, any>|undefined} input - Input opcional (ex: mensagem do usuário)
 * @param {import('./flowTypes').NodeDependencies|undefined} deps - Dependências opcionais (serviços de persistência, etc.)
 * @returns {Promise<EngineStepOutput>}
 */
async function runStep(flow, state, registry, input, deps = null) {
  // Bloqueia execução se já foi finalizado (após nó end)
  if (state.metadata && state.metadata.executionBlocked === true) {
    const error = new Error('Tentativa de executar após nó end. Conversa já finalizada.');
    // @ts-ignore
    error.code = 'ENGINE_END_EXECUTED';
    // @ts-ignore
    error.type = 'flow';
    throw error;
  }
  
  if (!state.currentNodeId) {
    // Se não há nó atual, consideramos a conversa encerrada.
    return {
      nextState: state,
      events: [
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: null,
          type: 'NO_CURRENT_NODE',
          payload: {
            reason: 'Conversation already finished or not initialized',
          },
        }),
      ],
      output: {
        type: 'noop',
      },
    };
  }

  const node = findNode(flow, state.currentNodeId);
  if (!node) {
    // Problema de definição de fluxo; logamos erro estruturado.
    return {
      nextState: {
        ...state,
        currentNodeId: null,
      },
      events: [
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: state.currentNodeId,
          type: 'ERROR',
          payload: {
            message: `Node not found: ${state.currentNodeId}`,
          },
        }),
      ],
      output: {
        type: 'error',
        message: `Node not found: ${state.currentNodeId}`,
      },
    };
  }

  const handler = registry.get(node.type);

  // Prepara dependências se não foram fornecidas
  // Usa serviços de persistência padrão se deps não foi passado
  const nodeDeps = deps || {
    persistence: persistenceServices,
  };
  
  // Adiciona registry às dependências se disponível (para subfluxos)
  if (registry && !nodeDeps.registry) {
    nodeDeps.registry = registry;
  }
  
  // Extrai replay das dependências se disponível
  const replay = nodeDeps?.replay || null;
  
  // Adiciona replay às dependências se disponível (para compatibilidade)
  if (replay && !nodeDeps.replay) {
    nodeDeps.replay = replay;
  }

  // Log de entrada no nó
  const enterEvent = createEngineEvent({
    sessionId: state.sessionId,
    flowId: state.flowId,
    nodeId: node.id,
    type: 'NODE_ENTER',
  });

  // Hardening por nó:
  // - timeout configurável (config.timeoutMs)
  // - retry controlado (config.retry.maxAttempts)
  // - fallback automático (config.errorFallbackNodeId)
  const timeoutMs =
    node.config && typeof node.config.timeoutMs === 'number' && node.config.timeoutMs > 0
      ? node.config.timeoutMs
      : 0;
  const maxAttempts =
    node.config &&
    node.config.retry &&
    typeof node.config.retry.maxAttempts === 'number' &&
    node.config.retry.maxAttempts > 0
      ? node.config.retry.maxAttempts
      : 1;
  const fallbackNodeId =
    node.config && typeof node.config.errorFallbackNodeId === 'string'
      ? node.config.errorFallbackNodeId
      : null;

  /**
   * Executa o handler com timeout opcional.
   * Passa deps como quarto parâmetro (compatibilidade retroativa: handlers antigos podem ignorar).
   */
  async function callHandlerWithTimeout() {
    // Chama handler com deps como quarto parâmetro
    // Handlers antigos que não esperam deps continuarão funcionando
    const handlerCall = handler(node, state, input, nodeDeps);
    
    if (!timeoutMs) {
      return handlerCall;
    }

    return Promise.race([
      handlerCall,
      new Promise((_, reject) => {
        timers.setTimeout(() => {
          const err = new Error(`Node handler timed out after ${timeoutMs}ms`);
          // Marcamos um campo interno para identificação, se necessário.
          // @ts-ignore
          err.code = 'NODE_TIMEOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
  }

  /** @type {import('./flowTypes').EngineStepOutput|null} */
  let handlerOutput = null;
  /** @type {import('./flowTypes').EngineEvent[]} */
  const handlerEvents = [];

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      // Executa o handler (com timeout, se definido).
      // Importante: mantemos o "state" original como entrada
      // em todos os retries, para evitar efeitos parciais.
      // Qualquer estado final vem de handlerOutput.nextState.
      // eslint-disable-next-line no-await-in-loop
      handlerOutput = await callHandlerWithTimeout();
      break;
    } catch (err) {
      lastError = err;
      
      // Registra erro no replay
      if (replay) {
        replay.recordError(err, node.id, {
          attempt,
          maxAttempts,
          nodeType: node.type,
        });
      }
      
      // Determina tipo de erro para classificação usando sistema centralizado
      let errorType = 'system';
      let errorCode = null;
      let failureCategory = 'FALHA_ESTRUTURAL';
      
      if (lastError && lastError.code === 'NODE_TIMEOUT') {
        errorType = 'timeout';
        errorCode = 'NODE_TIMEOUT';
        failureCategory = 'FALHA_ESTRUTURAL';
      } else if (lastError && lastError.code) {
        errorCode = lastError.code;
        // Usa sistema centralizado de classificação
        failureCategory = classifyErrorType(errorCode);
        
        // Mapeia categoria para errorType (compatibilidade)
        if (lastError.type) {
          errorType = lastError.type;
        } else {
          // Mapeia failureCategory para errorType
          if (failureCategory === 'FALHA_DE_FLUXO') {
            errorType = 'flow';
          } else if (failureCategory === 'FALHA_DE_DADOS') {
            errorType = 'data';
          } else if (failureCategory === 'FALHA_E2E') {
            errorType = 'e2e';
          } else {
            errorType = 'system';
          }
        }
      } else if (lastError && lastError.type) {
        errorType = lastError.type;
        errorCode = lastError.code || null;
      }
      
      // Obtém definição completa do erro se disponível
      const errorDefinition = errorCode ? getErrorDefinition(errorCode) : null;
      
      handlerEvents.push(
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'ERROR',
          payload: {
            message: err && err.message ? err.message : String(err),
            code: errorCode,
            errorType,
            failureCategory, // Categoria padronizada: FALHA_ESTRUTURAL, FALHA_DE_DADOS, FALHA_DE_FLUXO, FALHA_E2E
            category: errorDefinition ? errorDefinition.category : null,
            description: errorDefinition ? errorDefinition.description : null,
            attempt,
            maxAttempts,
            nodeId: node.id,
            nodeType: node.type,
            variablesSnapshot: err.variablesSnapshot || null, // Para router errors
          },
        }),
      );

      // Se ainda há tentativas restantes, continuamos o loop;
      // caso contrário, aplicamos fallback (se configurado).
      if (attempt === maxAttempts) {
        // Falha definitiva do nó.
        function normalizeNextByPort(nodeNext, portKey) {
          if (!nodeNext) return null;
          if (typeof nodeNext === 'string' || Array.isArray(nodeNext)) {
            return normalizeNext(nodeNext);
          }
          if (typeof nodeNext === 'object') {
            const candidate =
              (portKey && nodeNext[portKey] != null ? nodeNext[portKey] : null) ??
              (nodeNext.out != null ? nodeNext.out : null) ??
              (nodeNext.default != null ? nodeNext.default : null);

            if (candidate != null) {
              return normalizeNext(candidate);
            }

            // fallback: primeira entrada do mapa
            const firstVal = Object.values(nodeNext).find((v) => v != null);
            return normalizeNext(firstVal);
          }
          return null;
        }

        const portKeyForFailure = errorCode === 'NODE_TIMEOUT' ? 'timeout' : 'error';
        const fallbackNextNodeId =
          fallbackNodeId != null
            ? fallbackNodeId
            : normalizeNextByPort(node.next, portKeyForFailure);

        // Armazena informações de erro no estado para que o FallbackNode possa acessá-las
        const fallbackState = {
          ...state,
          currentNodeId: fallbackNextNodeId,
          metadata: {
            ...(state.metadata || {}),
            lastError: {
              type: errorType,
              code: errorCode,
              message: lastError && lastError.message ? lastError.message : String(lastError),
              nodeId: node.id,
              nodeType: node.type,
              timestamp: clock.nowIso(),
            },
          },
        };

        handlerOutput = {
          nextState: fallbackState,
          events: [],
          output: {
            type: 'node_error_fallback',
            message: 'Node handler failed after maximum retries',
            errorMessage: lastError && lastError.message ? lastError.message : String(lastError),
            errorType,
            errorCode,
            nodeId: node.id,
            nodeType: node.type,
          },
        };
      }
    }
  }

  // handlerOutput sempre estará definido aqui (ou por sucesso ou por fallback).
  const mergedEvents = handlerEvents.concat(handlerOutput.events || []);

  // Decisão importante:
  // - O próximo nó é definido por:
  //   1) currentNodeId retornado no nextState (se o handler explicitamente mudar
  //      para um valor DIFERENTE do nó atual)
  //   2) ou chosenNext em handlerOutput.output (caso especial, ex: router)
  //   3) ou campo "next" padrão do próprio nó
  //
  // - Isso permite flexibilidade sem acoplar o core a tipos específicos de nós.
  //
  // Observação:
  // - Handlers simples normalmente NÃO alteram currentNodeId; nesse caso,
  //   consideramos que o próximo nó deve ser obtido via output/next do nó.

  let nextNodeId = handlerOutput.nextState.currentNodeId;

  if (nextNodeId === undefined || nextNodeId === state.currentNodeId) {
    // Handler não redefiniu explicitamente o currentNodeId para outro nó;
    // usamos heurísticas em cima do output e do campo next padrão.
    const output = handlerOutput.output || {};
    // Nós interativos: quando emitem opções mas ainda não houve seleção,
    // mantemos o fluxo no mesmo nó, aguardando input do usuário.
    // Isso evita depender de loops no grafo (que são proibidos pelo validador).
    let holdOnCurrentNode = false;
    if (output && typeof output === 'object' && output.type === 'options') {
      const resolvedSelection = output.selectedOption;
      if (resolvedSelection === undefined || resolvedSelection === null || (Array.isArray(resolvedSelection) && resolvedSelection.length === 0)) {
        nextNodeId = node.id;
        holdOnCurrentNode = true;
      }
    }
    // Nós de voz/URA: quando precisam aguardar input (ASR/DTMF), mantemos no mesmo nó.
    if (!holdOnCurrentNode && output && typeof output === 'object' && output.type === 'voice' && output.waitForInput === true) {
      nextNodeId = node.id;
      holdOnCurrentNode = true;
    }
    if (!holdOnCurrentNode && output && typeof output === 'object' && output.type === 'router') {
      nextNodeId = output.chosenNext || normalizeNext(node.next);
    } else if (!holdOnCurrentNode) {
      // Roteamento por portas (sockets):
      // - se node.next for objeto: escolhe pela chave (out/error/timeout/no_match)
      // - caso contrário: comportamento legacy (string/array)
      const isPortMap = node.next && typeof node.next === 'object' && !Array.isArray(node.next);
      if (isPortMap) {
        const portKey =
          output && typeof output === 'object' && (output.type === 'error' || output.type === 'node_error_fallback')
            ? 'error'
            : 'out';

        // Reusa a função local (definida no bloco de fallback acima) se existir no escopo.
        // eslint-disable-next-line no-use-before-define
        const normalizeNextByPort = (nodeNext, portKeyArg) => {
          if (!nodeNext) return null;
          if (typeof nodeNext === 'string' || Array.isArray(nodeNext)) {
            return normalizeNext(nodeNext);
          }
          if (typeof nodeNext === 'object') {
            const candidate =
              (portKeyArg && nodeNext[portKeyArg] != null ? nodeNext[portKeyArg] : null) ??
              (nodeNext.out != null ? nodeNext.out : null) ??
              (nodeNext.default != null ? nodeNext.default : null);

            if (candidate != null) {
              return normalizeNext(candidate);
            }
            const firstVal = Object.values(nodeNext).find((v) => v != null);
            return normalizeNext(firstVal);
          }
          return null;
        };

        nextNodeId = normalizeNextByPort(node.next, portKey);
      } else {
        nextNodeId = normalizeNext(node.next);
      }
    }
  }

  const finalNextState = {
    ...handlerOutput.nextState,
    currentNodeId: nextNodeId,
  };

  const exitEvent = createEngineEvent({
    sessionId: state.sessionId,
    flowId: state.flowId,
    nodeId: node.id,
    type: 'NODE_EXIT',
    payload: {
      nextNodeId,
    },
  });

  // Salva replay se foi criado e nó finalizou (end ou erro)
  if (replay && (nextNodeId === null || node.type === 'end')) {
    replay.stop();
    const replayPath = replay.save(`flow-${state.flowId}-session-${state.sessionId}`);
    // Adiciona replayPath ao estado para acesso posterior
    if (!finalNextState.metadata) {
      finalNextState.metadata = {};
    }
    finalNextState.metadata.replayPath = replayPath;
  }

  return {
    nextState: finalNextState,
    events: [enterEvent, ...mergedEvents, exitEvent],
    output: handlerOutput.output,
  };
}

module.exports = {
  runStep,
};


