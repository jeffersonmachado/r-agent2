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
const { getOrCompileFlow } = require('../../engine/compiledFlowCache');
const { sendTextMessage } = require('./whatsappService');
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
const path = require('path');

// Sessões em memória (para produção, ideal mover para Redis/DB)
/** @type {Map<string, import('../../engine/flowTypes').ConversationState>} */
const sessions = new Map();

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
  registry.register('router', routerNodeHandler);
  registry.register('schedule_router', scheduleRouterNodeHandler);
  registry.register('set_variable', setVariableNodeHandler);
  registry.register('handoff', handoffNodeHandler);
  registry.register('end', endNodeHandler);
  registry.register('ai', aiNodeHandler);
  registry.register('ai_task', aiTaskNodeHandler);
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
  const compiledFlow = getOrCompileFlow(flow);
  const startNode = compiledFlow.nodes.find((n) => n.type === 'start');

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
 * @param {{ flows: Map<string, any>, sessionEvents: Map<string, any[]>, saveSessionEvents?: () => void, tenantId?: string|null, conversationId?: string|null }} deps
 */
async function processWhatsAppMessage(message, value, deps) {
  const { flows, sessionEvents, saveSessionEvents, tenantId: inboundTenantId, conversationId } = deps || {};

  const from = message.from; // número do usuário (ex.: "5511999999999")
  const text = message.text && message.text.body ? String(message.text.body) : '';
  const messageId = message.id;
  const sessionId = `whatsapp_${from}`;

  async function sendWhatsAppTextBestEffort(to, textToSend) {
    const effectiveTenantId = inboundTenantId || state?.tenantId || null;
    // Sem tenantId não conseguimos enfileirar com isolamento; fallback para envio direto (compatibilidade)
    if (!effectiveTenantId) {
      await sendTextMessage(to, textToSend);
      return { queued: false };
    }

    return outboundQueueService.enqueueOutbound({
      tenantId: effectiveTenantId,
      channelType: 'whatsapp',
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
    replay = new ReplaySystem({
      storagePath: path.join(process.cwd(), 'replays', 'message'),
      context: 'message',
      enableScreenshots: false,
    });
    
    replayId = `message-${sessionId}-${Date.now()}`;
    replay.start(replayId, {
      sessionId,
      messageId,
      from,
    });
  }

  if (shouldRecord) {
    recording = new RecordingSystem({
      storagePath: path.join(process.cwd(), 'recordings', 'message'),
      context: 'message',
      enableTimestamps: true,
    });
    
    recordingId = `message-${sessionId}-${Date.now()}`;
    recording.start(recordingId, {
      name: 'Processamento de Mensagem WhatsApp',
      description: 'Processamento de mensagem do WhatsApp',
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

  let state = sessions.get(sessionId);

  // Verifica se já existe ticket ativo (handoff em andamento)
  // Importante: em ambiente multi-tenant, sessionId pode colidir; preferimos filtrar por tenant quando possível.
  const existingTicket = inboundTenantId
    ? getTicketBySession(sessionId, inboundTenantId)
    : getTicketBySession(sessionId);
  // Regra do handover (Fase 2):
  // - ticket.mode=human => engine não responde automaticamente
  // - ticket.mode=bot => engine continua (ticket existe, mas bot está no controle)
  const ticketMode = existingTicket ? (existingTicket.mode || 'human') : null;
  if (existingTicket && existingTicket.status !== 'closed' && ticketMode === 'human') {
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
    
    // Não processa mensagens do bot durante atendimento humano assíncrono
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
    
    // Durante atendimento humano síncrono, mensagens são roteadas para o humano
    // A implementação real de WebSocket/API deve ser feita na camada de API
    // Por enquanto, apenas logamos
    logger.debug(`[MessageProcessor] Mensagem recebida durante atendimento humano síncrono: ${sessionId}`);
    // TODO: Roteamento para humano via WebSocket/API
    return;
  }

  // Se não existe sessão, cria nova baseada em um fluxo padrão
  if (!state) {
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

  const compiledFlow = getOrCompileFlow(flow);
  const registry = createNodeRegistry();

  // Executa UM passo com input do usuário
  const persistenceServices = require('../../engine/services/persistenceServices');
  
  // Obtém provider de IA para o tenant (para nós AI)
  const tenantId = state.tenantId; // Tenant deve ser fornecido no state
  const aiProvider = getAiProviderForTenant(tenantId);
  
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
  const result = await executeStep(state, compiledFlow, {
    registry,
    input: {
      text,
      messageId,
      channel: 'whatsapp',
      raw: message,
      aiProvider, // Injeta provider de IA
    },
    deps: {
      persistence: persistenceServices,
      registry, // Passa registry para handlers que precisam (ex: subflow)
      replay, // Passa replay para o executeStep registrar ações
    },
  });
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
      // TODO: Implementar roteamento de mensagens para humano via WebSocket/API
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
};


