/**
 * Processador de mensagens do WhatsApp integrado à engine de fluxo.
 *
 * Responsabilidades:
 * - Transformar webhooks do WhatsApp em chamadas para a engine.
 * - Manter um mapa simples de sessões em memória (sessionId -> ConversationState).
 * - Enviar respostas da engine de volta ao usuário via WhatsApp.
 */

const { executeStep } = require('../../engine/executeStep');
const { NodeRegistry } = require('../../engine/nodeRegistry');
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
} = require('../../engine/nodes/basicNodes');
const { aiNodeHandler } = require('../../engine/nodes/aiNode');
const { aiTaskNodeHandler } = require('../../engine/nodes/aiTaskNode');
const { semanticRouterNodeHandler } = require('../../engine/nodes/semanticRouterNode');
const { ragAnswerNodeHandler } = require('../../engine/nodes/ragAnswerNode');
const { businessEntryNodeHandler } = require('../../engine/nodes/businessEntryNode');
const {
  getFlowInfoNodeHandler,
  getQueueStatusNodeHandler,
  getConfigValueNodeHandler,
  listFlowsNodeHandler,
} = require('../../engine/nodes/persistenceNodes');
const {
  getCurrentTimeNodeHandler,
  generateUuidNodeHandler,
  delayNodeHandler,
  formatDateNodeHandler,
  randomNumberNodeHandler,
  getUserInfoNodeHandler,
} = require('../../engine/nodes/systemNodes');
const { apiNodeHandler } = require('../../engine/nodes/apiNode');
const { fallbackNodeHandler } = require('../../engine/nodes/fallbackNode');
const { mergeNodeHandler } = require('../../engine/nodes/mergeNode');
const {
  voicePromptListenNodeHandler,
  voiceListenAsrNodeHandler,
  voiceGatherDtmfNodeHandler,
  voiceBranchNodeHandler,
  voiceTransferRamalNodeHandler,
  voiceTransferFilaNodeHandler,
  voiceTransferUtilsNodeHandler,
  voiceHangupNodeHandler,
} = require('../../engine/nodes/voiceNodes');
const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
const outboundQueueService = require('./outboundQueueService');
const logger = require('../utils/logger');
const { createTicket, getTicketBySession, updateLastMessage, getTicket } = require('./queueService');
const { 
  createHumanSession, 
  isInHumanSession, 
  getHumanSession 
} = require('../../engine/services/humanLiveAdapter');
const { ESCALATION_MODES } = require('../../engine/fallbackController');
const { emitEvent } = require('./websocketService');
const config = require('../utils/config');
const { checkLimit } = require('./planLimitsService');
const { getAiProviderForTenant } = require('../../engine/aiProviderManager');
const { validateCDR, getSafeResponse, generateViolationLog } = require('../../qa/cdrValidator');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');
const { normalizeInboundEvent } = require('./normalizeInboundEvent');
const { conversationSessionStore, buildConversationSessionKey } = require('./conversationSessionStore');
const { transitionFunnelState, createDefaultFunnelState } = require('./funnelStateService');
const { decideNextResponse } = require('./decisionOrchestrator');
const { appendEventV1 } = require('./eventLedgerService');
const path = require('path');

module.exports.processWhatsAppMessage = (...args) => processWhatsAppMessage(...args);
module.exports.processNormalizedInboundEvent = (...args) => processNormalizedInboundEvent(...args);

// Sessões em memória (para produção, ideal mover para Redis/DB)
/** @type {Map<string, import('../../engine/flowTypes').ConversationState>} */
const sessions = new Map();
const messageMetrics = {
  total: 0,
  handoff: 0,
  conversionByStage: {},
};

/**
 * Cria um NodeRegistry completo com todos os handlers padrão.
 *
 * @returns {NodeRegistry}
 */
