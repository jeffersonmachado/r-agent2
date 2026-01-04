import { useState, useCallback, useRef, useEffect } from 'react';
import logger from '../utils/logger';
import { execute as executeAiTask, validateResponse, getFeatureValue } from '../utils/aiExecutor';
import { validateAiTaskNode, validateFlowDoesNotDependExclusivelyOnAI } from '../utils/validateAiTask';
import { fetchJson } from '../api/client';
import { renderTemplate as sharedRenderTemplate } from '@shared/templateRenderer';

/**
 * Hook para executar fluxos de chatbot localmente (sem backend, sem IA).
 * 
 * Implementa uma versão simplificada da engine focada em:
 * - start, message, user_input, router, ai, ai_task, end
 * - Execução determinística e previsível
 * - Validação prévia do fluxo
 * - Sistema de log de execução (trace)
 * - Suporte a templates de variáveis ({{variavel}}) em mensagens e prompts
 * 
 * Nota: Nós do tipo "ai" são simulados no modo de teste (não fazem chamadas reais à IA)
 */

/**
 * Tipos de eventos de log
 */
const LOG_EVENTS = {
  FLOW_START: 'FLOW_START',
  NODE_ENTER: 'NODE_ENTER',
  BOT_MESSAGE: 'BOT_MESSAGE',
  USER_INPUT: 'USER_INPUT',
  DECISION_EVALUATED: 'DECISION_EVALUATED',
  ROUTE_SELECTED: 'ROUTE_SELECTED',
  FLOW_END: 'FLOW_END',
  ERROR: 'ERROR',
  IA_TASK_REQUEST: 'IA_TASK_REQUEST',
  IA_TASK_RESPONSE: 'IA_TASK_RESPONSE',
  IA_TASK_VALIDATED: 'IA_TASK_VALIDATED',
  IA_FALLBACK_USED: 'IA_FALLBACK_USED',
};

