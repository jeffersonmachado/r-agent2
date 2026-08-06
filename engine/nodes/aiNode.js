/**
 * Handler de nó de IA.
 *
 * Regras de design:
 * - IA apenas em nós explicitamente do tipo IA (este handler só é usado
 *   se o chamador registrar "ai" no NodeRegistry).
 * - OpenAI (ou qualquer outro) entra apenas como provider intercambiável,
 *   injetado via input (campo aiProvider), nunca acoplado diretamente.
 * - Output da IA é validado contra um JSON Schema simples, definido na
 *   configuração do nó (config.outputSchema).
 * - Falha de IA (erro de provider, JSON inválido, schema inválido) NUNCA
 *   quebra a execução: o handler captura erros, emite eventos de erro
 *   e devolve um output de fallback em vez de lançar exceção.
 */

const { createEngineEvent } = require('../utils');

/**
 * @typedef {import('../flowTypes').ConversationState} ConversationState
 * @typedef {import('../flowTypes').EngineStepOutput} EngineStepOutput
 * @typedef {import('../flowTypes').EngineEvent} EngineEvent
 */

/**
 * Medidas de uso de IA (tipicamente tokens).
 *
 * Observação:
 * - Mantemos um modelo genérico o suficiente para ser preenchido
 *   a partir de qualquer provider (OpenAI, modelos locais, etc.).
 *
 * @typedef {Object} AiUsage
 * @property {number} [promptTokens]
 * @property {number} [completionTokens]
 * @property {number} [totalTokens]
 */

/**
 * Resultado de uma chamada de IA.
 *
 * @typedef {Object} AiResult
 * @property {string} text
 * @property {AiUsage} [usage]
 */

/**
 * Interface esperada de um provider de IA.
 *
 * OpenAI é apenas uma possível implementação deste contrato.
 *
 * generate pode retornar:
 * - string simples (texto)
 * - ou um objeto { text, usage }
 *
 * @typedef {Object} AiProvider
 * @property {(prompt: string, context: AiRequestContext) => Promise<string|AiResult>} generate
 */

/**
 * Contexto enviado ao provider de IA.
 *
 * @typedef {Object} AiRequestContext
 * @property {string} sessionId
 * @property {string} flowId
 * @property {string} nodeId
 * @property {Object<string, any>} variables
 */

/**
 * Clona superficialmente o estado de conversa, mantendo a ideia de
 * imutabilidade (não alteramos o objeto original).
 *
 * @param {ConversationState} state
 * @returns {ConversationState}
 */
function cloneState(state) {
  return {
    ...state,
    variables: { ...state.variables },
    history: Array.isArray(state.history) ? [...state.history] : [],
    metadata: state.metadata ? { ...state.metadata } : undefined,
  };
}

// Teto de itens em state.history: sem cap, o histórico crescia sem limite
// por sessão. 100 itens é folgado para os consumidores atuais:
// - fallbackNode lê apenas as últimas 4 entradas / última mensagem do usuário;
// - aiNode monta o prompt a partir de variables (não lê history);
// - handoff (messageProcessor) exporta o histórico do bot para o ticket —
//   passa a levar no máximo as últimas 100 mensagens.
const MAX_HISTORY_ITEMS = 100;

/**
 * Adiciona um item ao history aplicando o teto (mantém os mais recentes).
 *
 * @param {ConversationState} state
 * @param {Object} item
 */
function pushHistoryItem(state, item) {
  state.history.push(item);
  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history = state.history.slice(-MAX_HISTORY_ITEMS);
  }
}

const { renderTemplate } = require('../utils/templateRenderer');
const { validateJsonSchema } = require('../utils/jsonSchemaValidator');
const { validateCDR, getSafeResponse, generateViolationLog } = require('../../qa/cdrValidator');

// Alias para compatibilidade com código existente
const renderPromptTemplate = renderTemplate;