function createNodeRegistry() {
  const registry = new NodeRegistry();
  registry.register('start', startNodeHandler);
  registry.register('message', messageNodeHandler);
  registry.register('user_input', userInputNodeHandler);
  registry.register('options', optionsNodeHandler);
  registry.register('merge', mergeNodeHandler);
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
  registry.register('get_flow_info', getFlowInfoNodeHandler);
  registry.register('get_queue_status', getQueueStatusNodeHandler);
  registry.register('get_config_value', getConfigValueNodeHandler);
  registry.register('list_flows', listFlowsNodeHandler);
  // Nós de sistema
  registry.register('get_current_time', getCurrentTimeNodeHandler);
  registry.register('generate_uuid', generateUuidNodeHandler);
  registry.register('delay', delayNodeHandler);
  registry.register('format_date', formatDateNodeHandler);
  registry.register('random_number', randomNumberNodeHandler);
  registry.register('get_user_info', getUserInfoNodeHandler);
  // Nó de API
  registry.register('api', apiNodeHandler);
  // Nó de fallback
  registry.register('fallback', fallbackNodeHandler);
  // Nó de subfluxo
  registry.register('subflow', subflowNodeHandler);
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
 * Cria estado inicial de conversa para um número do WhatsApp.
 *
 * @param {import('../../engine/flowTypes').FlowDefinition} flow
 * @param {string} sessionId
 * @param {string} from
 * @returns {import('../../engine/flowTypes').ConversationState}
 */
function createInitialState(flow, sessionId, from) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const startNode = nodes.find((n) => n && n.type === 'start');

  return {
    tenantId: flow.tenantId,
    sessionId,
    flowId: flow.id,
    flowVersion: flow.version,
    currentNodeId: startNode ? startNode.id : null,
    variables: {},
    history: [],
    metadata: {
      channel: 'whatsapp',
      phoneNumber: from,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Processa uma mensagem vinda do webhook do WhatsApp.
 *
 * @param {any} message - Objeto de mensagem do webhook do WhatsApp (value.messages[i])
 * @param {any} value - Objeto "value" completo do webhook (contém metadata da conversation)
 * @param {{ flows: Map<string, any>, sessionEvents: Map<string, any[]>, saveSessionEvents?: () => void, tenantId?: string|null, conversationId?: string|null, channelType?: string|null, flowId?: string|null, sessionId?: string|null }} deps
 */
async function processWhatsAppMessage(message, value, deps) {
  const processStartedAt = Date.now();
  const {
    flows,
    sessionEvents,
    saveSessionEvents,
    tenantId: inboundTenantId,
    conversationId,
    flowId: explicitFlowId,
    sessionId: explicitSessionId,
  } = deps || {};
  const effectiveChannelType = (deps && deps.channelType && String(deps.channelType).trim())
    ? String(deps.channelType).trim()
    : 'whatsapp';

  const from = message.from; // número do usuário (ex.: "5511999999999")
  const text = message.text && message.text.body ? String(message.text.body) : '';
  const messageId = message.id;
  const inboundContactName = (() => {
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    const matched = contacts.find((c) => String(c?.wa_id || '').trim() === String(from || '').trim()) || contacts[0];
    const profileName = String(matched?.profile?.name || '').trim();
    return profileName || null;
  })();
  const fallbackSessionId = explicitSessionId && String(explicitSessionId).trim()
    ? String(explicitSessionId).trim()
    : `${effectiveChannelType}_${from}`;
  const normalized = normalizeInboundEvent({ message, value }, {
    deps: {
      ...(deps || {}),
      sessionId: fallbackSessionId,
      channelType: effectiveChannelType,
    },
  });
  const normalizedEvent = normalized.event;
  const traceId = normalizedEvent.trace_id;
  const sessionId = normalizedEvent.session_id;
  const sessionKey = buildConversationSessionKey({
    tenantId: inboundTenantId || normalizedEvent.tenant_id || 'unknown',
    sessionId,
  });

  async function sendWhatsAppTextBestEffort(to, textToSend) {
    const effectiveTenantId = inboundTenantId || state?.tenantId;
    if (!effectiveTenantId) {
      logger.warn('[MessageProcessor] TenantId ausente; outbound ignorado (best-effort)', {
        to,
        messageId: messageId ? String(messageId) : null,
        conversationId: conversationId || null,
        sessionId,
        trace_id: traceId,
        tenant_id: effectiveTenantId || null,
        lead_id: from || null,
        channel: effectiveChannelType,
      });
      return null;
    }

    return outboundQueueService.enqueueOutbound({
      tenantId: effectiveTenantId,
      channelType: effectiveChannelType,
      conversationId: conversationId || null,
      message: {
        to,
        type: 'text',
        body: { text: textToSend },
      },
    });
  }

  // Inicializa replay (opcional)
  const shouldRecordReplay = process.env.ENABLE_MESSAGE_REPLAY !== 'false';
  const shouldRecord = process.env.ENABLE_MESSAGE_RECORDING !== 'false';
  let replay = null;
  let replayId = null;
  let recording = null;
  let recordingId = null;
  
  if (shouldRecordReplay) {
    const tenantId = inboundTenantId || null;
    replay = new ReplaySystem({
      storagePath: path.join(process.cwd(), 'replays', 'message'),
      tenantId,
      context: 'message',
      enableScreenshots: false,
    });
    
    const prefix = tenantId ? `${tenantId}-` : '';
    replayId = `${prefix}message-${sessionId}-${Date.now()}`;
    replay.start(replayId, {
      tenantId,
      sessionId,
      messageId,
      from,
    });
  }

  if (shouldRecord) {
    const tenantId = inboundTenantId || null;
    recording = new RecordingSystem({
      storagePath: path.join(process.cwd(), 'recordings', 'message'),
      tenantId,
      context: 'message',
      enableTimestamps: true,
    });
    
    const prefix = tenantId ? `${tenantId}-` : '';
    recordingId = `${prefix}message-${sessionId}-${Date.now()}`;
    recording.start(recordingId, {
      name: 'Processamento de Mensagem WhatsApp',
      description: 'Processamento de mensagem do WhatsApp',
      tenantId,
      sessionId,
      messageId,
      from,
      source: 'automatic',
    });
    recording.recordAction({
      type: 'message-process',
      step: 'process',
      value: { messageId, from, text: text.substring(0, 200) },
    });
  }

  if (!inboundTenantId || typeof inboundTenantId !== 'string' || inboundTenantId.trim() === '') {
    // Blindagem: nunca processa inbound sem tenant explícito (evita cross-tenant)
    logger.warn('[MessageProcessor] TenantId ausente no inbound; mensagem ignorada', {
      from,
      messageId: messageId ? String(messageId) : null,
      conversationId: conversationId || null,
      trace_id: traceId,
      tenant_id: inboundTenantId || null,
      session_id: sessionId,
      lead_id: from || null,
      channel: effectiveChannelType,
    });
    return;
  }

  let state = await conversationSessionStore.get(sessionKey);
  if (!state) {
    state = sessions.get(sessionId);
  }

  // Verifica se já existe ticket ativo (handoff em andamento)
  // Importante: em ambiente multi-tenant, sessionId pode colidir; preferimos filtrar por tenant quando possível.
  const existingTicket = getTicketBySession(sessionId, inboundTenantId);
  // Regra do handover (Fase 2):
  // - ticket.mode=human => engine não responde automaticamente
  // - ticket.mode=bot => engine continua (ticket existe, mas bot está no controle)
  const ticketMode = existingTicket ? (existingTicket.mode || 'bot') : null;
  if (existingTicket && existingTicket.status !== 'closed' && (ticketMode === 'human' || ticketMode === 'paused')) {
    if (replay) {
      replay.recordEvent('ticket_active', { ticketId: existingTicket.id });
      replay.stop();
      replay.save(replayId);
    }
    if (recording) {
      recording.recordAction({
        type: 'ticket-active',
        step: 'ticket-active',
        value: { ticketId: existingTicket.id },
      });
      recording.stop();
      recording.save(recordingId);
    }
    
    // Atualiza última mensagem do usuário no ticket e adiciona ao histórico (idempotente por externalMessageId)
    const ts = message?.timestamp ? Number(message.timestamp) : null;
    const iso = ts && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
    updateLastMessage(existingTicket.id, text, messageId ? String(messageId) : null, iso);
    
    // Emite evento WebSocket para notificar sobre nova mensagem do usuário
    const ticket = getTicket(existingTicket.id);
    if (ticket) {
      const tenantId = ticket.tenantId;
      // Inclui ticket completo no evento WebSocket para evitar requisições HTTP no frontend
      emitEvent('ticket.message.received', {
        ticketId: ticket.id,
        message: text,
        sender: 'user',
        ticket: ticket, // Ticket completo para atualização local sem requisição HTTP
      }, { tenantId, agentId: ticket.assignedTo });
    }
    
    // Não processa mensagens do bot durante atendimento humano/pausado assíncrono
    // O atendente deve responder manualmente via painel
    // A mensagem já foi adicionada ao histórico e será exibida na interface
    return;
  }
  
  // Verifica se está em atendimento humano síncrono
  if (isInHumanSession(sessionId)) {
    if (replay) {
      replay.recordEvent('human_session_active');
      replay.stop();
      replay.save(replayId);
    }
    if (recording) {
      recording.recordAction({
        type: 'human-session-active',
        step: 'human-session-active',
        value: { sessionId },
      });
      recording.stop();
      recording.save(recordingId);
    }
    
    // Durante atendimento humano síncrono, mensagens são roteadas para o humano via WebSocket
    // (best-effort). Se existir ticket associado à sessão, atualiza o histórico também.
    const ts = message?.timestamp ? Number(message.timestamp) : null;
    const iso = ts && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
    const humanSession = getHumanSession(sessionId);
    let ticket = null;

    try {
      const ticketFromSession = getTicketBySession(sessionId, inboundTenantId);
      if (ticketFromSession && ticketFromSession.status !== 'closed') {
        updateLastMessage(ticketFromSession.id, text, messageId ? String(messageId) : null, iso);
        ticket = getTicket(ticketFromSession.id);
        if (ticket) {
          emitEvent('ticket.message.received', {
            ticketId: ticket.id,
            message: text,
            sender: 'user',
            ticket,
          }, { tenantId: ticket.tenantId, agentId: ticket.assignedTo });
        }
      }
    } catch (_) {}

    try {
      emitEvent('human.live.message.received', {
        sessionId,
        humanSessionId: humanSession?.humanSessionId || null,
        tenantId: inboundTenantId || null,
        message: text,
        sender: 'user',
        channel: effectiveChannelType,
        phoneNumber: from,
        conversationId: conversationId || null,
        ticketId: ticket?.id || null,
        timestamp: iso || new Date().toISOString(),
      }, { tenantId: inboundTenantId || ticket?.tenantId || null });
    } catch (_) {}

    logger.debug(`[MessageProcessor] Mensagem recebida durante atendimento humano síncrono: ${sessionId}`, {
      trace_id: traceId,
      tenant_id: inboundTenantId,
      session_id: sessionId,
      lead_id: from || null,
      channel: effectiveChannelType,
    });
    return;
  }

  // Se não existe sessão, cria nova baseada em um fluxo padrão
  if (!state) {
    const selectedFlowId = explicitFlowId && String(explicitFlowId).trim()
      ? String(explicitFlowId).trim()
      : config.get('flows.defaultFlowId');
    
    // Valida se defaultFlowId não é um placeholder
    if (!selectedFlowId || selectedFlowId === 'ID_DO_FLUXO_PADRAO' || selectedFlowId.includes('SEU_') || selectedFlowId.includes('YOUR_')) {
        logger.error('[ERROR] FlowId não configurado ou é placeholder. Configure botFlowId da conexão ou flows.defaultFlowId em config.json');
      try {
        await sendWhatsAppTextBestEffort(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
      }
      return;
    }

    const flow = flows.get(selectedFlowId);
    if (!flow) {
      logger.error(`[ERROR] Flow "${selectedFlowId}" não encontrado. Verifique se o fluxo existe e se botFlowId da conexão (ou flows.defaultFlowId) está correto`);
      try {
        await sendWhatsAppTextBestEffort(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
      }
      return;
    }

    state = createInitialState(flow, sessionId, from);
    // Ajusta canal (sem quebrar compatibilidade): para canais não-whatsapp,
    // mantém o mesmo pipeline mas muda o metadado do canal.
    if (state && state.metadata) {
      state.metadata.channel = effectiveChannelType;
    }
  }

  if (state && typeof state === 'object') {
    if (!state.metadata || typeof state.metadata !== 'object') state.metadata = {};
    if (inboundContactName) {
      state.metadata.contactName = inboundContactName;
    }
  }

  const flow = flows.get(state.flowId);
  if (!flow) {
    logger.error(`[ERROR] Flow "${state.flowId}" não encontrado. Verifique se o fluxo existe.`);
    try {
      await sendWhatsAppTextBestEffort(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
    } catch (err) {
      logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
    }
    return;
  }

  const currentNode = Array.isArray(flow?.nodes)
    ? flow.nodes.find((n) => n && String(n.id) === String(state.currentNodeId || ''))
    : null;
  const shouldRestartState = !state.currentNodeId || (currentNode && currentNode.type === 'end');
  if (shouldRestartState) {
    const restartedState = createInitialState(flow, sessionId, from);
    if (!restartedState.metadata || typeof restartedState.metadata !== 'object') restartedState.metadata = {};
    restartedState.metadata = {
      ...restartedState.metadata,
      ...(state.metadata && typeof state.metadata === 'object' ? state.metadata : {}),
      restartedAt: new Date().toISOString(),
      restartedReason: 'current_node_missing',
    };
    state = restartedState;
  }

  let compiledFlow;
  try {
    compiledFlow = getOrCompileFlow(flow);
  } catch (err) {
    if (err?.code === 'AI_FLOW_INVALID_AT_EXECUTION') {
      logger.warn('[MessageProcessor] Execução bloqueada: fluxo de IA inválido na revalidação', {
        flowId: state.flowId,
        tenantId: state.tenantId,
        errors: err?.details?.errors || null,
      });
      try {
        await sendWhatsAppTextBestEffort(from, 'Este fluxo foi gerado por IA mas ainda não está consistente para execução. Um administrador precisa revisar/ajustar antes de ativar.');
      } catch {}
      return;
    }
    throw err;
  }
  const registry = createNodeRegistry();

  // Execution ledger (DB-first) - best-effort
  // Mantém um executionId por sessão (em memória) para anexar node_executions por mensagem.
  try {
    if (process.env.ENABLE_EXECUTION_LEDGER !== 'false') {
      const existingExecutionId = state?.metadata?.executionId || null;
      if (!existingExecutionId) {
        // eslint-disable-next-line global-require
        const { startFlowExecution } = require('./flowExecutionLedgerService');
        const started = await startFlowExecution({
          tenantId: inboundTenantId,
          flowId: state.flowId,
          flowVersion: state.flowVersion,
          sessionId,
          correlationId: conversationId ? String(conversationId) : `channel:${effectiveChannelType}:${sessionId}`,
          subjectType: 'channel_session',
          subjectId: sessionId,
          meta: {
            mode: 'message',
            channelType: effectiveChannelType,
            phoneNumber: from,
            conversationId: conversationId || null,
          },
        });
        if (started && started.ok) {
          if (!state.metadata) state.metadata = {};
          state.metadata.executionId = started.executionId;
        }
      }
    }
  } catch (_) {}

  // Executa UM passo com input do usuário
  const persistenceServices = require('../../engine/services/persistenceServices');
  
  // Obtém provider de IA para o tenant (para nós AI)
  const tenantId = state.tenantId; // Tenant deve ser fornecido no state
  const aiProvider = getAiProviderForTenant(tenantId);

  // Adapter do execution ledger para a engine (best-effort).
  // Importante: sanitiza input/output para evitar JSON inválido (ex.: funções como aiProvider).
  let executionLedgerAdapter = null;
  try {
    if (process.env.ENABLE_EXECUTION_LEDGER !== 'false') {
      const executionId = state?.metadata?.executionId || null;
      if (executionId) {
        // eslint-disable-next-line global-require
        const { buildExecutionLedgerAdapter } = require('./flowExecutionLedgerService');
        executionLedgerAdapter = buildExecutionLedgerAdapter({
          tenantId: inboundTenantId,
          executionId,
          sanitizeInput: () => ({
            text,
            messageId,
            channel: effectiveChannelType,
            // Mantemos raw fora do ledger (pode ser grande/variável)
          }),
          sanitizeOutput: (outObj) => (outObj && typeof outObj === 'object' ? outObj : {}),
        });
      }
    }
  } catch (_) {}
  
  // Registra início do processamento
  if (replay) {
    replay.recordEvent('message_processing_started', {
      flowId: state.flowId,
      currentNodeId: state.currentNodeId,
    });
  }
  if (recording) {
    recording.recordAction({
      type: 'message-processing',
      step: 'processing-started',
      value: { flowId: state.flowId, currentNodeId: state.currentNodeId },
    });
  }
  
  const stepStartTime = new Date().toISOString();
  let result;
  try {
    // eslint-disable-next-line no-await-in-loop
    result = await executeStep(state, compiledFlow, {
      registry,
      input: {
        text,
        messageId,
        channel: effectiveChannelType,
        raw: message,
        aiProvider, // Injeta provider de IA
      },
      deps: {
        persistence: persistenceServices,
        registry, // Passa registry para handlers que precisam (ex: subflow)
        replay, // Passa replay para o executeStep registrar ações
        executionLedger: executionLedgerAdapter,
      },
    });
  } catch (err) {
    const code = err && (err.code || err?.message);
    if (code === 'FLOW_REQUIRES_REVIEW' || (err?.code === 'FLOW_REQUIRES_REVIEW')) {
      logger.warn('[MessageProcessor] Execução bloqueada: fluxo em safe-mode (requiresReview)', {
        flowId: state.flowId,
        tenantId: state.tenantId,
      });
      try {
        await sendWhatsAppTextBestEffort(from, 'Este fluxo está em revisão e ainda não pode ser executado. Um administrador precisa aprovar antes da ativação.');
      } catch (sendErr) {
        logger.error('[MessageProcessor] Falha ao enviar aviso de revisão', sendErr);
      }
      return;
    }
    throw err;
  }
  const stepEndTime = new Date().toISOString();

  // Registra execução no replay
  if (replay) {
    replay.recordAction(
      {
        type: 'message_processing',
        step: 'process-message',
        value: { text: text.substring(0, 100), messageId },
      },
      {
        success: true,
        startTime: stepStartTime,
        endTime: stepEndTime,
        actual: {
          nextNodeId: result.state.currentNodeId,
          outputType: result.output?.type,
          eventsCount: result.events?.length || 0,
        },
      }
    );
  }

  const previousFunnel = (result?.state?.metadata && result.state.metadata.funnel_state)
    ? result.state.metadata.funnel_state
    : createDefaultFunnelState();
  const funnelTransition = transitionFunnelState(previousFunnel, { text });
  if (!result.state.metadata || typeof result.state.metadata !== 'object') result.state.metadata = {};
  result.state.metadata.funnel_state = funnelTransition.after;
  result.state.metadata.last_event = normalizedEvent;
  result.state.metadata.last_stage = funnelTransition.after.stage;
  result.state.metadata.last_intent = funnelTransition.after.intent;

  // Atualiza sessão (memory + store unificado)
  sessions.set(sessionId, result.state);
  await conversationSessionStore.set(sessionKey, result.state, Number(process.env.CONVERSATION_SESSION_TTL_SECONDS || 86400));

  try {
    await appendEventV1({
      tenantId: inboundTenantId,
      type: 'FunnelStateTransition',
      source: 'message.processor',
      correlationId: normalizedEvent.correlation_id,
      subject: { type: 'channel_session', id: sessionId },
      actor: { type: 'system', id: 'funnel_orchestrator' },
      idempotencyKey: `funnel_transition:${inboundTenantId}:${sessionId}:${messageId || traceId}`,
      payload: {
        trace_id: traceId,
        tenant_id: inboundTenantId,
        session_id: sessionId,
        lead_id: from || null,
        channel: effectiveChannelType,
        stage_before: funnelTransition.before.stage,
        stage_after: funnelTransition.after.stage,
        reason: funnelTransition.reason,
      },
    });
  } catch (_) {}

  // Execution ledger: marca execução como concluída quando conversa termina (best-effort)
  try {
    if (process.env.ENABLE_EXECUTION_LEDGER !== 'false') {
      const executionId = result?.state?.metadata?.executionId || state?.metadata?.executionId || null;
      const finished = !result?.state?.currentNodeId;
      const isTicketHandoffOutput = !!(result?.output && (
        result.output.type === 'handoff' ||
        (result.output.type === 'fallback_human' && result.output.escalationMode === ESCALATION_MODES.TICKET)
      ));
      const isHumanLiveOutput = !!(result?.output && (
        result.output.type === 'fallback_human_live' ||
        (result.output.type === 'fallback_human' && result.output.escalationMode === ESCALATION_MODES.HUMAN)
      ));
      const isInHumanHandoffState = !!(result?.state?.metadata && result.state.metadata.status === 'waiting_human');
      const shouldFinishExecution = finished || isTicketHandoffOutput || isHumanLiveOutput || isInHumanHandoffState;

      if (executionId && shouldFinishExecution) {
        let finishedBy = 'end_node_or_no_current_node';
        if (isTicketHandoffOutput) finishedBy = 'handoff_ticket';
        else if (isHumanLiveOutput) finishedBy = 'handoff_human_live';
        else if (isInHumanHandoffState) finishedBy = 'waiting_human';

        // eslint-disable-next-line global-require
        const { finishFlowExecutionSafe } = require('./flowExecutionLedgerService');
        await finishFlowExecutionSafe({
          tenantId: inboundTenantId,
          executionId,
          status: 'done',
          metaPatch: { finishedBy, finishedAt: new Date().toISOString() },
        }).catch(() => {});

        // Evita manter execução "aberta" em sessões que migraram para humano.
        if (result?.state?.metadata?.executionId) {
          delete result.state.metadata.executionId;
        }
      }
    }
  } catch (_) {}

  // Guarda eventos para replay
  const existingEvents = sessionEvents.get(sessionId) || [];
  sessionEvents.set(sessionId, existingEvents.concat(result.events || []));
  
  // Salva conversas após adicionar eventos (se função de salvamento fornecida)
  if (saveSessionEvents && typeof saveSessionEvents === 'function') {
    try {
      saveSessionEvents();
    } catch (err) {
      logger.error('[MessageProcessor] Erro ao salvar conversas:', err);
    }
  }

  // Verifica se a sessão está em atendimento humano (após execução)
  const isInHumanHandoff = result.state.metadata && result.state.metadata.status === 'waiting_human';

  // Se a engine devolveu uma mensagem, envia para o WhatsApp
  if (result.output) {
    // 1) Trata handoff (modo ticket): cria ticket e informa o usuário
    if (result.output.type === 'handoff' || 
        (result.output.type === 'fallback_human' && result.output.escalationMode === ESCALATION_MODES.TICKET)) {
      const queue = result.output.queue || 'default';
      
      // Preserva contexto completo do bot para o atendente
      const escalationContext = result.state.metadata?.humanEscalation || {};
      const botHistory = result.state.history || [];
      
      // Converte histórico do bot para formato de mensagens (apenas mensagens do bot)
      const botMessages = botHistory
        .filter(h => h.role === 'bot' && h.text)
        .map(h => ({
          id: h.id || `bot-msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          text: h.text,
          sender: 'bot',
          timestamp: h.timestamp || new Date().toISOString(),
        }));
      
      // Quota: max_conversas_mes (best-effort) — se exceder, não abre ticket
      try {
        const tenantId = result.state.tenantId;
        const limitCheck = await checkLimit(tenantId, 'max_conversas_mes', 1);
        if (!limitCheck.allowed) {
          const denyMsg = 'No momento não podemos abrir um novo atendimento porque o limite de conversas do plano foi atingido. Por favor, fale com o administrador do sistema.';
          try { await sendWhatsAppTextBestEffort(from, denyMsg); } catch {}
          logger.warn('[HANDOFF] Bloqueado por limite de conversas do plano', { tenantId, limit: limitCheck.limit, current: limitCheck.current });
          return;
        }
      } catch (e) {
        // ignora falhas de contagem
      }

      // Se já existe ticket para esta conversa/sessão (ex.: createOnInbound), reutiliza (idempotente).
      const effectiveTenantId = inboundTenantId || result.state.tenantId;
      let existing = null;
      if (conversationId && effectiveTenantId) {
        try {
          existing = require('./queueService').getTicketByConversationId(conversationId, effectiveTenantId);
        } catch (_) {}
      }
      if (!existing && effectiveTenantId) {
        existing = getTicketBySession(sessionId, effectiveTenantId);
      }

      let ticket = null;
      if (existing && existing.status !== 'closed') {
        // Atualiza ticket existente para fila de atendimento e registra última mensagem (idempotente por externalMessageId)
        const ts = message?.timestamp ? Number(message.timestamp) : null;
        const iso = ts && Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
        updateLastMessage(existing.id, text, messageId ? String(messageId) : null, iso);

        const mergedContext = {
          ...(existing.context || {}),
          flowId: result.state.flowId,
          escalationReason: result.output.fallbackType || escalationContext.reason || 'unknown',
          escalationAttempt: result.output.attempt || escalationContext.attempt || 1,
          botHistory: botMessages,
          variables: result.state.variables || {},
          allowReturnToBot: result.output.allowReturnToBot !== false,
          safeReturnNode: escalationContext.safeReturnNode || null,
          metadata: {
            ...(existing.context?.metadata || {}),
            flowVersion: result.state.flowVersion,
            currentNodeId: result.state.currentNodeId,
            channel: result.state.metadata?.channel || 'whatsapp',
            contactName: result.state.metadata?.contactName || existing.context?.metadata?.contactName || null,
          },
        };

        // eslint-disable-next-line global-require
        const { updateTicket } = require('./queueService');
        ticket = updateTicket(existing.id, {
          queue,
          status: 'waiting',
          assignedTo: null,
          conversationId: conversationId || existing.conversationId || null,
          channelType: existing.channelType || 'whatsapp',
          context: mergedContext,
        });

        // Garante takeover e sincroniza conversation (best-effort)
        try {
          // eslint-disable-next-line global-require
          const { takeOver } = require('./handoverService');
          await takeOver(ticket.id, { id: 'system', username: 'system' }, 'handoff');
        } catch (_) {}
      } else {
        ticket = createTicket({
          tenantId: result.state.tenantId, // Usa tenantId do estado da conversa
          sessionId,
          queue,
          lastUserMessage: text,
          context: {
            flowId: result.state.flowId,
            escalationReason: result.output.fallbackType || escalationContext.reason || 'unknown',
            escalationAttempt: result.output.attempt || escalationContext.attempt || 1,
            botHistory: botMessages,
            variables: result.state.variables || {},
            allowReturnToBot: result.output.allowReturnToBot !== false,
            safeReturnNode: escalationContext.safeReturnNode || null,
            // Link omnichannel quando disponível
            conversationId: conversationId || null,
            channelType: result.state.metadata?.channel || 'whatsapp',
            mode: 'human',
            metadata: {
              flowVersion: result.state.flowVersion,
              currentNodeId: result.state.currentNodeId,
              channel: result.state.metadata?.channel || 'whatsapp',
              contactName: result.state.metadata?.contactName || null,
            },
          },
        });

        // Mesmo já sendo "human" por padrão, garantimos sync do channel_conversation
        try {
          // eslint-disable-next-line global-require
          const { takeOver } = require('./handoverService');
          await takeOver(ticket.id, { id: 'system', username: 'system' }, 'handoff');
        } catch (_) {}
      }

      // Mensagem informativa para o usuário
      const message = result.output.message || 
        'Vou transferir você para um atendente humano. Aguarde um momento, por favor. 📞';
      try {
        await sendWhatsAppTextBestEffort(from, message);
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de handoff:', err);
        // Continua mesmo se falhar o envio, pois o ticket já foi criado
      }

      logger.info(`[HANDOFF] Ticket criado: ${ticket.id} na fila "${queue}" para sessão ${sessionId} com contexto preservado`);
      return; // Não continua processando como mensagem normal
    }
    
    // 2) Trata atendimento humano síncrono
    if (result.output.type === 'fallback_human_live' || 
        (result.output.type === 'fallback_human' && result.output.escalationMode === ESCALATION_MODES.HUMAN)) {
      // Cria sessão de atendimento humano síncrono
      const humanSession = createHumanSession({
        sessionId,
        state: result.state,
        returnNodeId: result.state.metadata?.humanEscalation?.safeReturnNode || null,
      });

      // Mensagem informativa para o usuário
      const message = result.output.message || 
        'Conectando você com um atendente humano em tempo real...';
      try {
        await sendWhatsAppTextBestEffort(from, message);
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de atendimento humano:', err);
        // Continua mesmo se falhar o envio
      }

      logger.info(`[HUMAN_LIVE] Sessão humana criada: ${humanSession.humanSessionId} para sessão ${sessionId}`);
      
      // Suspende processamento do bot - humano assume
      try {
        emitEvent('human.live.started', {
          sessionId,
          humanSessionId: humanSession.humanSessionId,
          tenantId: inboundTenantId || result.state.tenantId || null,
          channel: result.state.metadata?.channel || effectiveChannelType,
          phoneNumber: from,
          conversationId: conversationId || null,
          context: {
            flowId: humanSession.context?.flowId || result.state.flowId,
            variables: humanSession.context?.variables || {},
            metadata: humanSession.context?.metadata || {},
          },
          startedAt: humanSession.createdAt,
        }, { tenantId: inboundTenantId || result.state.tenantId || null });
      } catch (_) {}
      return; // Não continua processando como mensagem normal
    }

    // 3) Caso contrário, processa mensagens normais (message/ai)
    let messageText = null;

    if (result.output.type === 'message' && result.output.text) {
      messageText = result.output.text;
    } else if (result.output.type === 'ai' && result.output.text) {
      messageText = result.output.text;
    }

    if (messageText) {
      try {
        const decision = await decideNextResponse({
          tenantId: inboundTenantId,
          inboundText: text,
          engineOutputText: messageText,
          funnelTransition,
          traceId,
        });
        const shortResponse = decision.optional_question
          ? `${decision.response_text} ${decision.optional_question}`.trim()
          : decision.response_text;

        // Validação CDR antes de enviar mensagem
        const cdrValidation = validateCDR(shortResponse);
        
        if (cdrValidation.status === 'error') {
          // Produção/QA: bloqueia resposta e usa resposta segura
          const violationLog = generateViolationLog(cdrValidation, shortResponse);
          logger.error('[CDR_VIOLATION] Resposta bloqueada', violationLog);
          
          const safeMessage = getSafeResponse();
          await sendWhatsAppTextBestEffort(from, safeMessage);
          return;
        } else if (cdrValidation.status === 'warn') {
          // Desenvolvimento: apenas loga warning mas permite resposta
          const violationLog = generateViolationLog(cdrValidation, shortResponse);
          logger.warn('[CDR_WARNING] Resposta com violação (dev mode)', violationLog);
        }
        
        // Resposta válida ou warning em dev: envia normalmente
        await sendWhatsAppTextBestEffort(from, shortResponse);
        
        if (replay) {
          replay.recordEvent('message_sent', {
            messageLength: shortResponse.length,
            cdrValidated: cdrValidation.status === 'pass',
          });
        }
      } catch (err) {
        if (replay) {
          replay.recordError(err, 'send-message');
        }
        logger.error('[ERROR] Não foi possível enviar mensagem do bot:', err);
        // Não interrompe o fluxo, apenas loga o erro
      }
    }
  }

  // Finaliza e salva replay
  if (replay) {
    replay.recordEvent('message_processing_completed', {
      nextNodeId: result.state.currentNodeId,
      outputType: result.output?.type,
    });
    replay.stop();
    replay.save(replayId);
  }

  const latencyMs = Date.now() - processStartedAt;
  const isHandoff = !!(result && result.output && (result.output.type === 'handoff' || result.output.type === 'fallback_human_live'));
  messageMetrics.total += 1;
  if (isHandoff) messageMetrics.handoff += 1;
  const conversionStage = funnelTransition && funnelTransition.after ? funnelTransition.after.stage : null;
  if (conversionStage) {
    messageMetrics.conversionByStage[conversionStage] = Number(messageMetrics.conversionByStage[conversionStage] || 0) + 1;
  }

  logger.info('[MessageProcessor] Processamento concluído', {
    trace_id: traceId,
    tenant_id: inboundTenantId,
    session_id: sessionId,
    lead_id: from || null,
    channel: effectiveChannelType,
    latency_ms: latencyMs,
    handoff: isHandoff,
    handoff_rate: messageMetrics.total > 0 ? Number((messageMetrics.handoff / messageMetrics.total).toFixed(4)) : 0,
    conversion_by_stage: messageMetrics.conversionByStage,
  });

  return {
    ok: true,
    trace_id: traceId,
    session_id: sessionId,
    tenant_id: inboundTenantId,
    output: result ? result.output : null,
    state: result ? result.state : null,
  };
}

/**
 * Pipeline principal para evento normalizado (compatível com canais atuais e futuros).
 * @param {import('../contracts/normalizedInboundEvent').NormalizedInboundEvent|any} event
 * @param {{ flows: Map<string, any>, sessionEvents: Map<string, any[]>, saveSessionEvents?: () => void, flowId?: string|null }} deps
 */
async function processNormalizedInboundEvent(event, deps = {}) {
  const normalized = normalizeInboundEvent(event);
  const ev = normalized.event;
  const text = typeof ev?.payload === 'string'
    ? ev.payload
    : (ev?.payload && typeof ev.payload.text === 'string' ? ev.payload.text : '');

  const compatibleMessage = {
    from: ev.lead_id || 'unknown',
    id: (ev.metadata && ev.metadata.message_id) || ev.trace_id || `evt-${Date.now()}`,
    text: { body: text || '' },
    type: ev.media === 'audio' ? 'audio' : 'text',
    timestamp: Math.floor(new Date(ev.timestamp).getTime() / 1000),
  };

  const compatibleValue = {
    metadata: {
      phone_number_id: ev.metadata && ev.metadata.phone_number_id ? ev.metadata.phone_number_id : null,
      channel: ev.channel,
    },
    contacts: ev.metadata && ev.metadata.contact_name
      ? [{ profile: { name: String(ev.metadata.contact_name) }, wa_id: ev.lead_id || null }]
      : [],
  };

  return processWhatsAppMessage(compatibleMessage, compatibleValue, {
    ...deps,
    tenantId: ev.tenant_id,
    sessionId: ev.session_id,
    conversationId: ev.correlation_id,
    channelType: ev.channel,
    traceId: ev.trace_id,
  });
}

module.exports.processWhatsAppMessage = processWhatsAppMessage;
module.exports.processNormalizedInboundEvent = processNormalizedInboundEvent;