export function useFlowRunner(flow) {
  const [conversationState, setConversationState] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [validationResult, setValidationResult] = useState(null);
  const [pendingOutputs, setPendingOutputs] = useState([]);
  const [executionLog, setExecutionLog] = useState([]);
  const flowRef = useRef(flow);
  const processingRef = useRef(false);
  const stepCounterRef = useRef(0);
  const executedNodesRef = useRef(new Set());

  // Atualiza referência quando flow muda
  useEffect(() => {
    flowRef.current = flow;
  }, [flow]);

  /**
   * Adiciona um evento ao log de execução.
   *
   * Também emite eventos globais de sincronização (window) para permitir
   * que o editor destaque o nó ativo sem depender diretamente do chat.
   *
   * @param {string} eventType - Tipo do evento (FLOW_START, NODE_ENTER, etc.)
   * @param {Object} data - Dados do evento (nodeId, nodeType, action, etc.)
   */
  const addLogEvent = useCallback((eventType, data = {}) => {
    stepCounterRef.current += 1;
    const logEntry = {
      step: stepCounterRef.current,
      timestamp: new Date().toISOString(),
      eventType,
      ...data,
    };
    setExecutionLog((prev) => [...prev, logEntry]);

    // Adiciona o nó à lista de executados quando entra em um nó
    if (eventType === LOG_EVENTS.NODE_ENTER && data.nodeId) {
      executedNodesRef.current.add(String(data.nodeId));
    }

    // Emite evento global para sincronizar highlight do nó ativo no editor
    if (typeof window !== 'undefined') {
      try {
        if (eventType === LOG_EVENTS.NODE_ENTER) {
          // Destaca nó atual e envia lista de nós executados
          window.dispatchEvent(
            new CustomEvent('flow-runner-node-enter', {
              detail: {
                nodeId: data.nodeId || null,
                nodeType: data.nodeType || null,
                executedNodeIds: Array.from(executedNodesRef.current), // Lista de todos os nós executados
                flowId: data.flowId || null,
                sessionId: data.sessionId || null,
              },
            }),
          );
        } else if (eventType === LOG_EVENTS.FLOW_END || eventType === LOG_EVENTS.ERROR) {
          // Limpa highlight em fim de fluxo ou erro, mas mantém nós executados
          window.dispatchEvent(
            new CustomEvent('flow-runner-node-enter', {
              detail: {
                nodeId: null,
                nodeType: null,
                executedNodeIds: Array.from(executedNodesRef.current), // Mantém lista
              },
            }),
          );
        }
      } catch (err) {
        // Não deve quebrar a execução se o evento global falhar
        logger.debug('addLogEvent - falha ao emitir evento global', {
          eventType,
          error: err,
        });
      }
    }
  }, []);

  /**
   * Valida o fluxo antes de iniciar.
   */
  const validateFlow = useCallback((flowToValidate) => {
    const errors = [];

    if (!flowToValidate || typeof flowToValidate !== 'object') {
      errors.push({
        code: 'INVALID_FLOW_STRUCTURE',
        message: 'O fluxo deve ser um objeto válido.',
        messageUi: 'Fluxo inválido. Verifique a estrutura do fluxo.',
      });
      return { valid: false, errors };
    }

    if (!Array.isArray(flowToValidate.nodes) || flowToValidate.nodes.length === 0) {
      errors.push({
        code: 'EMPTY_FLOW',
        message: 'O fluxo deve ter pelo menos um nó.',
        messageUi: 'O fluxo está vazio. Adicione pelo menos um nó.',
      });
      return { valid: false, errors };
    }

    const startNodes = flowToValidate.nodes.filter((n) => n.type === 'start');
    if (startNodes.length === 0) {
      errors.push({
        code: 'NO_START_NODE',
        message: 'O fluxo deve ter pelo menos um nó do tipo "start".',
        messageUi: 'O fluxo precisa de um nó de início (start).',
      });
    } else if (startNodes.length > 1) {
      errors.push({
        code: 'MULTIPLE_START_NODES',
        message: 'O fluxo não deve ter múltiplos nós "start".',
        messageUi: 'O fluxo tem múltiplos nós de início. Deve haver apenas um.',
      });
    }

    // Validação de nós ai_task
    const aiTaskNodes = flowToValidate.nodes.filter((n) => n.type === 'ai_task');
    for (const node of aiTaskNodes) {
      const aiErrors = validateAiTaskNode(node, flowToValidate);
      errors.push(...aiErrors);
    }

    // Validação: fluxo não pode depender exclusivamente de IA
    const flowAiErrors = validateFlowDoesNotDependExclusivelyOnAI(flowToValidate);
    errors.push(...flowAiErrors);

    // Validação: verifica se todos os nós referenciados existem
    const nodeIds = new Set(flowToValidate.nodes.map((n) => n.id));
    const missingNodes = new Set();

    for (const node of flowToValidate.nodes) {
      // Verifica campo 'next' (pode ser string, array ou objeto)
      if (node.next) {
        if (typeof node.next === 'string') {
          if (node.next && !nodeIds.has(node.next)) {
            missingNodes.add(node.next);
          }
        } else if (Array.isArray(node.next)) {
          for (const nextId of node.next) {
            if (nextId && !nodeIds.has(nextId)) {
              missingNodes.add(nextId);
            }
          }
        } else if (typeof node.next === 'object') {
          // Para objetos (ex: { retry: 'node1', human: 'node2' })
          for (const nextId of Object.values(node.next)) {
            if (nextId && typeof nextId === 'string' && !nodeIds.has(nextId)) {
              missingNodes.add(nextId);
            }
          }
        }
      }

      // Verifica regras de router
      if (node.type === 'router' && node.config?.rules) {
        for (const rule of node.config.rules) {
          if (rule.next && !nodeIds.has(rule.next)) {
            missingNodes.add(rule.next);
          }
        }
        if (node.config.defaultNext && !nodeIds.has(node.config.defaultNext)) {
          missingNodes.add(node.config.defaultNext);
        }
      }

      // Verifica schedules de schedule_router
      if (node.type === 'schedule_router' && node.config?.schedules) {
        for (const schedule of node.config.schedules) {
          if (schedule.next && !nodeIds.has(schedule.next)) {
            missingNodes.add(schedule.next);
          }
        }
        if (node.config.defaultNext && !nodeIds.has(node.config.defaultNext)) {
          missingNodes.add(node.config.defaultNext);
        }
      }
    }

    // Adiciona erros para nós faltantes
    for (const missingNodeId of missingNodes) {
      errors.push({
        code: 'MISSING_NODE_REFERENCE',
        message: `Nó referenciado não encontrado: ${missingNodeId}`,
        messageUi: `O fluxo referencia um nó que não existe: "${missingNodeId}". Verifique as conexões do fluxo.`,
        nodeId: missingNodeId,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }, []);

  /**
   * Encontra o nó inicial (start) do fluxo.
   */
  const findStartNode = useCallback((flowToSearch) => {
    if (!flowToSearch || !Array.isArray(flowToSearch.nodes)) {
      return null;
    }
    return flowToSearch.nodes.find((n) => n.type === 'start') || null;
  }, []);

  /**
   * Encontra um nó por ID.
   */
  const findNodeById = useCallback((flowToSearch, nodeId) => {
    if (!flowToSearch || !Array.isArray(flowToSearch.nodes)) {
      return null;
    }
    return flowToSearch.nodes.find((n) => n.id === nodeId) || null;
  }, []);

  /**
   * Normaliza o campo "next" de um nó.
   */
  const normalizeNext = useCallback((next) => {
    if (!next) return null;
    if (typeof next === 'string') return next;
    if (Array.isArray(next) && next.length > 0) return next[0];
    return null;
  }, []);

  /**
   * Renderiza um template simples substituindo {{chaves}} por valores
   * das variáveis do estado.
   * 
   * @param {string} template - Template com placeholders {{variavel}}
   * @param {Object<string, any>} variables - Variáveis do estado
   * @returns {string} Template renderizado
   */
  const renderTemplate = useCallback((template, variables) => {
    return sharedRenderTemplate(template, variables);
  }, []);

  /**
   * Gera uma resposta simulada mais natural para a IA
   */
  const generateSimulatedResponse = useCallback((prompt) => {
    try {
      // Simulação básica: se o prompt contém uma pergunta, tenta gerar uma resposta simples
      if (prompt.toLowerCase().includes('perguntou') || prompt.toLowerCase().includes('question')) {
        // Extrai a pergunta do prompt se possível
        const questionMatch = prompt.match(/perguntou[:\s]+(.+?)(?:\.|$)/i);
        if (questionMatch && questionMatch[1]) {
          const question = questionMatch[1].trim();
          // Resposta simulada mais natural, sem mencionar que é simulação
          return `Entendi sua pergunta sobre "${question}". Como posso ajudá-lo com isso?`;
        } else {
          return 'Entendi sua solicitação. Como posso ajudá-lo?';
        }
      } else {
        // Resposta genérica mais natural
        return 'Entendi sua solicitação. Como posso ajudá-lo?';
      }
    } catch (err) {
      logger.warn('Erro ao gerar resposta simulada', err);
      return '[Resposta simulada: IA não disponível no modo de teste]';
    }
  }, []);

  /**
   * Avalia uma condição do router.
   * 
   * Suporta leitura de:
   * - variables[varName] - variáveis normais
   * - context.ai[nodeId].value - resultado de nós ai_task (para intent_classification)
   * - context.ai[nodeId].entities - entidades extraídas (para entity_extraction)
   * 
   * Formato de varName para context.ai:
   * - "ai.<nodeId>.value" - acessa o valor de um nó ai_task
   * - "ai.<nodeId>.confidence" - acessa a confiança
   * - "ai.<nodeId>.entities" - acessa entidades (array)
   */
  const evaluateCondition = useCallback((condition, variables, context = {}) => {
    if (!condition || typeof condition !== 'object') return false;

    const op = condition.op || 'always';
    if (op === 'always') return true;

    // Função auxiliar para obter valor de uma variável ou context.ai
    const getValue = (varName) => {
      // Verifica se é uma referência a context.ai
      if (varName && varName.startsWith('ai.')) {
        const parts = varName.split('.');
        if (parts.length >= 3) {
          const nodeId = parts[1];
          const field = parts[2];
          const aiResult = context?.ai?.[nodeId];
          if (aiResult) {
            if (field === 'value') {
              return aiResult.value;
            }
            if (field === 'confidence') {
              return aiResult.confidence;
            }
            if (field === 'entities') {
              return aiResult.entities;
            }
          }
        }
        return undefined;
      }
      // Caso contrário, lê de variables
      return variables[varName];
    };

    if (op === 'contains') {
      const varName = condition.var;
      const value = condition.value;
      if (!varName) return false;
      const variableValue = String(getValue(varName) ?? '');
      return variableValue.toLowerCase().includes(String(value ?? '').toLowerCase());
    }

    if (op === 'equals') {
      const varName = condition.var;
      if (!varName) return false;
      return getValue(varName) === condition.value;
    }

    return false;
  }, []);

  /**
   * Executa um passo do fluxo.
   */
  const executeStep = useCallback(
    async (state, input) => {
      const currentFlow = flowRef.current;
      if (!currentFlow) {
        const errorMsg = 'Fluxo não disponível';
        addLogEvent(LOG_EVENTS.ERROR, {
          nodeId: null,
          nodeType: null,
          action: 'flow_unavailable',
          error: errorMsg,
        });
        throw new Error(errorMsg);
      }

      // Log de debug para rastrear estado
      logger.debug('Executando passo do fluxo', {
        flowId: currentFlow.id,
        stateFlowId: state.flowId,
        currentNodeId: state.currentNodeId,
        availableNodeIds: currentFlow.nodes?.map(n => n.id) || [],
      });

      // Verifica se o flowId do estado corresponde ao fluxo atual
      if (state.flowId && state.flowId !== currentFlow.id) {
        logger.warn('Incompatibilidade de flowId detectada', {
          stateFlowId: state.flowId,
          currentFlowId: currentFlow.id,
          currentNodeId: state.currentNodeId,
        });
        // Se o flowId não corresponde, reseta para o início do fluxo atual
        const startNode = findStartNode(currentFlow);
        if (startNode) {
          logger.info('Resetando para nó inicial do fluxo atual', {
            newFlowId: currentFlow.id,
            startNodeId: startNode.id,
          });
          return {
            state: {
              ...state,
              flowId: currentFlow.id,
              currentNodeId: startNode.id,
            },
            output: { type: 'start' },
          };
        }
      }

      if (!state.currentNodeId) {
        return {
          state: { ...state },
          output: { type: 'end', message: 'Conversa encerrada' },
        };
      }

      // Verifica se o currentNodeId existe no fluxo atual antes de tentar encontrá-lo
      const nodeIds = new Set(currentFlow.nodes?.map(n => n.id) || []);
      if (!nodeIds.has(state.currentNodeId)) {
        logger.error('currentNodeId não existe no fluxo atual', {
          currentNodeId: state.currentNodeId,
          flowId: currentFlow.id,
          availableNodeIds: Array.from(nodeIds),
        });
        // Tenta resetar para o nó inicial
        const startNode = findStartNode(currentFlow);
        if (startNode) {
          logger.info('Resetando para nó inicial devido a currentNodeId inválido', {
            invalidNodeId: state.currentNodeId,
            startNodeId: startNode.id,
          });
          return {
            state: {
              ...state,
              currentNodeId: startNode.id,
            },
            output: { type: 'start' },
          };
        }
      }

      const node = findNodeById(currentFlow, state.currentNodeId);
      if (!node) {
        // Log detalhado para debug
        logger.error('Nó não encontrado durante execução', {
          missingNodeId: state.currentNodeId,
          flowId: currentFlow.id,
          availableNodeIds: currentFlow.nodes?.map(n => n.id) || [],
          nodeCount: currentFlow.nodes?.length || 0,
        });

        // Tenta encontrar qual nó referenciou este nó faltante
        let referencingNode = null;
        for (const n of currentFlow.nodes || []) {
          if (n.next === state.currentNodeId || 
              (Array.isArray(n.next) && n.next.includes(state.currentNodeId)) ||
              (typeof n.next === 'object' && Object.values(n.next || {}).includes(state.currentNodeId))) {
            referencingNode = n;
            break;
          }
          // Verifica regras de router
          if (n.type === 'router' && n.config?.rules) {
            for (const rule of n.config.rules) {
              if (rule.next === state.currentNodeId) {
                referencingNode = n;
                break;
              }
            }
          }
          // Verifica schedules
          if (n.type === 'schedule_router' && n.config?.schedules) {
            for (const schedule of n.config.schedules) {
              if (schedule.next === state.currentNodeId) {
                referencingNode = n;
                break;
              }
            }
          }
        }
        
        const errorMsg = referencingNode
          ? `Nó não encontrado: "${state.currentNodeId}". Referenciado pelo nó "${referencingNode.id}" (${referencingNode.type}). Verifique se o nó existe no fluxo.`
          : `Nó não encontrado: "${state.currentNodeId}". Verifique se o nó existe no fluxo e se todas as conexões estão corretas.`;
        
        addLogEvent(LOG_EVENTS.ERROR, {
          nodeId: state.currentNodeId,
          nodeType: null,
          action: 'node_not_found',
          error: errorMsg,
          referencingNodeId: referencingNode?.id || null,
          availableNodeIds: currentFlow.nodes?.map(n => n.id) || [],
        });
        throw new Error(errorMsg);
      }

      // Log: Nó entrado
      addLogEvent(LOG_EVENTS.NODE_ENTER, {
        nodeId: node.id,
        nodeType: node.type,
        action: 'node_entered',
      });

      const newState = {
        ...state,
        variables: { ...state.variables },
        // Inicializa context.ai se não existir
        context: {
          ...(state.context || {}),
          ai: { ...(state.context?.ai || {}) },
        },
      };

      let output = null;
      let nextNodeId = null;

      switch (node.type) {
        case 'start':
          nextNodeId = normalizeNext(node.next);
          output = { type: 'start' };
          // Remove ROUTE_SELECTED - não é um router, é apenas uma transição simples
          break;

        case 'message': {
          const messageTemplate = node.config?.text || '';
          const messageText = renderTemplate(messageTemplate, newState.variables);
          nextNodeId = normalizeNext(node.next);
          output = {
            type: 'message',
            text: messageText,
          };
          // Log: Mensagem do bot
          addLogEvent(LOG_EVENTS.BOT_MESSAGE, {
            nodeId: node.id,
            nodeType: node.type,
            action: 'message_sent',
            message: messageText,
          });
          // Remove ROUTE_SELECTED - não é um router
          break;
        }

        case 'user_input':
          if (!input || !input.text) {
            return {
              state: newState,
              output: { type: 'waiting_input' },
            };
          }

          const variableName = node.config?.variable || 'user_input';
          newState.variables[variableName] = input.text;
          nextNodeId = normalizeNext(node.next);
          output = {
            type: 'user_input',
            text: input.text,
            storedAs: variableName,
          };
          // Log: Input do usuário
          addLogEvent(LOG_EVENTS.USER_INPUT, {
            nodeId: node.id,
            nodeType: node.type,
            action: 'input_received',
            input: input.text,
            storedAs: variableName,
          });
          // Remove ROUTE_SELECTED - não é um router
          break;

        case 'router': {
          const rules = node.config?.rules || [];
          let chosenNext = null;
          let matchedRule = null;

          // Log: Avaliação de decisão
          for (const rule of rules) {
            const conditionResult = evaluateCondition(rule.condition, newState.variables, newState.context);
            addLogEvent(LOG_EVENTS.DECISION_EVALUATED, {
              nodeId: node.id,
              nodeType: node.type,
              action: 'condition_evaluated',
              condition: rule.condition,
              result: conditionResult,
              targetNodeId: rule.next,
            });
            if (conditionResult) {
              chosenNext = rule.next || null;
              matchedRule = rule;
              break;
            }
          }

          nextNodeId = chosenNext || normalizeNext(node.next);
          output = {
            type: 'router',
            chosenNext: nextNodeId,
          };
          // Mantém ROUTE_SELECTED apenas aqui, pois é onde há decisão de roteamento
          if (nextNodeId) {
            addLogEvent(LOG_EVENTS.ROUTE_SELECTED, {
              nodeId: node.id,
              nodeType: node.type,
              action: 'route_selected',
              sourceNodeId: node.id,
              targetNodeId: nextNodeId,
              matchedRule: matchedRule ? matchedRule.condition : null,
            });
          }
          break;
        }

        case 'schedule_router': {
          const schedules = node.config?.schedules || [];
          const defaultNext = node.config?.defaultNext || null;
          const timezone = node.config?.timezone || 'UTC';
          let chosenNext = null;
          let matchedSchedule = null;

          try {
            // Obtém data/hora atual considerando timezone
            const now = new Date();
            let currentDate;
            
            if (timezone !== 'UTC') {
              const dateStr = now.toLocaleString('en-US', { timeZone: timezone });
              currentDate = new Date(dateStr);
            } else {
              currentDate = new Date();
            }

            const currentDay = currentDate.getDay();
            const currentHours = String(currentDate.getHours()).padStart(2, '0');
            const currentMinutes = String(currentDate.getMinutes()).padStart(2, '0');
            const currentTime = `${currentHours}:${currentMinutes}`;
            const [currentH, currentM] = currentTime.split(':').map(Number);
            const currentTimeMinutes = currentH * 60 + currentM;

            // Verifica cada horário configurado
            for (const schedule of schedules) {
              if (!schedule.days || !Array.isArray(schedule.days) || !schedule.days.includes(currentDay)) {
                continue;
              }

              const [startH, startM] = schedule.startTime.split(':').map(Number);
              const [endH, endM] = schedule.endTime.split(':').map(Number);
              const startTimeMinutes = startH * 60 + startM;
              const endTimeMinutes = endH * 60 + endM;

              if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes < endTimeMinutes) {
                chosenNext = schedule.next || null;
                matchedSchedule = schedule;
                break;
              }
            }

            if (!chosenNext) {
              chosenNext = defaultNext;
            }
          } catch (err) {
            chosenNext = defaultNext;
          }

          nextNodeId = chosenNext || normalizeNext(node.next) || normalizeNext(node.outputs?.default);
          output = {
            type: 'schedule_router',
            chosenNext: nextNodeId,
            matchedSchedule: matchedSchedule ? matchedSchedule.label : null,
          };

          if (nextNodeId) {
            addLogEvent(LOG_EVENTS.ROUTE_SELECTED, {
              nodeId: node.id,
              nodeType: node.type,
              action: 'schedule_route_selected',
              sourceNodeId: node.id,
              targetNodeId: nextNodeId,
              matchedSchedule: matchedSchedule ? matchedSchedule.label : null,
            });
          }
          break;
        }

        case 'ai_task': {
          // Verifica se já temos resultado em replay (não reexecuta IA durante replay)
          const replayResult = newState.context?.ai?.[node.id];
          let aiResult = null;
          let usedReplay = false;

          if (replayResult) {
            // Modo replay: usa resultado gravado
            aiResult = replayResult;
            usedReplay = true;
            addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
              nodeId: node.id,
              nodeType: node.type,
              action: 'ai_response_replay',
              task: node.config?.task,
              result: aiResult,
              fromReplay: true,
            });
          } else {
            // Execução normal: chama IA
            const task = node.config?.task;
            const taskConfig = node.config || {};
            
            // Obtém input do contexto (geralmente do último user_input)
            const inputText = input?.text || newState.variables?.user_input || '';
            const context = {
              variables: newState.variables,
              history: newState.history || [],
            };

            // Log: Requisição de IA
            addLogEvent(LOG_EVENTS.IA_TASK_REQUEST, {
              nodeId: node.id,
              nodeType: node.type,
              action: 'ai_request',
              task,
              input: inputText,
            });

            try {
              // Executa tarefa de IA
              const aiResponse = await executeAiTask(task, inputText, taskConfig, context);

              // Sempre loga a resposta da IA primeiro (mesmo se não houver match)
              addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
                nodeId: node.id,
                nodeType: node.type,
                action: 'ai_response',
                task,
                result: aiResponse,
                fromReplay: false,
              });

              // Verifica se não houve match (resposta indica que deve usar fallback)
              if (aiResponse._noMatch || aiResponse.value === null) {
                // Nenhum match encontrado: usa fallback
                const fallback = taskConfig.fallback || 'desconhecido';
                aiResult = {
                  value: fallback,
                  confidence: 0.0,
                  _fallbackUsed: true,
                  _reason: 'no_match',
                  _originalResponse: aiResponse,
                };
                addLogEvent(LOG_EVENTS.IA_FALLBACK_USED, {
                  nodeId: node.id,
                  nodeType: node.type,
                  action: 'fallback_used',
                  reason: 'no_match',
                  fallbackValue: fallback,
                  originalResponse: aiResponse,
                });
              } else {
                // Valida resposta
                const validation = validateResponse(aiResponse, task, taskConfig);
                if (!validation.valid) {
                  // Resposta inválida: usa fallback
                  const fallback = taskConfig.fallback || 'desconhecido';
                  aiResult = {
                    value: fallback,
                    confidence: 0.0,
                    _fallbackUsed: true,
                    _reason: 'validation_failed',
                    _validationError: validation.error,
                    _originalResponse: aiResponse,
                  };
                  addLogEvent(LOG_EVENTS.IA_FALLBACK_USED, {
                    nodeId: node.id,
                    nodeType: node.type,
                    action: 'fallback_used',
                    reason: 'validation_failed',
                    error: validation.error,
                    fallbackValue: fallback,
                    originalResponse: aiResponse,
                  });
                } else {
                  // Valida confiança mínima (para intent_classification)
                  if (task === 'intent_classification' && typeof aiResponse.confidence === 'number') {
                    const threshold = taskConfig.confidenceThreshold || 0.75;
                    if (aiResponse.confidence < threshold) {
                      // Confiança baixa: usa fallback
                      const fallback = taskConfig.fallback || 'desconhecido';
                      aiResult = {
                        value: fallback,
                        confidence: aiResponse.confidence,
                        _fallbackUsed: true,
                        _reason: 'low_confidence',
                        _originalValue: aiResponse.value,
                        _originalConfidence: aiResponse.confidence,
                        _originalResponse: aiResponse,
                      };
                      addLogEvent(LOG_EVENTS.IA_FALLBACK_USED, {
                        nodeId: node.id,
                        nodeType: node.type,
                        action: 'fallback_used',
                        reason: 'low_confidence',
                        confidence: aiResponse.confidence,
                        threshold,
                        fallbackValue: fallback,
                        originalResponse: aiResponse,
                      });
                    } else {
                      // Confiança OK: usa resposta da IA
                      aiResult = aiResponse;
                    }
                  } else {
                    // Não é intent_classification ou não tem confiança: usa resposta da IA
                    aiResult = aiResponse;
                  }

                  // Log: Validação bem-sucedida (só se não usou fallback)
                  if (!aiResult._fallbackUsed) {
                    addLogEvent(LOG_EVENTS.IA_TASK_VALIDATED, {
                      nodeId: node.id,
                      nodeType: node.type,
                      action: 'ai_validated',
                      task,
                      result: aiResult,
                    });
                  }
                }
              }
            } catch (error) {
              // Erro na execução: usa fallback
              logger.error('Erro ao executar tarefa de IA', error);
              const fallback = taskConfig.fallback || 'desconhecido';
              aiResult = {
                value: fallback,
                confidence: 0.0,
                _fallbackUsed: true,
                _reason: 'execution_error',
                _error: error.message,
              };
              addLogEvent(LOG_EVENTS.IA_FALLBACK_USED, {
                nodeId: node.id,
                nodeType: node.type,
                action: 'fallback_used',
                reason: 'execution_error',
                error: error.message,
                fallbackValue: fallback,
              });
            }
          }

          // Armazena resultado no contexto
          newState.context.ai[node.id] = aiResult;

          // Avança para o próximo nó
          nextNodeId = normalizeNext(node.next);
          output = {
            type: 'ai_task',
            task: node.config?.task,
            result: aiResult,
            storedIn: `context.ai[${node.id}]`,
          };

          // Remove ROUTE_SELECTED - não é um router
          break;
        }

        case 'ai': {
          // Nó de IA: processa prompt template e gera resposta
          const promptTemplate = node.config?.promptTemplate || '';
          const outputVariable = node.config?.outputVariable || 'ai_output';
          const fallbackText = node.config?.fallbackText || '[Resposta simulada: IA não disponível no modo de teste]';
          
          // Renderiza o prompt substituindo variáveis
          const prompt = renderTemplate(promptTemplate, newState.variables);
          
          // Log: Requisição de IA
          addLogEvent(LOG_EVENTS.IA_TASK_REQUEST, {
            nodeId: node.id,
            nodeType: node.type,
            action: 'ai_request',
            prompt: prompt,
            promptTemplate: promptTemplate,
          });

          // Verifica se IA está habilitada
          let aiResponse = fallbackText;
          const aiEnabled = await getFeatureValue('aiTasksEnabled');
          
          if (!aiEnabled) {
            // IA desabilitada: usa fallback diretamente
            aiResponse = fallbackText;
            addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
              nodeId: node.id,
              nodeType: node.type,
              action: 'ai_response',
              result: aiResponse,
              storedIn: outputVariable,
              simulated: true,
              reason: 'ai_tasks_disabled',
            });
          } else {
            // IA habilitada: tenta fazer chamada real à API de IA
            try {
              const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
              logger.debug('Tentando chamar API de IA', { 
                apiBaseUrl: apiBaseUrl || 'não configurado',
                promptLength: prompt.length,
                nodeId: node.id 
              });
              
              if (apiBaseUrl) {
                // Tenta chamar endpoint de IA no backend
                try {
                  logger.debug('Chamando /api/ai/generate', {
                    prompt: prompt.substring(0, 100),
                    sessionId: newState.sessionId,
                    flowId: newState.flowId,
                    nodeId: node.id,
                  });
                  
                  const response = await fetchJson('/api/ai/generate', {
                    method: 'POST',
                    body: JSON.stringify({
                      prompt,
                      sessionId: newState.sessionId,
                      flowId: newState.flowId,
                      nodeId: node.id,
                    }),
                  });
                  
                  logger.debug('Resposta recebida da API de IA', { 
                    hasText: !!response?.text,
                    responseType: typeof response,
                    responseKeys: response ? Object.keys(response) : []
                  });
                  
                  if (response && response.text) {
                    aiResponse = response.text;
                    logger.info('Resposta de IA obtida com sucesso', {
                      nodeId: node.id,
                      responseLength: aiResponse.length,
                    });
                    addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
                      nodeId: node.id,
                      nodeType: node.type,
                      action: 'ai_response',
                      result: aiResponse,
                      storedIn: outputVariable,
                      simulated: false,
                    });
                  } else {
                    const errorMsg = 'Resposta da API inválida: ' + JSON.stringify(response);
                    logger.error('Resposta inválida da API de IA', {
                      nodeId: node.id,
                      response,
                      error: errorMsg,
                    });
                    throw new Error(errorMsg);
                  }
                } catch (apiError) {
                  logger.error('Erro ao chamar API de IA, usando simulação', {
                    nodeId: node.id,
                    error: apiError.message,
                    errorStack: apiError.stack,
                    errorStatus: apiError.status,
                    errorBody: apiError.body,
                    apiBaseUrl,
                  });
                  // Fallback para simulação se API falhar
                  aiResponse = generateSimulatedResponse(prompt);
                  addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
                    nodeId: node.id,
                    nodeType: node.type,
                    action: 'ai_response',
                    result: aiResponse,
                    storedIn: outputVariable,
                    simulated: true,
                    reason: 'api_error',
                    error: apiError.message,
                    errorStatus: apiError.status,
                  });
                }
              } else {
                // Sem API configurada: usa simulação
                logger.warn('API de IA não configurada (VITE_API_BASE_URL vazio), usando simulação', {
                  nodeId: node.id,
                  env: import.meta.env,
                  hint: 'Configure VITE_API_BASE_URL em config.json → frontend.apiBaseUrl',
                });
                aiResponse = generateSimulatedResponse(prompt);
                addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
                  nodeId: node.id,
                  nodeType: node.type,
                  action: 'ai_response',
                  result: aiResponse,
                  storedIn: outputVariable,
                  simulated: true,
                  reason: 'no_api_configured',
                });
              }
            } catch (err) {
              logger.error('Erro inesperado ao processar resposta de IA', {
                nodeId: node.id,
                error: err.message,
                errorStack: err.stack,
              });
              aiResponse = fallbackText;
              addLogEvent(LOG_EVENTS.IA_TASK_RESPONSE, {
                nodeId: node.id,
                nodeType: node.type,
                action: 'ai_response',
                result: aiResponse,
                storedIn: outputVariable,
                simulated: true,
                reason: 'unexpected_error',
                error: err.message,
              });
            }
          }

          // Armazena a resposta na variável de saída
          newState.variables[outputVariable] = aiResponse;
          nextNodeId = normalizeNext(node.next);
          output = {
            type: 'ai',
            response: aiResponse,
            storedIn: outputVariable,
          };

          // Remove ROUTE_SELECTED - não é um router
          break;
        }

        case 'end':
          newState.currentNodeId = null;
          // Usa opcionalmente uma mensagem configurada no nó de fim
          // ou um texto padrão amigável.
          // eslint-disable-next-line no-case-declarations
          const endMessageTemplate = node.config?.message || 'Conversa encerrada.';
          const endMessage = renderTemplate(endMessageTemplate, newState.variables);
          output = {
            type: 'end',
            message: endMessage,
          };
          // Log: Fim do fluxo
          addLogEvent(LOG_EVENTS.FLOW_END, {
            nodeId: node.id,
            nodeType: node.type,
            action: 'flow_ended',
            message: endMessage,
          });
          break;

        default:
          logger.warn(`Tipo de nó não suportado no chat de teste: ${node.type}`);
          nextNodeId = normalizeNext(node.next);
          output = {
            type: 'unknown',
            nodeType: node.type,
          };
          addLogEvent(LOG_EVENTS.ERROR, {
            nodeId: node.id,
            nodeType: node.type,
            action: 'unsupported_node_type',
            error: `Tipo de nó não suportado: ${node.type}`,
          });
      }

      if (newState.currentNodeId === state.currentNodeId && nextNodeId !== null) {
        newState.currentNodeId = nextNodeId;
      }

      return {
        state: newState,
        output,
      };
    },
    [findNodeById, normalizeNext, evaluateCondition, addLogEvent, renderTemplate]
  );

  /**
   * Processa passos automáticos (start, message, router) até encontrar um nó que precisa de input.
   */
  const processAutomaticSteps = useCallback(
    async (initialState) => {
      if (processingRef.current) return;
      processingRef.current = true;
      setIsProcessing(true);

      try {
        let currentState = initialState;
        const outputs = [];
        const maxSteps = 50;
        let stepCount = 0;

        while (stepCount < maxSteps && currentState.currentNodeId) {
          const node = findNodeById(flowRef.current, currentState.currentNodeId);
          if (!node) break;

          // Se é um nó que precisa de input, para aqui
          if (node.type === 'user_input' || node.type === 'options') {
            break;
          }

          // Executa o passo (incluindo nó 'end' se for o caso)
          // eslint-disable-next-line no-await-in-loop
          const result = await executeStep(currentState, null);
          currentState = result.state;
          outputs.push(result.output);

          stepCount += 1;

          // Se o nó era 'end', ele já foi executado e currentNodeId é null
          // Então o loop vai parar naturalmente na próxima iteração
          if (node.type === 'end') {
            break;
          }
        }

        setConversationState(currentState);
        setPendingOutputs(outputs);
        processingRef.current = false;
        setIsProcessing(false);
      } catch (err) {
        logger.error('Erro ao processar passos automáticos', err);
        const errorMsg = err.message || 'Erro ao processar fluxo';
        setError(errorMsg);
        addLogEvent(LOG_EVENTS.ERROR, {
          nodeId: null,
          nodeType: null,
          action: 'processing_error',
          error: errorMsg,
        });
        processingRef.current = false;
        setIsProcessing(false);
      }
    },
    [executeStep, findNodeById, addLogEvent]
  );

  /**
   * Inicia uma nova conversa.
   */
  const startConversation = useCallback(() => {
    const currentFlow = flowRef.current;
    if (!currentFlow) {
      setError('Fluxo não disponível');
      return false;
    }

    // Log do fluxo para debug
    logger.debug('Validando fluxo antes de iniciar', {
      flowId: currentFlow.id,
      nodeCount: currentFlow.nodes?.length || 0,
      nodeIds: currentFlow.nodes?.map(n => n.id) || [],
    });

    const validation = validateFlow(currentFlow);
    setValidationResult(validation);

    if (!validation.valid) {
      const errorMsg = validation.errors[0]?.messageUi || 'Fluxo inválido';
      logger.error('Validação do fluxo falhou', {
        flowId: currentFlow.id,
        errors: validation.errors,
      });
      setError(errorMsg);
      // Log: Erro de validação
      addLogEvent(LOG_EVENTS.ERROR, {
        nodeId: null,
        nodeType: null,
        action: 'validation_failed',
        error: errorMsg,
        validationErrors: validation.errors,
      });
      return false;
    }

    logger.debug('Validação do fluxo passou', {
      flowId: currentFlow.id,
    });

    const startNode = findStartNode(currentFlow);
    if (!startNode) {
      setError('Nó inicial (start) não encontrado');
      return false;
    }

    const initialState = {
      tenantId: currentFlow.tenantId || 'test-tenant',
      sessionId: `test-${Date.now()}`,
      flowId: currentFlow.id || 'test-flow',
      flowVersion: currentFlow.version || 1,
      currentNodeId: startNode.id,
      variables: {},
      context: {
        ai: {}, // Armazena resultados de nós ai_task
      },
      history: [],
      metadata: {
        mode: 'test',
      },
    };

    // Reset do log
    stepCounterRef.current = 0;
    setExecutionLog([]);
    
    // Log: Início do fluxo
    addLogEvent(LOG_EVENTS.FLOW_START, {
      nodeId: startNode.id,
      nodeType: 'start',
      action: 'flow_started',
      flowId: currentFlow.id || 'test-flow',
      flowVersion: currentFlow.version || 1,
    });

    setConversationState(initialState);
    setError(null);
    setIsRunning(true);
    setPendingOutputs([]);

    processAutomaticSteps(initialState);

    return true;
  }, [validateFlow, findStartNode, processAutomaticSteps]);

  /**
   * Envia uma mensagem do usuário.
   * Aceita string (compatibilidade) ou objeto { text, files }
   */
  const sendMessage = useCallback(
    async (inputData) => {
      if (!isRunning || !conversationState || processingRef.current) {
        return;
      }

      // Compatibilidade: aceita string ou objeto
      const userText = typeof inputData === 'string' ? inputData : (inputData?.text || '');
      const files = typeof inputData === 'object' ? (inputData.files || []) : [];

      // Deve ter texto ou arquivos
      if (!userText.trim() && files.length === 0) {
        return;
      }

      try {
        processingRef.current = true;
        setIsProcessing(true);
        
        // Prepara input com texto e arquivos
        const input = { 
          text: userText.trim(),
          files: files.map(f => ({
            name: f.name,
            type: f.type,
            size: f.size,
            content: f.content,
            preview: f.preview,
          }))
        };
        
        let currentState = conversationState;
        const outputs = [];
        const maxSteps = 50;
        let stepCount = 0;

        // Primeiro passo: processa o user_input
        let result = await executeStep(currentState, input);
        currentState = result.state;
        outputs.push(result.output);

        // Continua processando passos automáticos
        while (stepCount < maxSteps && currentState.currentNodeId) {
          const node = findNodeById(flowRef.current, currentState.currentNodeId);
          if (!node) break;

          // Se é um nó que precisa de input, para aqui
          if (node.type === 'user_input' || node.type === 'options') {
            break;
          }

          // Executa o passo (incluindo nó 'end' se for o caso)
          // eslint-disable-next-line no-await-in-loop
          result = await executeStep(currentState, null);
          currentState = result.state;
          outputs.push(result.output);

          stepCount += 1;

          // Se o nó era 'end', ele já foi executado e currentNodeId é null
          if (node.type === 'end') {
            break;
          }
        }

        setConversationState(currentState);
        setPendingOutputs(outputs);
        processingRef.current = false;
        setIsProcessing(false);
      } catch (err) {
        logger.error('Erro ao processar mensagem', err);
        const errorMsg = err.message || 'Erro ao processar mensagem';
        setError(errorMsg);
        addLogEvent(LOG_EVENTS.ERROR, {
          nodeId: conversationState?.currentNodeId || null,
          nodeType: null,
          action: 'message_processing_error',
          error: errorMsg,
          input: typeof inputData === 'string' ? inputData : inputData?.text || '',
        });
        processingRef.current = false;
        setIsProcessing(false);
      }
    },
    [isRunning, conversationState, executeStep, findNodeById, addLogEvent]
  );

  /**
   * Reinicia a conversa.
   */
  const resetConversation = useCallback(() => {
    setConversationState(null);
    setIsRunning(false);
    setIsProcessing(false);
    setError(null);
    setPendingOutputs([]);
    setExecutionLog([]);
    stepCounterRef.current = 0;
    executedNodesRef.current.clear(); // Limpa nós executados
    processingRef.current = false;
  }, []);

  return {
    conversationState,
    isRunning,
    isProcessing,
    error,
    validationResult,
    pendingOutputs,
    executionLog,
    startConversation,
    sendMessage,
    resetConversation,
  };
}