// Importa serviços RAG (opcional, só se disponível)
let ragService = null;
let configService = null;
let auditService = null;
let logger = null;
try {
  ragService = require('../../api/services/ragService');
  configService = require('../../api/utils/config');
  auditService = require('../../api/services/auditService');
  logger = require('../../api/utils/logger');
} catch (err) {
  // Serviços não disponíveis (ex: em testes)
  // RAG será desabilitado
  // Logger fallback
  logger = {
    error: (msg, data) => console.error(`[aiNode] ${msg}`, data || ''),
    debug: (msg, data) => {},
    info: (msg, data) => console.log(`[aiNode] ${msg}`, data || ''),
  };
}

/**
 * Handler de nó "ai".
 *
 * Config esperada no nó:
 * - promptTemplate: string   (pode conter placeholders {{variavel}})
 * - outputVariable: string   (nome da variável onde o resultado estruturado será salvo)
 * - outputSchema: object     (JSON Schema simples para validação da saída)
 * - fallbackText?: string    (mensagem fallback em caso de falha)
 *
 * Input esperado (opcional):
 * - { aiProvider?: AiProvider }
 *
 * Observação:
 * - Este handler NUNCA decide o próximo nó; isso continua a cargo
 *   do runner (baseado em node.next, routers, etc.).
 *
 * @param {import('../flowTypes').FlowNode} node
 * @param {ConversationState} state
 * @param {{ aiProvider?: AiProvider }} [input]
 * @param {import('../flowTypes').NodeDependencies} [deps] - Dependências opcionais
 * @returns {Promise<EngineStepOutput>}
 */
