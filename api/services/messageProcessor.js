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
} = require('./humanLiveAdapter');
const { ESCALATION_MODES } = require('../../engine/fallbackController');
const { emitEvent } = require('./websocketService');
const config = require('../utils/config');
const { decideEntryPath } = require('./cognitive/cognitiveEntryPolicy');
const { handleInboundWithCognitiveCore } = require('./cognitive/inboundCognitiveHandler');
const { checkLimit } = require('./planLimitsService');
const { getAiProviderForTenant } = require('./aiProviderManager.js');
const { validateCDR, getSafeResponse, generateViolationLog } = require('../../qa/cdrValidator');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');
const path = require('path');
const { resolveRuntimePath } = require('../utils/runtimePaths');

// Sessões em memória (para produção, ideal mover para Redis/DB)
/** @type {Map<string, import('../../engine/flowTypes').ConversationState>} */
const sessions = new Map();

// Último acesso por sessão (ms) — base do sweeper de TTL que evita leak por contato.
/** @type {Map<string, number>} */
const sessionLastAccessAt = new Map();
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24h de inatividade
const SESSION_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // padrão de flowRuntimeState

// Teto de eventos guardados por sessão (replay/conversa): o concat anterior
// era O(total) por mensagem e crescia sem limite.
const MAX_SESSION_EVENTS = 500;

function touchSession(sessionId) {
  sessionLastAccessAt.set(sessionId, Date.now());
}

function removeSession(sessionId) {
  sessions.delete(sessionId);
  sessionLastAccessAt.delete(sessionId);
}

/**
 * Remove sessões sem mensagens há mais de SESSION_IDLE_TTL_MS.
 * Sessões ativas nunca são removidas: o último acesso é atualizado a cada mensagem.
 */
function sweepIdleSessions(now = Date.now()) {
  let removed = 0;
  for (const [sessionId, lastAccessAt] of sessionLastAccessAt.entries()) {
    if (now - lastAccessAt > SESSION_IDLE_TTL_MS) {
      removeSession(sessionId);
      removed += 1;
    }
  }
  if (removed > 0) {
    logger.debug(`[MessageProcessor] Sweeper de sessões: ${removed} sessão(ões) inativa(s) removida(s)`);
  }
  return removed;
}

const sessionSweepTimer = setInterval(sweepIdleSessions, SESSION_SWEEP_INTERVAL_MS);
if (typeof sessionSweepTimer.unref === 'function') {
  sessionSweepTimer.unref();
}

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

// Registry padrão criado UMA vez em nível de módulo: o NodeRegistry é
// stateless (mapa tipo -> handler, sem estado por request) e nenhum
// consumidor registra handlers novos em runtime (subflow usa apenas .get),
// então é seguro reutilizá-lo entre mensagens.
const defaultNodeRegistry = createNodeRegistry();

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

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value).trim(); } catch (_) { return fallback; }
}

function safeErrorMessage(err, fallback = '') {
  if (err == null) return fallback;
  try { return String(err.message); } catch (_) { return safeToString(err, fallback); }
}

function safeErrorCode(err, fallback = '') {
  if (err == null) return fallback;
  try { return safeToString(err.code, fallback); } catch (_) { return fallback; }
}

function safeErrorDetails(err, fallback = null) {
  if (err == null) return fallback;
  try { return err.details && err.details.errors ? err.details.errors : fallback; } catch (_) { return fallback; }
}

/**
 * Processa uma mensagem vinda do webhook do WhatsApp.
 *
 * @param {any} message - Objeto de mensagem do webhook do WhatsApp (value.messages[i])
 * @param {any} value - Objeto "value" completo do webhook (contém metadata da conversation)
 * @param {{ flows: Map<string, any>, sessionEvents: Map<string, any[]>, sessionTenants?: Map<string, string>, saveSessionEvents?: () => void, tenantId?: string|null, conversationId?: string|null, channelType?: string|null }} deps
 */