async function aiNodeHandler(node, state, input, deps = null) {
  const nextState = cloneState(state);

  /** @type {EngineEvent[]} */
  const events = [];

  const config = node.config || {};
  const promptTemplate = config.promptTemplate || '';
  const outputVariable = config.outputVariable || 'ai_output';
  const outputSchema = config.outputSchema || null;
  const fallbackText = config.fallbackText || '[falha temporária ao gerar resposta automática]';

  const aiProvider = input && input.aiProvider;

  // Renderizamos o prompt final substituindo variáveis.
  const prompt = renderPromptTemplate(promptTemplate, nextState.variables || {});

  // Verifica se RAG está habilitado e deve ser usado
  const useRag = config.useRag !== false && ragService && configService;
  const ragMinConfidence = config.ragMinConfidence || 0.45;  // Reduzido de 0.5 para 0.45 para melhorar taxa de sucesso
  // Fallback RAG → IA direta deve ser explícito e configurável (default: false).
  const globalRagFallbackToDirect = !!(configService && configService.get && configService.get('fallbacks.ragFallbackToDirect', false));
  const ragFallbackToDirect = globalRagFallbackToDirect && (config.ragFallbackToDirect !== false);
  const ragEnabled = configService && configService.get('rag.enabled', false);

  let rawResponse = '';
  let parsed = null;
  let validationErrorMessages = [];
  let aiFailed = false;
  let aiErrorMessage = '';
  /** @type {AiUsage|null} */
  let aiUsage = null;
  let ragUsed = false;
  let ragConfidence = 0.0;
  let ragSources = [];

  // Tenta usar RAG se habilitado
  if (useRag && ragEnabled && !outputSchema) {
    // RAG apenas para texto livre (não para JSON estruturado)
    try {
      const tenantId = state.tenantId; // Tenant deve ser fornecido no state
      
      // Prepara filtros (se disponíveis)
      const filters = {
        roles: state.metadata?.agentRoles || [],
        agentId: state.metadata?.agentId || null,
        productId: state.metadata?.productId || null,
        clientId: state.metadata?.clientId || null,
        topK: config.ragTopK || 6,  // Aumentado de 5 para 6 para melhor cobertura
        minScore: ragMinConfidence,
        maxTokens: config.ragMaxTokens || 1000,
      };

      // Registra evento de requisição RAG
      events.push(
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'RAG_QUERY_REQUESTED',
          payload: {
            query: prompt.substring(0, 200), // Primeiros 200 chars para log
          },
        }),
      );

      // Consulta RAG
      const ragResult = await ragService.queryRag(prompt, tenantId, {
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        variables: nextState.variables,
      }, filters);

      if (ragResult.skipped) {
        // Gating por intent (saudação/despedida): o fluxo segue SEM contexto
        // RAG e SEM acionar fallback de erro — ragUsed permanece false e a
        // execução cai para a IA direta abaixo.
        events.push(
          createEngineEvent({
            sessionId: state.sessionId,
            flowId: state.flowId,
            nodeId: node.id,
            type: 'RAG_QUERY_SKIPPED',
            payload: {
              reason: ragResult.reason || 'intent_gated',
              intent: ragResult.intent || null,
            },
          }),
        );
      } else if (ragResult.success && ragResult.confidence >= ragMinConfidence) {
        // RAG bem-sucedido
        rawResponse = ragResult.response || '';
        ragUsed = true;
        ragConfidence = ragResult.confidence || 0.0;
        ragSources = ragResult.sources || [];

        // Registra evento de sucesso RAG
        events.push(
          createEngineEvent({
            sessionId: state.sessionId,
            flowId: state.flowId,
            nodeId: node.id,
            type: 'RAG_QUERY_SUCCESS',
            payload: {
              confidence: ragConfidence,
              chunksFound: ragResult.metadata?.chunksFound || 0,
              sources: ragSources.map(s => s.documentId),
            },
          }),
        );

        // Auditoria (se disponível)
        if (auditService) {
          auditService.logAction({
            agentId: 'system',
            username: 'bot',
            action: 'rag_query_success',
            resource: 'rag',
            resourceId: `${state.sessionId}-${node.id}`,
            details: {
              confidence: ragConfidence,
              chunksFound: ragResult.metadata?.chunksFound || 0,
              sources: ragSources.map(s => s.documentId),
            },
            ipAddress: 'system',
            userAgent: 'bot',
          });
        }
      } else {
        // RAG falhou ou confidence baixa
        if (ragFallbackToDirect) {
          // CRÍTICO: Fallback para IA direta - log como warning/error
          const reason = ragResult.success ? 'low_confidence' : 'rag_failed';
          const severity = ragResult.success ? 'MEDIUM' : 'HIGH';
          
          logger.warn('[aiNode] RAG fallback acionado - usando IA direta', {
            sessionId: state.sessionId,
            flowId: state.flowId,
            nodeId: node.id,
            reason,
            confidence: ragResult.confidence || 0.0,
            error: ragResult.error || null,
            severity,
            alert: 'RAG_FALLBACK_TO_DIRECT',
          });
          
          // Registra no monitoramento de fallbacks
          try {
            const { recordFallback, FALLBACK_TYPES } = require('../fallbackMonitor');
            recordFallback(FALLBACK_TYPES.RAG_FALLBACK_TO_DIRECT, {
              sessionId: state.sessionId,
              flowId: state.flowId,
              nodeId: node.id,
              reason,
              confidence: ragResult.confidence || 0.0,
            });
          } catch (monitorError) {
            // Não falha se monitoramento não estiver disponível
          }
          
          // Fallback para IA direta
          events.push(
            createEngineEvent({
              sessionId: state.sessionId,
              flowId: state.flowId,
              nodeId: node.id,
              type: 'RAG_FALLBACK_TO_DIRECT',
              payload: {
                reason,
                confidence: ragResult.confidence || 0.0,
                error: ragResult.error || null,
                severity,
                alert: 'RAG_FALLBACK_TO_DIRECT',
              },
            }),
          );

          // Auditoria
          if (auditService) {
            auditService.logAction({
              agentId: 'system',
              username: 'bot',
              action: 'rag_fallback_to_direct',
              resource: 'rag',
              resourceId: `${state.sessionId}-${node.id}`,
              details: {
                reason: ragResult.success ? 'low_confidence' : 'rag_failed',
                confidence: ragResult.confidence || 0.0,
              },
              ipAddress: 'system',
              userAgent: 'bot',
            });
          }
        } else {
          // Sem fallback: usa resposta do RAG mesmo com confidence baixa
          rawResponse = ragResult.response || fallbackText;
          ragUsed = true;
          ragConfidence = ragResult.confidence || 0.0;
        }
      }
    } catch (ragError) {
      // CRÍTICO: Erro ao consultar RAG - log com severidade aumentada
      logger.error('[aiNode] ERRO ao consultar RAG', {
        error: ragError.message,
        errorStack: ragError.stack,
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        severity: 'HIGH',
        alert: 'RAG_QUERY_ERROR',
      });

      events.push(
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'RAG_QUERY_FAILED',
          payload: {
            error: ragError.message,
          },
        }),
      );

      // Auditoria
      if (auditService) {
        auditService.logAction({
          agentId: 'system',
          username: 'bot',
          action: 'rag_query_failed',
          resource: 'rag',
          resourceId: `${state.sessionId}-${node.id}`,
          details: {
            error: ragError.message,
          },
          ipAddress: 'system',
          userAgent: 'bot',
        });
      }

      // Se fallback habilitado, continua para IA direta
      if (!ragFallbackToDirect) {
        // Sem fallback: retorna erro
        aiFailed = true;
        aiErrorMessage = 'RAG indisponível';
      }
    }
  }

  // Se RAG não foi usado ou falhou com fallback, usa IA direta
  if (!ragUsed && (!aiFailed || ragFallbackToDirect)) {
    // Verifica se temos provider
    if (!aiProvider || typeof aiProvider.generate !== 'function') {
      // CRÍTICO: Sem provider de IA - log como erro crítico
      logger.error('[aiNode] CRÍTICO: Provider de IA não disponível', {
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        reason: 'NO_PROVIDER',
        severity: 'CRITICAL',
        alert: 'AI_PROVIDER_MISSING',
      });
      
      // Registra no monitoramento de fallbacks
      try {
        const { recordFallback, FALLBACK_TYPES } = require('../fallbackMonitor');
        recordFallback(FALLBACK_TYPES.AI_NODE_NO_PROVIDER, {
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
        });
      } catch (monitorError) {
        // Não falha se monitoramento não estiver disponível
      }
      
      // Sem provider de IA: não quebramos o fluxo, apenas registramos erro
      // e retornamos saída de fallback.
      events.push(
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'AI_ERROR',
          payload: {
            reason: 'NO_PROVIDER',
            severity: 'CRITICAL',
            alert: 'AI_PROVIDER_MISSING',
          },
        }),
      );

      const historyItem = {
        id: `${state.sessionId}-ai-${Date.now()}`,
        role: 'bot',
        type: 'message',
        text: fallbackText,
        timestamp: new Date().toISOString(),
        nodeId: node.id,
        payload: {
          aiUnavailable: true,
        },
      };
      pushHistoryItem(nextState, historyItem);

      /** @type {EngineStepOutput} */
      const result = {
        nextState,
        events,
        output: {
          type: 'ai_unavailable',
          text: fallbackText,
        },
      };
      return result;
    }

    // Emitimos evento de requisição de IA (auditável).
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'AI_REQUESTED',
        payload: {
          prompt,
        },
      }),
    );

    try {
      const providerResult = await aiProvider.generate(prompt, {
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        variables: nextState.variables,
      });
      if (providerResult && typeof providerResult === 'object' && Object.prototype.hasOwnProperty.call(providerResult, 'text')) {
        rawResponse = providerResult.text != null ? String(providerResult.text) : '';
        aiUsage = providerResult.usage || null;
      } else {
        rawResponse = providerResult != null ? String(providerResult) : '';
      }

      // Processa resposta se não falhou
      if (outputSchema) {
        let json;
        try {
          json = JSON.parse(rawResponse);
        } catch (err) {
          aiFailed = true;
          aiErrorMessage = 'Resposta de IA não é JSON válido';
        }

        if (!aiFailed) {
          const validation = validateJsonSchema(outputSchema, json);
          if (!validation.valid) {
            aiFailed = true;
            validationErrorMessages = validation.errors;
            aiErrorMessage = 'Resposta de IA não atende ao JSON Schema definido';
          } else {
            parsed = json;
          }
        }
      } else {
        // Sem schema: consideramos a resposta como texto puro
        parsed = rawResponse;
      }
    } catch (err) {
      aiFailed = true;
      aiErrorMessage = err && err.message ? err.message : String(err);
    }
  }

  // Validação CDR (Capability-Driven Responses)
  // Verifica se a resposta está dentro das capacidades permitidas
  if (!aiFailed && rawResponse) {
    const textToValidate = typeof parsed === 'string' ? parsed : rawResponse;
    const cdrValidation = validateCDR(textToValidate);
    
    if (cdrValidation.status === 'error') {
      // Resposta viola regras CDR - bloqueia em produção/QA
      const violationLog = generateViolationLog(cdrValidation, textToValidate);
      logger.error('[aiNode] Resposta viola regras CDR e foi bloqueada', {
        sessionId: state.sessionId,
        violation: violationLog,
      });

      events.push(
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'AI_ERROR',
          payload: {
            reason: 'CDR_VIOLATION',
            code: cdrValidation.code,
            message: cdrValidation.message,
            violation: violationLog,
          },
        }),
      );

      // Em produção/QA: trata como falha e usa resposta segura
      aiFailed = true;
      aiErrorMessage = `Resposta viola regras CDR: ${cdrValidation.code}`;
      // Substitui resposta por resposta segura
      rawResponse = getSafeResponse();
      parsed = typeof parsed === 'string' ? getSafeResponse() : parsed;
    } else if (cdrValidation.status === 'warn') {
      // Desenvolvimento: apenas registra warning mas permite resposta
      const violationLog = generateViolationLog(cdrValidation, textToValidate);
      logger.warn('[aiNode] Resposta viola regras CDR (dev mode)', {
        sessionId: state.sessionId,
        violation: violationLog,
      });

      events.push(
        createEngineEvent({
          sessionId: state.sessionId,
          flowId: state.flowId,
          nodeId: node.id,
          type: 'AI_WARNING',
          payload: {
            reason: 'CDR_WARNING',
            code: cdrValidation.code,
            message: cdrValidation.message,
            violation: violationLog,
          },
        }),
      );
    }
  }

  if (aiFailed) {
    // Registramos evento de erro, mas NÃO quebramos a execução.
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'AI_ERROR',
        payload: {
          message: aiErrorMessage,
          validationErrors: validationErrorMessages,
        },
      }),
    );

    const historyItem = {
      id: `${state.sessionId}-ai-${Date.now()}`,
      role: 'bot',
      type: 'message',
      text: fallbackText,
      timestamp: new Date().toISOString(),
      nodeId: node.id,
      payload: {
        aiError: true,
        aiErrorMessage,
        validationErrors: validationErrorMessages,
      },
    };
    pushHistoryItem(nextState, historyItem);

    /** @type {EngineStepOutput} */
    const result = {
      nextState,
      events,
      output: {
        type: 'ai_error',
        text: fallbackText,
      },
    };
    return result;
  }

  // Sucesso: resposta de IA válida conforme schema (se definido).
  // Atualizamos variável configurável com o resultado "parsed".
  nextState.variables[outputVariable] = parsed;

  const textForUser = typeof parsed === 'string' ? parsed : rawResponse;

  const historyItem = {
    id: `${state.sessionId}-ai-${Date.now()}`,
    role: 'bot',
    type: 'message',
    text: textForUser,
    timestamp: new Date().toISOString(),
    nodeId: node.id,
    payload: {
      rawResponse,
    },
  };
  pushHistoryItem(nextState, historyItem);

  // Evento de uso de IA (tokens/medidas), se fornecido pelo provider.
  if (aiUsage) {
    events.push(
      createEngineEvent({
        sessionId: state.sessionId,
        flowId: state.flowId,
        nodeId: node.id,
        type: 'AI_USAGE',
        payload: {
          usage: aiUsage,
        },
      }),
    );
  }

  // Também emitimos um evento de saída de mensagem para que o
  // replay de conversa consiga exibir a resposta da IA na timeline.
  events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'MESSAGE_OUT',
      payload: {
        text: textForUser,
        source: 'ai',
      },
    }),
  );

  events.push(
    createEngineEvent({
      sessionId: state.sessionId,
      flowId: state.flowId,
      nodeId: node.id,
      type: 'AI_RESPONSE',
      payload: {
        // Armazenamos apenas uma versão possivelmente truncada
        // para logs, evitando payloads gigantes.
        rawPreview: rawResponse.slice(0, 500),
      },
    }),
  );

  /** @type {EngineStepOutput} */
  const result = {
    nextState,
    events,
    output: {
      type: 'ai',
      text: textForUser,
      variable: outputVariable,
    },
  };

  return result;
}

module.exports = {
  aiNodeHandler,
};