async function processWhatsAppMessage(message, value, deps) {
  const { flows, sessionEvents, sessionTenants, saveSessionEvents, tenantId: inboundTenantId, conversationId } = deps || {};
  const effectiveChannelType = (deps && deps.channelType && safeTrim(deps.channelType))
    ? safeTrim(deps.channelType)
    : 'whatsapp';

  const from = message.from; // número do usuário (ex.: "5511999999999")
  const text = message.text && message.text.body ? safeToString(message.text.body) : '';
  const messageId = message.id;
  const sessionId = `${effectiveChannelType}_${from}`;

  async function sendWhatsAppTextBestEffort(to, textToSend) {
    const effectiveTenantId = inboundTenantId || state?.tenantId;
    if (!effectiveTenantId) {
      logger.warn('[MessageProcessor] TenantId ausente; outbound ignorado (best-effort)', {
        to,
        messageId: messageId ? safeToString(messageId) : null,
        conversationId: conversationId || null,
        sessionId,
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

  // Replay é exclusivo de interações via UI (RPA browser). Processamento de
  // mensagem é backend e não é interação via UI — grava apenas o "recording"
  // operacional; replay fica opt-in via ENABLE_MESSAGE_REPLAY=true.
  const shouldRecordReplay = process.env.ENABLE_MESSAGE_REPLAY === 'true';
  const shouldRecord = process.env.ENABLE_MESSAGE_RECORDING !== 'false';
  let replay = null;
  let replayId = null;
  let recording = null;
  let recordingId = null;
  
  if (shouldRecordReplay) {
    const tenantId = inboundTenantId || null;
    replay = new ReplaySystem({
      storagePath: resolveRuntimePath('replays', 'message'),
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
      storagePath: resolveRuntimePath('recordings', 'message'),
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

  if (!inboundTenantId || typeof inboundTenantId !== 'string' || safeTrim(inboundTenantId) === '') {
    // Blindagem: nunca processa inbound sem tenant explícito (evita cross-tenant)
    logger.warn('[MessageProcessor] TenantId ausente no inbound; mensagem ignorada', {
      from,
      messageId: messageId ? safeToString(messageId) : null,
      conversationId: conversationId || null,
    });
    return;
  }

  let state = sessions.get(sessionId);
  touchSession(sessionId);

  // Verifica se já existe ticket ativo (handoff em andamento)
  // Importante: em ambiente multi-tenant, sessionId pode colidir; preferimos filtrar por tenant quando possível.
  const existingTicket = getTicketBySession(sessionId, inboundTenantId);
  // Regra do handover (Fase 2):
  // - ticket.mode=human => engine não responde automaticamente
  // - ticket.mode=bot => engine continua (ticket existe, mas bot está no controle)
  const ticketMode = existingTicket ? existingTicket.mode : null;
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
    updateLastMessage(existingTicket.id, text, messageId ? safeToString(messageId) : null, iso);
    
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
        updateLastMessage(ticketFromSession.id, text, messageId ? safeToString(messageId) : null, iso);
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

    logger.debug(`[MessageProcessor] Mensagem recebida durante atendimento humano síncrono: ${sessionId}`);
    return;
  }

  // Se não existe sessão, cria nova baseada em um fluxo padrão
  if (!state) {
    // Cognitive Entry Policy: decide o path de entrada (DETERMINISTIC_FLOW |
    // COGNITIVE | DURABLE_PROCESS | HUMAN) de forma explícita e registrada.
    // Flows determinísticos existentes continuam sendo o caminho padrão.
    const defaultFlowIdForPolicy = config.get('flows.defaultFlowId');
    const usableDefaultFlow = !!(defaultFlowIdForPolicy
      && defaultFlowIdForPolicy !== 'ID_DO_FLUXO_PADRAO'
      && !defaultFlowIdForPolicy.includes('SEU_')
      && !defaultFlowIdForPolicy.includes('YOUR_')
      && flows.get(defaultFlowIdForPolicy));
    const entryDecision = decideEntryPath({
      hasDeterministicFlow: usableDefaultFlow,
      cognitiveConfig: config.get('cognitive') || null,
      payload: { conversationId: conversationId || null },
      message: text,
    });

    logger.info('[MessageProcessor] Cognitive entry path', {
      tenantId: inboundTenantId,
      sessionId,
      path: entryDecision.path,
      reason: entryDecision.reason,
    });

    if (entryDecision.path === 'COGNITIVE' || entryDecision.path === 'DURABLE_PROCESS') {
      await handleInboundWithCognitiveCore({
        tenantId: inboundTenantId,
        channel: effectiveChannelType,
        message: text,
        conversationId: conversationId || sessionId,
        correlationId: messageId || null,
        payload: entryDecision.path === 'DURABLE_PROCESS' ? { durable: true } : {},
        sendText: (reply) => sendWhatsAppTextBestEffort(from, reply),
        configGet: (key) => config.get(key),
      });
      return;
    }

    const defaultFlowId = config.get('flows.defaultFlowId');
    
    // Valida se defaultFlowId não é um placeholder
    if (!defaultFlowId || defaultFlowId === 'ID_DO_FLUXO_PADRAO' || defaultFlowId.includes('SEU_') || defaultFlowId.includes('YOUR_')) {
        logger.error('[ERROR] defaultFlowId não configurado ou é placeholder. Configure flows.defaultFlowId em config.json');
      try {
        await sendWhatsAppTextBestEffort(from, 'Serviço indisponível no momento. Por favor, tente novamente mais tarde.');
      } catch (err) {
        logger.error('[ERROR] Não foi possível enviar mensagem de erro:', err);
      }
      return;
    }

    const flow = flows.get(defaultFlowId);
    if (!flow) {
      logger.error(`[ERROR] Flow "${defaultFlowId}" não encontrado. Verifique se o fluxo existe e se flows.defaultFlowId está correto em config.json`);
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

  let compiledFlow;
  try {
    compiledFlow = getOrCompileFlow(flow);
  } catch (err) {
    if (safeErrorCode(err) === 'AI_FLOW_INVALID_AT_EXECUTION') {
      logger.warn('[MessageProcessor] Execução bloqueada: fluxo de IA inválido na revalidação', {
        flowId: state.flowId,
        tenantId: state.tenantId,
        errors: safeErrorDetails(err),
      });
      try {
        await sendWhatsAppTextBestEffort(from, 'Este fluxo foi gerado por IA mas ainda não está consistente para execução. Um administrador precisa revisar/ajustar antes de ativar.');
      } catch {}
      return;
    }
    throw err;
  }
  const registry = defaultNodeRegistry;

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
          correlationId: conversationId ? safeToString(conversationId) : `channel:${effectiveChannelType}:${sessionId}`,
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
    const code = safeErrorCode(err) || safeErrorMessage(err);
    if (code === 'FLOW_REQUIRES_REVIEW') {
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

  // Atualiza sessão
  sessions.set(sessionId, result.state);
  touchSession(sessionId);

  // Quando a conversa termina (sem próximo nó), remove a sessão da memória.
  // O desfecho já foi registrado via ledger/eventos; manter o ConversationState
  // completo por contato indefinidamente era um leak de memória.
  if (!result?.state?.currentNodeId) {
    removeSession(sessionId);
  }

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

  // Guarda eventos para replay (com teto por sessão — mantém os mais recentes)
  const existingEvents = sessionEvents.get(sessionId) || [];
  const mergedEvents = existingEvents.concat(result.events || []);
  sessionEvents.set(sessionId, mergedEvents.length > MAX_SESSION_EVENTS ? mergedEvents.slice(-MAX_SESSION_EVENTS) : mergedEvents);
  // Carimbo de tenant: readers de replay/conversa são fail-closed sem ele.
  if (sessionTenants && typeof sessionTenants.set === 'function' && inboundTenantId) {
    sessionTenants.set(sessionId, inboundTenantId);
  }
  
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
        updateLastMessage(existing.id, text, messageId ? safeToString(messageId) : null, iso);

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
            },
          },
        });

        // O handoff define explicitamente modo humano e sincroniza a conversa.
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
        // Validação CDR antes de enviar mensagem
        const cdrValidation = validateCDR(messageText);
        
        if (cdrValidation.status === 'error') {
          // Produção/QA: bloqueia resposta e usa resposta segura
          const violationLog = generateViolationLog(cdrValidation, messageText);
          logger.error('[CDR_VIOLATION] Resposta bloqueada', violationLog);
          
          const safeMessage = getSafeResponse();
          await sendWhatsAppTextBestEffort(from, safeMessage);
          return;
        } else if (cdrValidation.status === 'warn') {
          // Desenvolvimento: apenas loga warning mas permite resposta
          const violationLog = generateViolationLog(cdrValidation, messageText);
          logger.warn('[CDR_WARNING] Resposta com violação (dev mode)', violationLog);
        }
        
        // Resposta válida ou warning em dev: envia normalmente
        await sendWhatsAppTextBestEffort(from, messageText);
        
        if (replay) {
          replay.recordEvent('message_sent', {
            messageLength: messageText.length,
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
}

module.exports = {
  processWhatsAppMessage,
  _internal: {
    sessions,
    sessionLastAccessAt,
    sweepIdleSessions,
    SESSION_IDLE_TTL_MS,
  },
};
